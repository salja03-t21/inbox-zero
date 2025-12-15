import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import { z } from "zod";
import prisma from "@/utils/prisma";
import { aiSummarizeEmailForDigest } from "@/utils/ai/digest/summarize-email-for-digest";
import { getEmailAccountWithAi } from "@/utils/user/get";
import type { StoredDigestContent } from "@/app/api/resend/digest/validation";
import { isAssistantEmail } from "@/utils/assistant/is-assistant-email";
import { env } from "@/env";
import { DigestStatus } from "@prisma/client";

const logger = createScopedLogger("inngest/ai-digest");

// Validation schema for the event payload
const aiDigestSchema = z.object({
  emailAccountId: z.string(),
  actionId: z.string().optional(),
  coldEmailId: z.string().optional(),
  message: z.object({
    id: z.string(),
    threadId: z.string(),
    from: z.string(),
    to: z.string().optional(),
    subject: z.string(),
    content: z.string(),
  }),
});

type AiDigestPayload = z.infer<typeof aiDigestSchema>;

/**
 * Inngest function for AI-powered email digest generation
 * Replaces the QStash endpoint at /api/ai/digest
 *
 * Event: inbox-zero/ai.digest
 * Payload: { emailAccountId, message, actionId?, coldEmailId? }
 *
 * Features:
 * - Summarizes emails using AI based on rule context
 * - Skips emails from the system itself
 * - Skips emails from assistant accounts
 * - Stores summaries in database for later sending
 * - Handles digest upsert (create or update)
 */
export const aiDigest = inngest.createFunction(
  {
    id: "ai-digest",
    retries: 3,
    // 2 minute timeout for AI summarization
    timeouts: { finish: "2m" },
  },
  { event: "inbox-zero/ai.digest" },
  async ({ event, step }) => {
    // Validate payload
    const validationResult = aiDigestSchema.safeParse(event.data);
    if (!validationResult.success) {
      logger.error("Invalid payload", {
        errors: validationResult.error.errors,
        receivedPayload: event.data,
      });
      throw new Error("Invalid payload structure");
    }

    const payload: AiDigestPayload = validationResult.data;
    const { emailAccountId, coldEmailId, actionId, message } = payload;

    logger.info("Processing AI digest", {
      emailAccountId,
      messageId: message.id,
      actionId,
      coldEmailId,
    });

    // Perform the digest processing in a step for durability
    const result = await step.run("process-digest", async () => {
      // Get email account with AI configuration
      const emailAccount = await getEmailAccountWithAi({
        emailAccountId,
      });

      if (!emailAccount) {
        logger.warn("Email account not found", { emailAccountId });
        throw new Error("Email account not found");
      }

      // Skip emails from the system itself
      if (message.from === env.RESEND_FROM_EMAIL) {
        logger.info("Skipping digest item because it is from us", {
          emailAccountId,
          messageId: message.id,
        });
        return {
          success: true,
          skipped: true,
          reason: "Email from system",
        };
      }

      // Skip emails from assistant accounts
      const isFromAssistant = isAssistantEmail({
        userEmail: emailAccount.email,
        emailToCheck: message.from,
      });

      if (isFromAssistant) {
        logger.info("Skipping digest item because it is from the assistant", {
          emailAccountId,
          messageId: message.id,
        });
        return {
          success: true,
          skipped: true,
          reason: "Email from assistant",
        };
      }

      // Get rule name from executed action
      const ruleName = actionId
        ? await getRuleNameByExecutedAction(actionId)
        : null;

      if (!ruleName) {
        logger.warn("Rule name not found for executed action", {
          emailAccountId,
          actionId,
        });
        return {
          success: true,
          skipped: true,
          reason: "Rule name not found",
        };
      }

      // Summarize email using AI
      const summary = await aiSummarizeEmailForDigest({
        ruleName,
        emailAccount,
        messageToSummarize: {
          ...message,
          to: message.to || "",
        },
      });

      if (!summary?.content) {
        logger.info(
          "Skipping digest item because it is not worth summarizing",
          {
            emailAccountId,
            messageId: message.id,
          },
        );
        return {
          success: true,
          skipped: true,
          reason: "Not worth summarizing",
        };
      }

      // Upsert digest with the summary
      await upsertDigest({
        messageId: message.id || "",
        threadId: message.threadId || "",
        emailAccountId,
        actionId,
        coldEmailId,
        content: summary,
      });

      logger.info("Digest item processed successfully", {
        emailAccountId,
        messageId: message.id,
      });

      return {
        success: true,
        skipped: false,
        digestCreated: true,
      };
    });

    return result;
  },
);

/**
 * Get rule name from an executed action
 */
async function getRuleNameByExecutedAction(
  actionId: string,
): Promise<string | undefined> {
  const executedAction = await prisma.executedAction.findUnique({
    where: { id: actionId },
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
  });

  if (!executedAction) {
    throw new Error("Executed action not found");
  }

  return executedAction.executedRule?.rule?.name;
}

/**
 * Find or create a digest for the given email account
 */
async function findOrCreateDigest(
  emailAccountId: string,
  messageId: string,
  threadId: string,
) {
  const digestWithItem = await prisma.digest.findFirst({
    where: {
      emailAccountId,
      status: DigestStatus.PENDING,
    },
    orderBy: {
      createdAt: "asc",
    },
    include: {
      items: {
        where: { messageId, threadId },
        take: 1,
      },
    },
  });

  if (digestWithItem) {
    return digestWithItem;
  }

  return await prisma.digest.create({
    data: {
      emailAccountId,
      status: DigestStatus.PENDING,
    },
    include: {
      items: {
        where: { messageId, threadId },
        take: 1,
      },
    },
  });
}

/**
 * Update an existing digest item
 */
async function updateDigestItem(
  itemId: string,
  contentString: string,
  actionId?: string,
  coldEmailId?: string,
) {
  return await prisma.digestItem.update({
    where: { id: itemId },
    data: {
      content: contentString,
      ...(actionId && { actionId }),
      ...(coldEmailId && { coldEmailId }),
    },
  });
}

/**
 * Create a new digest item
 */
async function createDigestItem({
  digestId,
  messageId,
  threadId,
  contentString,
  actionId,
  coldEmailId,
}: {
  digestId: string;
  messageId: string;
  threadId: string;
  contentString: string;
  actionId?: string;
  coldEmailId?: string;
}) {
  return await prisma.digestItem.create({
    data: {
      messageId,
      threadId,
      content: contentString,
      digestId,
      ...(actionId && { actionId }),
      ...(coldEmailId && { coldEmailId }),
    },
  });
}

/**
 * Upsert a digest with the given content
 */
async function upsertDigest({
  messageId,
  threadId,
  emailAccountId,
  actionId,
  coldEmailId,
  content,
}: {
  messageId: string;
  threadId: string;
  emailAccountId: string;
  actionId?: string;
  coldEmailId?: string;
  content: StoredDigestContent;
}) {
  const scopedLogger = logger.with({
    messageId,
    threadId,
    emailAccountId,
    actionId,
    coldEmailId,
  });

  try {
    const digest = await findOrCreateDigest(
      emailAccountId,
      messageId,
      threadId,
    );
    const existingItem = digest.items[0];
    const contentString = JSON.stringify(content);

    if (existingItem) {
      scopedLogger.info("Updating existing digest item");
      await updateDigestItem(
        existingItem.id,
        contentString,
        actionId,
        coldEmailId,
      );
    } else {
      scopedLogger.info("Creating new digest item");
      await createDigestItem({
        digestId: digest.id,
        messageId,
        threadId,
        contentString,
        actionId,
        coldEmailId,
      });
    }
  } catch (error) {
    scopedLogger.error("Failed to upsert digest", { error });
    throw error;
  }
}
