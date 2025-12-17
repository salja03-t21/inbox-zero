import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import { z } from "zod";
import { getEmailAccountWithAiAndTokens } from "@/utils/user/get";
import { SafeError } from "@/utils/error";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { getThreadMessages as getGmailThreadMessages } from "@/utils/gmail/thread";
import { getThreadMessages as getOutlookThreadMessages } from "@/utils/outlook/thread";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { getOutlookClientWithRefresh } from "@/utils/outlook/client";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import { findUnsubscribeLink } from "@/utils/parse/parseHtml.server";
import { getCalendarEventStatus } from "@/utils/parse/calender-event";
import { GmailLabel } from "@/utils/gmail/label";
import { isNewsletterSender } from "@/utils/ai/group/find-newsletters";
import { isMaybeReceipt, isReceipt } from "@/utils/ai/group/find-receipts";
import { saveThread, updateThread } from "@/utils/redis/clean";
import { internalDateToDate } from "@/utils/date";
import { CleanAction } from "@prisma/client";
import type { ParsedMessage } from "@/utils/types";
import { aiClean } from "@/utils/ai/clean/ai-clean";
import { publishToQstash } from "@/utils/upstash";
import type { CleanGmailBody } from "@/app/api/clean/gmail/route";
import type { CleanOutlookBody } from "@/app/api/clean/outlook/route";

const logger = createScopedLogger("inngest/clean-process");

const cleanProcessPayload = z.object({
  emailAccountId: z.string(),
  threadId: z.string(),
  markedDoneLabelId: z.string(),
  processedLabelId: z.string(),
  jobId: z.string(),
  action: z.enum([CleanAction.ARCHIVE, CleanAction.MARK_READ]),
  instructions: z.string().optional(),
  skips: z.object({
    reply: z.boolean().default(true).nullish(),
    starred: z.boolean().default(true).nullish(),
    calendar: z.boolean().default(true).nullish(),
    receipt: z.boolean().default(false).nullish(),
    attachment: z.boolean().default(false).nullish(),
    conversation: z.boolean().default(false).nullish(),
  }),
});

export type CleanProcessPayload = z.infer<typeof cleanProcessPayload>;

export const cleanProcess = inngest.createFunction(
  {
    id: "clean-process",
    retries: 3,
    // Per-user concurrency control: max 3 concurrent clean process jobs per emailAccountId
    // This prevents overwhelming the Microsoft Graph API with too many concurrent requests
    concurrency: {
      limit: 3,
      key: "event.data.emailAccountId",
    },
  },
  { event: "inbox-zero/clean.process" },
  async ({ event, step }) => {
    const payload = cleanProcessPayload.parse(event.data);

    logger.info("Processing clean request", {
      emailAccountId: payload.emailAccountId,
      threadId: payload.threadId,
      jobId: payload.jobId,
    });

    const result = await step.run("process-clean", async () => {
      const {
        emailAccountId,
        threadId,
        markedDoneLabelId,
        processedLabelId,
        jobId,
        action,
        instructions,
        skips,
      } = payload;

      // Get email account with tokens
      const emailAccount = await getEmailAccountWithAiAndTokens({
        emailAccountId,
      });

      if (!emailAccount) throw new SafeError("User not found", 404);
      if (!emailAccount.tokens)
        throw new SafeError("No account tokens found", 404);
      if (
        !emailAccount.tokens.access_token ||
        !emailAccount.tokens.refresh_token
      )
        throw new SafeError("No account tokens found", 404);

      // Fetch thread messages based on provider
      let messages: ParsedMessage[];
      const isGmail = isGoogleProvider(emailAccount.account.provider);

      if (isGmail) {
        const gmail = await getGmailClientWithRefresh({
          accessToken: emailAccount.tokens.access_token,
          refreshToken: emailAccount.tokens.refresh_token,
          expiresAt: emailAccount.tokens.expires_at,
          emailAccountId,
        });
        messages = await getGmailThreadMessages(threadId, gmail);
      } else {
        const outlook = await getOutlookClientWithRefresh({
          accessToken: emailAccount.tokens.access_token,
          refreshToken: emailAccount.tokens.refresh_token,
          expiresAt: emailAccount.tokens.expires_at || null,
          emailAccountId,
        });
        messages = await getOutlookThreadMessages(threadId, outlook);
      }

      logger.info("Fetched messages", {
        emailAccountId,
        threadId,
        messageCount: messages.length,
      });

      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) {
        logger.warn("No messages found in thread", { threadId });
        return { success: false, reason: "no_messages" };
      }

      // Save thread to Redis
      await saveThread({
        emailAccountId,
        thread: {
          threadId,
          jobId,
          subject: lastMessage.headers.subject,
          from: lastMessage.headers.from,
          snippet: lastMessage.snippet,
          date: internalDateToDate(lastMessage.internalDate),
        },
      });

      // Helper functions for checking message properties
      function isStarred(message: ParsedMessage) {
        return (
          message.labelIds?.includes(GmailLabel.STARRED) || message.isFlagged
        );
      }

      function isSent(message: ParsedMessage) {
        return message.labelIds?.includes(GmailLabel.SENT);
      }

      function hasAttachments(message: ParsedMessage) {
        return message.attachments && message.attachments.length > 0;
      }

      function hasSentMail(message: ParsedMessage) {
        return message.labelIds?.includes(GmailLabel.SENT);
      }

      // Run through static rules
      let needsLLMCheck = false;

      for (const message of messages) {
        // Skip if starred
        if (skips.starred && isStarred(message)) {
          await publishCleanAction({
            emailAccountId,
            threadId,
            markDone: false,
            action,
            markedDoneLabelId,
            processedLabelId,
            jobId,
            provider: emailAccount.account.provider,
          });
          return { success: true, reason: "starred" };
        }

        // Skip conversations
        if (skips.conversation && isSent(message)) {
          await publishCleanAction({
            emailAccountId,
            threadId,
            markDone: false,
            action,
            markedDoneLabelId,
            processedLabelId,
            jobId,
            provider: emailAccount.account.provider,
          });
          return { success: true, reason: "conversation" };
        }

        // Skip if has attachments
        if (skips.attachment && hasAttachments(message)) {
          await publishCleanAction({
            emailAccountId,
            threadId,
            markDone: false,
            action,
            markedDoneLabelId,
            processedLabelId,
            jobId,
            provider: emailAccount.account.provider,
          });
          return { success: true, reason: "attachment" };
        }

        // Check receipt
        if (skips.receipt) {
          if (isReceipt(message)) {
            await publishCleanAction({
              emailAccountId,
              threadId,
              markDone: false,
              action,
              markedDoneLabelId,
              processedLabelId,
              jobId,
              provider: emailAccount.account.provider,
            });
            return { success: true, reason: "receipt" };
          }

          if (isMaybeReceipt(message)) {
            needsLLMCheck = true;
            break;
          }
        }

        // Check calendar event
        const calendarEventStatus = getCalendarEventStatus(message);
        if (skips.calendar && calendarEventStatus.isEvent) {
          if (calendarEventStatus.timing === "past") {
            await publishCleanAction({
              emailAccountId,
              threadId,
              markDone: true,
              action,
              markedDoneLabelId,
              processedLabelId,
              jobId,
              provider: emailAccount.account.provider,
            });
            return { success: true, reason: "past_calendar_event" };
          }

          if (calendarEventStatus.timing === "future") {
            await publishCleanAction({
              emailAccountId,
              threadId,
              markDone: false,
              action,
              markedDoneLabelId,
              processedLabelId,
              jobId,
              provider: emailAccount.account.provider,
            });
            return { success: true, reason: "future_calendar_event" };
          }
        }

        // Check unsubscribe link
        if (!hasSentMail(message) && findUnsubscribeLink(message.textHtml)) {
          await publishCleanAction({
            emailAccountId,
            threadId,
            markDone: true,
            action,
            markedDoneLabelId,
            processedLabelId,
            jobId,
            provider: emailAccount.account.provider,
          });
          return { success: true, reason: "unsubscribe_link" };
        }

        // Check newsletter sender
        if (!hasSentMail(message) && isNewsletterSender(message.headers.from)) {
          await publishCleanAction({
            emailAccountId,
            threadId,
            markDone: true,
            action,
            markedDoneLabelId,
            processedLabelId,
            jobId,
            provider: emailAccount.account.provider,
          });
          return { success: true, reason: "newsletter" };
        }
      }

      // Check Gmail categories
      if (!needsLLMCheck && lastMessage.labelIds?.length) {
        const hasGmailCategory = lastMessage.labelIds.some(
          (label) =>
            label === GmailLabel.SOCIAL ||
            label === GmailLabel.PROMOTIONS ||
            label === GmailLabel.UPDATES ||
            label === GmailLabel.FORUMS,
        );

        if (hasGmailCategory) {
          await publishCleanAction({
            emailAccountId,
            threadId,
            markDone: true,
            action,
            markedDoneLabelId,
            processedLabelId,
            jobId,
            provider: emailAccount.account.provider,
          });
          return { success: true, reason: "gmail_category" };
        }
      }

      // Run LLM check
      const aiResult = await aiClean({
        emailAccount,
        messageId: lastMessage.id,
        messages: messages.map((m) => getEmailForLLM(m)),
        instructions,
        skips,
      });

      await publishCleanAction({
        emailAccountId,
        threadId,
        markDone: aiResult.archive,
        action,
        markedDoneLabelId,
        processedLabelId,
        jobId,
        provider: emailAccount.account.provider,
      });

      return { success: true, reason: "llm_check", archive: aiResult.archive };
    });

    logger.info("Clean process completed", {
      emailAccountId: payload.emailAccountId,
      threadId: payload.threadId,
      result,
    });

    return result;
  },
);

async function publishCleanAction({
  emailAccountId,
  threadId,
  markDone,
  action,
  markedDoneLabelId,
  processedLabelId,
  jobId,
  provider,
}: {
  emailAccountId: string;
  threadId: string;
  markDone: boolean;
  action: CleanAction;
  markedDoneLabelId: string;
  processedLabelId: string;
  jobId: string;
  provider: string;
}) {
  const isGmail = isGoogleProvider(provider);
  const endpoint = isGmail ? "/api/clean/gmail" : "/api/clean/outlook";
  const queueKey = isGmail
    ? `gmail-action-${emailAccountId}`
    : `outlook-action-${emailAccountId}`;

  const actionCount = 2;
  const maxRatePerSecond = Math.ceil(12 / actionCount);

  const cleanBody: CleanGmailBody | CleanOutlookBody = {
    emailAccountId,
    threadId,
    markDone,
    action,
    markedDoneLabelId,
    processedLabelId,
    jobId,
  };

  logger.info("Publishing clean action", {
    emailAccountId,
    threadId,
    endpoint,
    markDone,
  });

  await Promise.all([
    publishToQstash(endpoint, cleanBody, {
      key: queueKey,
      ratePerSecond: maxRatePerSecond,
    }),
    updateThread({
      emailAccountId,
      jobId,
      threadId,
      update: {
        archive: markDone,
        status: "applying",
      },
    }),
  ]);
}
