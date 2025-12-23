import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import { z } from "zod";
import { createEmailProvider } from "@/utils/email/provider";
import { fetchEmailBatch } from "@/utils/bulk-process/email-fetcher";
import {
  incrementTotalEmails,
  incrementEmailsQueued,
  getBulkProcessJob,
  isJobCancelled,
} from "@/utils/bulk-process/job-manager";
import prisma from "@/utils/prisma";

const logger = createScopedLogger("inngest/bulk-process-fetcher");

// Schema for the fetcher event
const bulkProcessFetcherSchema = z.object({
  jobId: z.string(),
  emailAccountId: z.string(),
  startDate: z.string(), // ISO date string
  endDate: z.string().optional(),
  onlyUnread: z.boolean(),
  forceReprocess: z.boolean().default(false),
  pageToken: z.string().optional(),
  pageCount: z.number().default(0),
});

export type BulkProcessFetcherPayload = z.infer<
  typeof bulkProcessFetcherSchema
>;

/**
 * Inngest function for durable email fetching in bulk processing jobs
 *
 * This function fetches emails in batches and queues them for processing.
 * It uses pagination to handle large mailboxes and creates a fresh email
 * provider for each batch to ensure token refresh.
 *
 * Event: inbox-zero/bulk-process.fetcher
 */
export const bulkProcessFetcher = inngest.createFunction(
  {
    id: "bulk-process-fetcher",
    retries: 3,
    // 5 minute timeout per invocation
    timeouts: { finish: "5m" },
    // Limit concurrent fetchers per account to 1 (sequential fetching)
    concurrency: {
      limit: 1,
      key: "event.data.emailAccountId",
    },
  },
  { event: "inbox-zero/bulk-process.fetcher" },
  async ({ event, step }) => {
    // Validate payload
    const validationResult = bulkProcessFetcherSchema.safeParse(event.data);
    if (!validationResult.success) {
      logger.error("Invalid payload", {
        errors: validationResult.error.errors,
        receivedPayload: event.data,
      });
      throw new Error("Invalid payload structure");
    }

    const payload = validationResult.data;
    const {
      jobId,
      emailAccountId,
      startDate,
      endDate,
      onlyUnread,
      forceReprocess,
      pageToken,
      pageCount,
    } = payload;

    logger.info("Bulk process fetcher started", {
      jobId,
      emailAccountId,
      pageCount,
      hasPageToken: !!pageToken,
    });

    // Step 1: Check if job is still active
    const jobActive = await step.run("check-job-status", async () => {
      const cancelled = await isJobCancelled(jobId);
      if (cancelled) {
        logger.info("Job cancelled, stopping fetcher", { jobId });
        return false;
      }

      const job = await getBulkProcessJob(jobId);
      if (!job) {
        logger.error("Job not found", { jobId });
        return false;
      }

      return true;
    });

    if (!jobActive) {
      return { status: "cancelled", pageCount };
    }

    // Step 2: Get account info and create fresh email provider
    const accountInfo = await step.run("get-account-info", async () => {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          account: {
            select: { provider: true },
          },
        },
      });

      if (!emailAccount?.account) {
        throw new Error(`Email account not found: ${emailAccountId}`);
      }

      return { provider: emailAccount.account.provider };
    });

    // Step 3: Fetch a batch of emails (creates fresh provider each time for token refresh)
    const batchResult = await step.run("fetch-email-batch", async () => {
      const BATCH_SIZE = 25;

      // Create fresh provider - this will refresh token if needed
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider: accountInfo.provider,
      });

      const batch = await fetchEmailBatch({
        emailProvider,
        emailAccountId,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : undefined,
        onlyUnread,
        forceReprocess,
        pageToken,
        limit: BATCH_SIZE,
      });

      logger.info("Fetched email batch", {
        jobId,
        pageCount: pageCount + 1,
        emailsToProcess: batch.emails.length,
        totalFetched: batch.totalFetched,
        hasNextPage: !!batch.nextPageToken,
      });

      return batch;
    });

    // Step 4: Update job counters
    await step.run("update-counters", async () => {
      await incrementTotalEmails(jobId, batchResult.totalFetched);
      if (batchResult.emails.length > 0) {
        await incrementEmailsQueued(jobId, batchResult.emails.length);
      }
    });

    // Step 5: Queue emails for processing via Inngest
    if (batchResult.emails.length > 0) {
      await step.run("queue-emails", async () => {
        // Send all emails as individual events to Inngest
        await inngest.send(
          batchResult.emails.map((email) => ({
            name: "inbox-zero/bulk-process.worker",
            data: {
              jobId,
              emailAccountId,
              messageId: email.messageId,
              threadId: email.threadId,
              forceReprocess,
            },
          })),
        );

        logger.info("Queued emails for processing", {
          jobId,
          count: batchResult.emails.length,
        });
      });
    }

    // Step 6: If there are more pages, trigger next fetch
    if (batchResult.nextPageToken) {
      await step.run("trigger-next-page", async () => {
        await inngest.send({
          name: "inbox-zero/bulk-process.fetcher",
          data: {
            jobId,
            emailAccountId,
            startDate,
            endDate,
            onlyUnread,
            forceReprocess,
            pageToken: batchResult.nextPageToken,
            pageCount: pageCount + 1,
          },
        });

        logger.info("Triggered next page fetch", {
          jobId,
          nextPageCount: pageCount + 2,
        });
      });

      return {
        status: "continuing",
        pageCount: pageCount + 1,
        emailsQueued: batchResult.emails.length,
        hasMorePages: true,
      };
    }

    // No more pages - fetching complete
    logger.info("Bulk process fetching complete", {
      jobId,
      totalPages: pageCount + 1,
    });

    return {
      status: "complete",
      pageCount: pageCount + 1,
      emailsQueued: batchResult.emails.length,
      hasMorePages: false,
    };
  },
);
