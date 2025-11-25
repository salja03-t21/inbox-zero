import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { startBulkProcessSchema } from "@/utils/bulk-process/validation";
import { createBulkProcessJob, markJobAsRunning } from "@/utils/bulk-process/job-manager";
import { fetchEmailBatch } from "@/utils/bulk-process/email-fetcher";
import { publishToQstashQueue } from "@/utils/upstash";
import { env } from "@/env";
import { incrementTotalEmails } from "@/utils/bulk-process/job-manager";
import { createScopedLogger } from "@/utils/logger";
import { getPremium } from "@/utils/premium";
import type { EmailProvider } from "@/utils/email/types";

const logger = createScopedLogger("api/bulk-process/start");

export const maxDuration = 300; // 5 minutes

export const POST = withEmailProvider(async (request) => {
  const { emailProvider } = request;
  const { userId, emailAccountId } = request.auth;

  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = startBulkProcessSchema.parse(body);

    // Verify user has premium/AI access
    const premium = await getPremium({ emailAccountId });
    if (!premium?.hasAiAccess) {
      return NextResponse.json(
        { error: "Premium subscription required for bulk processing" },
        { status: 403 },
      );
    }

    // Verify the emailAccountId matches auth
    if (validatedData.emailAccountId !== emailAccountId) {
      return NextResponse.json(
        { error: "Email account mismatch" },
        { status: 403 },
      );
    }

    // Create the job
    const job = await createBulkProcessJob({
      emailAccountId,
      userId,
      startDate: validatedData.startDate,
      endDate: validatedData.endDate,
      onlyUnread: validatedData.onlyUnread,
    });

    logger.info("Created bulk process job", {
      jobId: job.id,
      emailAccountId,
      startDate: validatedData.startDate,
      endDate: validatedData.endDate,
    });

    // Mark job as running
    await markJobAsRunning(job.id);

    // Start fetching and queueing emails in the background
    // We don't await this - it runs asynchronously
    startFetchingAndQueueing({
      jobId: job.id,
      emailAccountId,
      emailProvider,
      startDate: validatedData.startDate,
      endDate: validatedData.endDate,
      onlyUnread: validatedData.onlyUnread,
    }).catch((error) => {
      logger.error("Error in background fetching and queueing", {
        error,
        jobId: job.id,
      });
    });

    // Return job ID immediately
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
    });
  } catch (error) {
    logger.error("Error starting bulk process", { error, emailAccountId });

    if (error instanceof Error && error.message.includes("already running")) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }, // Conflict
      );
    }

    return NextResponse.json(
      { error: "Failed to start bulk processing" },
      { status: 500 },
    );
  }
});

/**
 * Fetch emails in batches and queue them to QStash
 * This runs in the background after the initial response is sent
 */
async function startFetchingAndQueueing(params: {
  jobId: string;
  emailAccountId: string;
  emailProvider: EmailProvider;
  startDate: Date;
  endDate?: Date;
  onlyUnread: boolean;
}) {
  const {
    jobId,
    emailAccountId,
    emailProvider,
    startDate,
    endDate,
    onlyUnread,
  } = params;

  let pageToken: string | undefined;
  let pageCount = 0;
  const BATCH_SIZE = 25;

  logger.info("Starting email fetching and queueing", { jobId });

  try {
    while (true) {
      pageCount++;

      // Fetch a batch of emails
      const batch = await fetchEmailBatch({
        emailProvider,
        emailAccountId,
        startDate,
        endDate,
        onlyUnread,
        pageToken,
        limit: BATCH_SIZE,
      });

      logger.info("Fetched email batch", {
        jobId,
        pageCount,
        emailsToProcess: batch.emails.length,
        totalFetched: batch.totalFetched,
      });

      // Update total emails counter
      await incrementTotalEmails(jobId, batch.totalFetched);

      // Enqueue each email to QStash
      for (const email of batch.emails) {
        try {
          await publishToQstashQueue({
            queueName: "bulk-email-processing",
            parallelism: 3, // Process 3 emails concurrently
            url: `${env.WEBHOOK_URL || env.NEXT_PUBLIC_BASE_URL}/api/bulk-process/worker`,
            body: {
              jobId,
              emailAccountId,
              messageId: email.messageId,
              threadId: email.threadId,
            },
            headers: {
              "Content-Type": "application/json",
            },
          });

          logger.info("Queued email for processing", {
            jobId,
            messageId: email.messageId,
          });
        } catch (error) {
          logger.error("Failed to queue email", {
            error,
            jobId,
            messageId: email.messageId,
          });
        }
      }

      // Check if there are more pages
      if (!batch.nextPageToken) {
        logger.info("No more emails to fetch", {
          jobId,
          totalPages: pageCount,
        });
        break;
      }

      pageToken = batch.nextPageToken;

      // Add a small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.info("Finished fetching and queueing emails", {
      jobId,
      totalPages: pageCount,
    });
  } catch (error) {
    logger.error("Error in fetching and queueing loop", { error, jobId });
    throw error;
  }
}
