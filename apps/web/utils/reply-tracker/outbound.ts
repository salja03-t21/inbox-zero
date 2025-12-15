import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { ParsedMessage } from "@/utils/types";
import { aiDetermineThreadStatus } from "@/utils/ai/reply/determine-thread-status";
import prisma from "@/utils/prisma";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import { internalDateToDate, sortByInternalDate } from "@/utils/date";
import type { EmailProvider } from "@/utils/email/types";
import { applyThreadStatusLabel } from "./label-helpers";
import { updateThreadTrackers } from "@/utils/reply-tracker/handle-conversation-status";
import { CONVERSATION_STATUS_TYPES } from "@/utils/reply-tracker/conversation-status-config";

export async function handleOutboundReply({
  emailAccount,
  message,
  provider,
}: {
  emailAccount: EmailAccountWithAI;
  message: ParsedMessage;
  provider: EmailProvider;
}) {
  const logger = createScopedLogger("reply-tracker/outbound").with({
    email: emailAccount.email,
    messageId: message.id,
    threadId: message.threadId,
  });

  const isEnabled = await isOutboundTrackingEnabled({
    emailAccountId: emailAccount.id,
  });
  if (!isEnabled) {
    logger.info("Outbound reply tracking disabled, skipping.");
    return;
  }

  logger.info("Determining thread status for outbound message");

  const threadMessages = await provider.getThreadMessages(message.threadId);
  if (!threadMessages?.length) {
    logger.error("No thread messages found, cannot proceed.");
    return;
  }

  const { isLatestOutbound, sortedMessages } = isMessageLatestOutboundInThread(
    message,
    threadMessages,
    provider,
    logger,
  );
  if (!isLatestOutbound) {
    logger.info(
      "Skipping outbound check: message is not the user's latest sent message",
    );
    return; // Stop processing if not the user's latest outbound message
  }

  // Prepare thread messages for AI analysis (chronological order, oldest to newest)
  const threadMessagesForLLM = sortedMessages.map((m, index) =>
    getEmailForLLM(m, {
      maxLength: index === sortedMessages.length - 1 ? 2000 : 500, // Give more context for the latest message
      extractReply: true,
      removeForwarded: false,
    }),
  );

  if (!threadMessagesForLLM.length) {
    logger.error("No messages for AI analysis");
    return;
  }

  const aiResult = await aiDetermineThreadStatus({
    emailAccount,
    threadMessages: threadMessagesForLLM,
    userSentLastEmail: true,
  });

  logger.info("AI determined thread status", { status: aiResult.status });

  await Promise.all([
    applyThreadStatusLabel({
      emailAccountId: emailAccount.id,
      threadId: message.threadId,
      messageId: message.id,
      systemType: aiResult.status,
      provider,
    }),
    updateThreadTrackers({
      emailAccountId: emailAccount.id,
      threadId: message.threadId,
      messageId: message.id,
      sentAt: internalDateToDate(message.internalDate),
      status: aiResult.status,
    }),
  ]);
}

async function isOutboundTrackingEnabled({
  emailAccountId,
}: {
  emailAccountId: string;
}): Promise<boolean> {
  const enabledRule = await prisma.rule.findFirst({
    where: {
      emailAccountId,
      systemType: { in: CONVERSATION_STATUS_TYPES },
      enabled: true,
    },
  });
  return !!enabledRule;
}

/**
 * Check if the message is the user's latest SENT message in the thread.
 * This handles webhook race conditions where inbound replies may arrive
 * before we finish processing the outbound message.
 *
 * We still want to process outbound messages even if there's a newer inbound
 * message, because we need to track that the user is awaiting a reply.
 */
function isMessageLatestOutboundInThread(
  message: ParsedMessage,
  threadMessages: ParsedMessage[],
  provider: EmailProvider,
  logger: Logger,
): { isLatestOutbound: boolean; sortedMessages: ParsedMessage[] } {
  if (!threadMessages.length)
    return { isLatestOutbound: false, sortedMessages: [] };

  const sortedMessages = [...threadMessages].sort(sortByInternalDate());

  // Filter to only outbound (sent) messages
  const outboundMessages = sortedMessages.filter((m) =>
    provider.isSentMessage(m),
  );

  if (!outboundMessages.length) {
    logger.warn("No outbound messages found in thread");
    return { isLatestOutbound: false, sortedMessages };
  }

  const latestOutboundMessage = outboundMessages[outboundMessages.length - 1];

  if (latestOutboundMessage?.id !== message.id) {
    logger.warn(
      "Skipping outbound reply check: message is not the user's latest sent message",
      {
        processingMessageId: message.id,
        latestOutboundMessageId: latestOutboundMessage?.id,
        outboundCount: outboundMessages.length,
        totalCount: sortedMessages.length,
      },
    );
    return { isLatestOutbound: false, sortedMessages };
  }

  logger.info("Message is user's latest sent message, proceeding", {
    messageId: message.id,
    totalMessagesInThread: sortedMessages.length,
    outboundMessagesInThread: outboundMessages.length,
  });

  return { isLatestOutbound: true, sortedMessages };
}
