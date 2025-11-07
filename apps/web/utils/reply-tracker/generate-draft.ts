import type { ParsedMessage } from "@/utils/types";
import { internalDateToDate } from "@/utils/date";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import { aiDraftWithKnowledge } from "@/utils/ai/reply/draft-with-knowledge";
import { getReply, saveReply } from "@/utils/redis/reply";
import { getWritingStyle } from "@/utils/user/get";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { aiExtractRelevantKnowledge } from "@/utils/ai/knowledge/extract";
import { stringifyEmail } from "@/utils/stringify-email";
import { aiExtractFromEmailHistory } from "@/utils/ai/knowledge/extract-from-email-history";
import type { EmailProvider } from "@/utils/email/types";
import { aiCollectReplyContext } from "@/utils/ai/reply/reply-context-collector";
import { getOrCreateReferralCode } from "@/utils/referral/referral-code";
import { generateReferralLink } from "@/utils/referral/referral-link";
import { aiGetCalendarAvailability } from "@/utils/ai/calendar/availability";
import { env } from "@/env";
import { mcpAgent } from "@/utils/ai/mcp/mcp-agent";

const logger = createScopedLogger("generate-reply");

/**
 * Fetches thread messages and generates draft content in one step
 */
export async function fetchMessagesAndGenerateDraft(
  emailAccount: EmailAccountWithAI,
  threadId: string,
  client: EmailProvider,
): Promise<string> {
  const { threadMessages, previousConversationMessages } =
    await fetchThreadAndConversationMessages(threadId, client);

  const result = await generateDraftContent(
    emailAccount,
    threadMessages,
    previousConversationMessages,
    client,
  );

  const emailAccountWithSignatures = await prisma.emailAccount.findUnique({
    where: { id: emailAccount.id },
    select: {
      includeReferralSignature: true,
      signature: true,
    },
  });

  let finalResult = result;

  if (
    !env.NEXT_PUBLIC_DISABLE_REFERRAL_SIGNATURE &&
    emailAccountWithSignatures?.includeReferralSignature
  ) {
    const referralSignature = await getOrCreateReferralCode(
      emailAccount.userId,
    );
    const referralLink = generateReferralLink(referralSignature.code);
    const htmlSignature = `Drafted by <a href="${referralLink}">Inbox Zero</a>.`;
    finalResult = `${finalResult}\n\n${htmlSignature}`;
  }

  if (emailAccountWithSignatures?.signature) {
    finalResult = `${finalResult}\n\n${emailAccountWithSignatures.signature}`;
  }

  return finalResult;
}

/**
 * Fetches thread messages and previous conversation messages
 */
async function fetchThreadAndConversationMessages(
  threadId: string,
  client: EmailProvider,
): Promise<{
  threadMessages: ParsedMessage[];
  previousConversationMessages: ParsedMessage[] | null;
}> {
  const threadMessages = await client.getThreadMessages(threadId);
  const previousConversationMessages =
    await client.getPreviousConversationMessages(
      threadMessages.map((msg) => msg.id),
    );

  return {
    threadMessages,
    previousConversationMessages,
  };
}

async function generateDraftContent(
  emailAccount: EmailAccountWithAI,
  threadMessages: ParsedMessage[],
  previousConversationMessages: ParsedMessage[] | null,
  emailProvider: EmailProvider,
) {
  const lastMessage = threadMessages.at(-1);

  if (!lastMessage) throw new Error("No message provided");

  // Check Redis cache for reply
  const reply = await getReply({
    emailAccountId: emailAccount.id,
    messageId: lastMessage.id,
  });

  if (reply) return reply;

  const messages = threadMessages.map((msg, index) => ({
    date: internalDateToDate(msg.internalDate),
    ...getEmailForLLM(msg, {
      // give more context for the message we're processing
      maxLength: index === threadMessages.length - 1 ? 2000 : 500,
      extractReply: true,
      removeForwarded: false,
    }),
  }));

  // 1. Get knowledge base entries
  const knowledgeBase = await prisma.knowledge.findMany({
    where: { emailAccountId: emailAccount.id },
    orderBy: { updatedAt: "desc" },
  });

  // If we have knowledge base entries, extract relevant knowledge and draft with it
  // 2a. Extract relevant knowledge
  const lastMessageContent = stringifyEmail(
    messages[messages.length - 1],
    10_000,
  );

  // Use allSettled to prevent cascade failures - one failing service shouldn't break the whole draft
  const [
    knowledgeResult,
    emailHistoryContextResult,
    calendarAvailabilityResult,
    writingStyleResult,
    mcpResult,
  ] = await Promise.allSettled([
    aiExtractRelevantKnowledge({
      knowledgeBase,
      emailContent: lastMessageContent,
      emailAccount,
    }),
    aiCollectReplyContext({
      currentThread: messages,
      emailProvider,
      emailAccount,
    }),
    aiGetCalendarAvailability({ emailAccount, messages }),
    getWritingStyle({ emailAccountId: emailAccount.id }),
    mcpAgent({ emailAccount, messages }),
  ]);

  // Helper to unwrap settled promises with fallback
  const get = <T>(result: PromiseSettledResult<T>, fallback: T): T => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    logger.warn("Context gathering failed", {
      reason: result.reason,
    });
    return fallback;
  };

  const emailHistoryContext = get(emailHistoryContextResult, null);

  // 2b. Extract email history context
  const senderEmail = lastMessage.headers.from;

  logger.info("Fetching historical messages from sender", {
    sender: senderEmail,
  });

  // Convert to format needed for aiExtractFromEmailHistory
  const historicalMessagesForLLM = previousConversationMessages?.map((msg) => {
    return getEmailForLLM(msg, {
      maxLength: 1000,
      extractReply: true,
      removeForwarded: false,
    });
  });

  const emailHistorySummary = historicalMessagesForLLM?.length
    ? await aiExtractFromEmailHistory({
        currentThreadMessages: messages,
        historicalMessages: historicalMessagesForLLM,
        emailAccount,
      })
    : null;

  // 3. Draft with extracted knowledge
  const text = await aiDraftWithKnowledge({
    messages,
    emailAccount,
    knowledgeBaseContent: get(knowledgeResult, null)?.relevantContent || null,
    emailHistorySummary,
    emailHistoryContext,
    calendarAvailability: get(calendarAvailabilityResult, null),
    writingStyle: get(writingStyleResult, null),
    mcpContext: get(mcpResult, null)?.response || null,
  });

  // Provide a minimal fallback if draft generation completely fails
  const replyText =
    typeof text === "string" && text.trim()
      ? text.trim()
      : "Thanks for your note — I'll follow up shortly.";

  // Only cache non-empty replies
  if (replyText.length > 0) {
    await saveReply({
      emailAccountId: emailAccount.id,
      messageId: lastMessage.id,
      reply: replyText,
    });
  }

  return replyText;
}
