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
  const query: Record<string, unknown> = {
    type: "inbox",
    after: startDate,
    limit,
  };

  if (endDate) {
    query.before = endDate;
  }

  if (onlyUnread) {
    query.isUnread = true;
  }

  // Fetch threads from email provider
  const { threads, nextPageToken } =
    await emailProvider.getThreadsWithQuery(query);

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
  const threadsToProcess = threads
    .filter((thread) => {
      // Skip if already processed
      if (processedThreadIds.has(thread.id)) {
        return false;
      }

      // Skip if from ignored sender
      const latestMessage = thread.messages?.[thread.messages.length - 1];
      if (
        latestMessage?.headers?.from &&
        isIgnoredSender(latestMessage.headers.from)
      ) {
        return false;
      }

      return true;
    })
    .map((thread) => {
      const latestMessage = thread.messages?.[thread.messages.length - 1];
      return {
        id: thread.id,
        threadId: thread.id,
        messageId: latestMessage?.id || "",
      };
    })
    .filter(isDefined)
    .filter((email) => email.messageId !== "");

  logger.info("Email batch fetched", {
    totalThreads: threads.length,
    threadsToProcess: threadsToProcess.length,
    hasNextPageToken: !!nextPageToken,
  });

  return {
    emails: threadsToProcess,
    nextPageToken,
    totalFetched: threads.length,
  };
}
