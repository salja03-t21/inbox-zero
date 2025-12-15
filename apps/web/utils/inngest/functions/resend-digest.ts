import { inngest } from "../client";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { z } from "zod";
import prisma from "@/utils/prisma";
import { DigestStatus, SystemType } from "@prisma/client";
import { createUnsubscribeToken } from "@/utils/unsubscribe";
import { calculateNextScheduleDate } from "@/utils/schedule";
import type { ParsedMessage } from "@/utils/types";
import {
  storedDigestContentSchema,
  type Digest,
} from "@/app/api/resend/digest/validation";
import { extractNameFromEmail } from "@/utils/email";
import { getRuleName } from "@/utils/rule/consts";
import { createEmailProvider } from "@/utils/email/provider";
import { sleep } from "@/utils/sleep";
import { render } from "@react-email/components";
import DigestEmail, {
  generateDigestSubject,
} from "@inboxzero/resend/emails/digest";
import { env } from "@/env";
import { captureException, SafeError } from "@/utils/error";
import { camelCase } from "lodash";

const logger = createScopedLogger("inngest/resend-digest");

// Validation schema for the event payload
const resendDigestSchema = z.object({
  emailAccountId: z.string(),
  force: z.boolean().optional(),
});

type ResendDigestPayload = z.infer<typeof resendDigestSchema>;

type SendEmailResult = {
  success: boolean;
  message: string;
};

/**
 * Inngest function for sending digest emails via Resend
 * Replaces the QStash endpoint at /api/resend/digest
 *
 * Event: inbox-zero/resend.digest
 * Payload: { emailAccountId, force?: boolean }
 *
 * Features:
 * - Fetches pending digests for a user
 * - Retrieves full message content from email provider
 * - Groups digest items by rule
 * - Renders digest email template
 * - Sends email via Resend
 * - Updates digest status and schedule
 * - Redacts sensitive content after sending
 * - Handles force sending (for testing)
 */
export const resendDigest = inngest.createFunction(
  {
    id: "resend-digest",
    retries: 3,
    // 1 minute timeout for email sending
    timeouts: { finish: "1m" },
  },
  { event: "inbox-zero/resend.digest" },
  async ({ event, step }) => {
    // Validate payload
    const validationResult = resendDigestSchema.safeParse(event.data);
    if (!validationResult.success) {
      logger.error("Invalid payload", {
        errors: validationResult.error.errors,
        receivedPayload: event.data,
      });
      throw new Error("Invalid payload structure");
    }

    const payload: ResendDigestPayload = validationResult.data;
    const { emailAccountId, force } = payload;

    const scopedLogger = logger.with({
      emailAccountId,
      force: force || false,
    });

    scopedLogger.info("Sending digest email");

    // Perform the email sending in a step for durability
    const result = await step.run("send-digest-email", async () => {
      return sendEmail({
        emailAccountId,
        force,
        logger: scopedLogger,
      });
    });

    return result;
  },
);

/**
 * Send digest email to user
 */
async function sendEmail({
  emailAccountId,
  force,
  logger: scopedLogger,
}: {
  emailAccountId: string;
  force?: boolean;
  logger: Logger;
}): Promise<SendEmailResult> {
  scopedLogger.info("Sending digest email");

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      email: true,
      account: { select: { provider: true } },
    },
  });

  if (!emailAccount) {
    throw new Error("Email account not found");
  }

  const emailProvider = await createEmailProvider({
    emailAccountId,
    provider: emailAccount.account.provider,
  });

  const digestScheduleData = await getDigestSchedule({ emailAccountId });

  const pendingDigests = await prisma.digest.findMany({
    where: {
      emailAccountId,
      status: DigestStatus.PENDING,
    },
    select: {
      id: true,
      items: {
        select: {
          messageId: true,
          content: true,
          action: {
            select: {
              executedRule: {
                select: {
                  rule: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (pendingDigests.length) {
    // Mark all found digests as processing
    await prisma.digest.updateMany({
      where: {
        id: {
          in: pendingDigests.map((d) => d.id),
        },
      },
      data: {
        status: DigestStatus.PROCESSING,
      },
    });
  }

  try {
    // Return early if no digests were found, unless force is true
    if (pendingDigests.length === 0) {
      if (!force) {
        return { success: true, message: "No digests to process" };
      }
      // When force is true, send an empty digest to indicate the system is working
      scopedLogger.info("Force sending empty digest", { emailAccountId });
    }

    // Store the digest IDs for the final update
    const processedDigestIds = pendingDigests.map((d) => d.id);

    const messageIds = pendingDigests.flatMap((digest) =>
      digest.items.map((item) => item.messageId),
    );

    scopedLogger.info("Fetching batch of messages");

    const messages: ParsedMessage[] = [];
    if (messageIds.length > 0) {
      const batchSize = 100;

      // Can't fetch more than 100 messages at a time, so fetch in batches
      // and wait 2 seconds to avoid rate limiting
      for (let i = 0; i < messageIds.length; i += batchSize) {
        const batch = messageIds.slice(i, i + batchSize);
        const batchResults = await emailProvider.getMessagesBatch(batch);
        messages.push(...batchResults);

        if (i + batchSize < messageIds.length) {
          await sleep(2000);
        }
      }
    }

    scopedLogger.info("Fetched batch of messages");

    // Create a message lookup map for O(1) access
    const messageMap = new Map(messages.map((m) => [m.id, m]));

    // Map of rules camelCase -> ruleName
    const ruleNameMap = new Map<string, string>();

    // Transform and group in a single pass
    const executedRulesByRule = pendingDigests.reduce((acc, digest) => {
      digest.items.forEach((item) => {
        const message = messageMap.get(item.messageId);
        if (!message) {
          scopedLogger.warn("Message not found, skipping digest item", {
            messageId: item.messageId,
          });
          return;
        }

        const ruleName =
          item.action?.executedRule?.rule?.name ||
          getRuleName(SystemType.COLD_EMAIL);

        const ruleNameKey = camelCase(ruleName);
        if (!ruleNameMap.has(ruleNameKey)) {
          ruleNameMap.set(ruleNameKey, ruleName);
        }

        if (!acc[ruleNameKey]) {
          acc[ruleNameKey] = [];
        }

        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(item.content);
        } catch (error) {
          scopedLogger.warn(
            "Failed to parse digest item content, skipping item",
            {
              messageId: item.messageId,
              digestId: digest.id,
              error: error instanceof Error ? error.message : "Unknown error",
            },
          );
          return; // Skip this item and continue with the next one
        }

        const contentResult =
          storedDigestContentSchema.safeParse(parsedContent);

        if (contentResult.success) {
          acc[ruleNameKey].push({
            content: contentResult.data.content,
            from: extractNameFromEmail(message?.headers?.from || ""),
            subject: message?.headers?.subject || "",
          });
        } else {
          scopedLogger.warn("Failed to validate digest content structure", {
            messageId: item.messageId,
            digestId: digest.id,
            error: contentResult.error,
          });
        }
      });
      return acc;
    }, {} as Digest);

    if (Object.keys(executedRulesByRule).length === 0) {
      scopedLogger.info("No executed rules found, skipping digest email");
      return {
        success: true,
        message: "No executed rules found, skipping digest email",
      };
    }

    const token = await createUnsubscribeToken({ emailAccountId });

    scopedLogger.info("Sending digest email");

    // Prepare email props
    const emailProps = {
      baseUrl: env.NEXT_PUBLIC_BASE_URL,
      unsubscribeToken: token,
      date: new Date(),
      ruleNames: Object.fromEntries(ruleNameMap),
      ...executedRulesByRule,
      emailAccountId,
    };

    // Render the digest email template to HTML
    const digestHtml = await render(DigestEmail(emailProps));

    // Generate subject line
    const subject = generateDigestSubject(emailProps);

    // Send digest email from user's own account to themselves
    await emailProvider.sendEmailWithHtml({
      to: emailAccount.email,
      subject,
      messageHtml: digestHtml,
    });

    scopedLogger.info("Digest email sent");

    // Only update database if email sending succeeded
    // Use a transaction to ensure atomicity - all updates succeed or none are applied
    await prisma.$transaction([
      ...(digestScheduleData
        ? [
            prisma.schedule.update({
              where: {
                id: digestScheduleData.id,
                emailAccountId,
              },
              data: {
                lastOccurrenceAt: new Date(),
                nextOccurrenceAt: calculateNextScheduleDate(digestScheduleData),
              },
            }),
          ]
        : []),
      // Mark only the processed digests as sent
      prisma.digest.updateMany({
        where: {
          id: {
            in: processedDigestIds,
          },
        },
        data: {
          status: DigestStatus.SENT,
          sentAt: new Date(),
        },
      }),
      // Redact all DigestItems for the processed digests
      prisma.digestItem.updateMany({
        data: { content: "[REDACTED]" },
        where: {
          digestId: {
            in: processedDigestIds,
          },
        },
      }),
    ]);

    return { success: true, message: "Digest email sent successfully" };
  } catch (error) {
    await prisma.digest.updateMany({
      where: {
        id: {
          in: pendingDigests.map((d) => d.id),
        },
      },
      data: {
        status: DigestStatus.FAILED,
      },
    });
    scopedLogger.error("Error sending digest email", { error });
    captureException(error);
    throw new SafeError("Error sending digest email", 500);
  }
}

/**
 * Get digest schedule for a user
 */
async function getDigestSchedule({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  return prisma.schedule.findUnique({
    where: { emailAccountId },
    select: {
      id: true,
      intervalDays: true,
      occurrences: true,
      daysOfWeek: true,
      timeOfDay: true,
      lastOccurrenceAt: true,
      nextOccurrenceAt: true,
    },
  });
}
