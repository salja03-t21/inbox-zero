import type { EmailProvider } from "@/utils/email/types";
import prisma from "@/utils/prisma";
import { ExecutedRuleStatus } from "@prisma/client";
import { createScopedLogger } from "@/utils/logger";
import { isDefined } from "@/utils/types";
import { isIgnoredSender } from "@/utils/filter-ignored-senders";

const logger = createScopedLogger("bulk-process-email-fetcher");

export interface FetchEmailsParams {
  emailProvider: EmailProvider;
  emailAccountId: string;
  startDate: Date;
  endDate?: Date;
  onlyUnread: boolean;
  pageToken?: string;
  limit?: number;
}

export interface EmailToProcess {
  id: string;
  threadId: string;
  messageId: string;
}

/**
 * Fetch a batch of emails that need processing
 * Returns emails that don't have APPLIED/APPLYING status
 */
export async function fetchEmailBatch(params: FetchEmailsParams) {
  const {
    emailProvider,
    emailAccountId,
    startDate,
    endDate,
    onlyUnread,
    pageToken,
    limit = 25,
  } = params;

  logger.info("Fetching email batch", {
    emailAccountId,
    startDate,
    endDate,
    onlyUnread,
    hasPageToken: !!pageToken,
  });

  // Build query parameters
  const query = {
    type: "inbox" as const,
    after: startDate,
    before: endDate,
    isUnread: onlyUnread || undefined,
  };

  // Fetch threads from email provider
  // Note: getThreadsWithQuery may return empty on error - we detect this
  // by checking if we have a pageToken but get 0 results (unexpected for pagination)
  const { threads, nextPageToken } = await emailProvider.getThreadsWithQuery({
    query,
    maxResults: limit,
    pageToken,
  });

  // If we had a pageToken (indicating more pages expected) but got 0 results,
  // this likely indicates an API error that was silently handled
  if (pageToken && threads.length === 0 && !nextPageToken) {
    logger.warn(
      "Unexpected empty result during pagination - possible API error",
      {
        emailAccountId,
        hadPageToken: true,
        receivedThreads: 0,
        hasNextToken: false,
      },
    );
    // Throw to trigger retry at the Inngest level
    throw new Error(
      "Unexpected empty result during pagination - possible API error",
    );
  }

  const threadIds = threads.map((t) => t.id);

  // Get already processed threads (with APPLIED/APPLYING status)
  // SKIPPED and ERROR should be reprocessed
  const PLAN_STATUSES: ExecutedRuleStatus[] = [
    ExecutedRuleStatus.APPLIED,
    ExecutedRuleStatus.APPLYING,
  ];

  const processedThreads = await prisma.executedRule.findMany({
    where: {
      emailAccountId,
      threadId: { in: threadIds },
      status: { in: PLAN_STATUSES },
    },
    select: {
      threadId: true,
    },
  });

  const processedThreadIds = new Set(processedThreads.map((t) => t.threadId));

  // Filter out already processed threads and ignored senders
  // Track filtering reasons for debugging
  let skippedAlreadyProcessed = 0;
  let skippedIgnoredSender = 0;
  let skippedNoMessages = 0;
  let skippedNoMessageId = 0;

  const threadsToProcess = threads
    .filter((thread) => {
      // Skip if already processed
      if (processedThreadIds.has(thread.id)) {
        skippedAlreadyProcessed++;
        return false;
      }

      // Skip if from ignored sender
      const latestMessage = thread.messages?.[thread.messages.length - 1];
      if (
        latestMessage?.headers?.from &&
        isIgnoredSender(latestMessage.headers.from)
      ) {
        skippedIgnoredSender++;
        return false;
      }

      // Skip if no messages
      if (!latestMessage) {
        skippedNoMessages++;
        return false;
      }

      return true;
    })
    .map((thread) => {
      const latestMessage = thread.messages?.[thread.messages.length - 1];
      const messageId = latestMessage?.id || "";

      if (!messageId) {
        skippedNoMessageId++;
      }

      return {
        id: thread.id,
        threadId: thread.id,
        messageId,
      };
    })
    .filter(isDefined)
    .filter((email) => email.messageId !== "");

  logger.info("Email batch fetched", {
    totalThreads: threads.length,
    threadsToProcess: threadsToProcess.length,
    skippedAlreadyProcessed,
    skippedIgnoredSender,
    skippedNoMessages,
    skippedNoMessageId,
    hasNextPageToken: !!nextPageToken,
  });

  return {
    emails: threadsToProcess,
    nextPageToken,
    totalFetched: threads.length,
  };
}
