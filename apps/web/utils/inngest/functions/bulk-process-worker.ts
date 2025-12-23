import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import { processEmail } from "@/utils/bulk-process/worker";
import { bulkProcessWorkerSchema } from "@/utils/bulk-process/validation";

const logger = createScopedLogger("inngest/bulk-process-worker");

/**
 * Inngest function for processing individual emails in bulk jobs
 * Replaces the QStash worker endpoint
 *
 * Event: inbox-zero/bulk-process.worker
 * Payload: { jobId, emailAccountId, messageId, threadId }
 */
export const bulkProcessWorker = inngest.createFunction(
  {
    id: "bulk-process-worker",
    retries: 3,
    // 5 minute timeout to match the original route.ts maxDuration
    timeouts: { finish: "5m" },
    // Per-user concurrency control: max 3 concurrent bulk processing jobs per emailAccountId
    // This prevents overwhelming the Microsoft Graph API with too many concurrent requests
    concurrency: {
      limit: 3,
      key: "event.data.emailAccountId",
    },
  },
  { event: "inbox-zero/bulk-process.worker" },
  async ({ event, step }) => {
    // Validate payload
    const validationResult = bulkProcessWorkerSchema.safeParse(event.data);
    if (!validationResult.success) {
      logger.error("Invalid payload", {
        errors: validationResult.error.errors,
        receivedPayload: event.data,
      });
      throw new Error("Invalid payload structure");
    }

    const payload = validationResult.data;

    logger.info("Processing bulk email", {
      jobId: payload.jobId,
      messageId: payload.messageId,
      threadId: payload.threadId,
    });

    // Process the email using step.run for durability
    const result = await step.run("process-email", async () => {
      return processEmail({
        jobId: payload.jobId,
        emailAccountId: payload.emailAccountId,
        messageId: payload.messageId,
        threadId: payload.threadId,
        forceReprocess: payload.forceReprocess,
      });
    });

    // Log the result based on success/failure and skipped status
    if (result.success && !result.skipped) {
      // Successfully processed with rules matched
      logger.info("Successfully processed email", {
        jobId: payload.jobId,
        messageId: payload.messageId,
        skipped: false,
        rulesMatched:
          "rulesMatched" in result ? result.rulesMatched : undefined,
      });
    } else if (result.skipped) {
      // Skipped (either success=true or success=false with skip)
      logger.info("Email skipped", {
        jobId: payload.jobId,
        messageId: payload.messageId,
        reason: "reason" in result ? result.reason : "Unknown",
      });
    } else {
      // Failed with error
      const errorMessage = "error" in result ? result.error : "Unknown error";
      logger.error("Failed to process email", {
        jobId: payload.jobId,
        messageId: payload.messageId,
        error: errorMessage,
      });
      // Throw error to trigger Inngest retry
      throw new Error(`Email processing failed: ${errorMessage}`);
    }

    return result;
  },
);
