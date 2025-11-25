import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import type { NextRequest } from "next/server";
import { withError } from "@/utils/middleware";
import { bulkProcessWorkerSchema } from "@/utils/bulk-process/validation";
import { processEmail } from "@/utils/bulk-process/worker";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("api/bulk-process/worker");

export const maxDuration = 300; // 5 minutes

/**
 * QStash worker endpoint for processing individual emails in bulk jobs
 * This endpoint is called by QStash for each email that needs processing
 */
export const POST = verifySignatureAppRouter(
  withError(async (request: NextRequest) => {
    try {
      logger.info("QStash bulk process worker request received", {
        url: request.url,
        method: request.method,
      });

      // Parse and validate the payload
      const rawPayload = await request.json();
      const validationResult = bulkProcessWorkerSchema.safeParse(rawPayload);

      if (!validationResult.success) {
        logger.error("Invalid payload structure", {
          errors: validationResult.error.errors,
          receivedPayload: rawPayload,
        });
        return new Response("Invalid payload structure", { status: 400 });
      }

      const payload = validationResult.data;

      logger.info("Processing bulk email", {
        jobId: payload.jobId,
        messageId: payload.messageId,
        threadId: payload.threadId,
      });

      // Process the email
      const result = await processEmail({
        jobId: payload.jobId,
        emailAccountId: payload.emailAccountId,
        messageId: payload.messageId,
        threadId: payload.threadId,
      });

      if (result.success) {
        logger.info("Successfully processed email", {
          jobId: payload.jobId,
          messageId: payload.messageId,
          skipped: result.skipped,
        });
        return new Response("Email processed successfully", { status: 200 });
      }

      if (result.skipped) {
        logger.info("Email skipped", {
          jobId: payload.jobId,
          messageId: payload.messageId,
          reason: result.reason,
        });
        return new Response(`Email skipped: ${result.reason}`, {
          status: 200,
        });
      }

      logger.error("Failed to process email", {
        jobId: payload.jobId,
        messageId: payload.messageId,
        error: result.error,
      });
      return new Response(`Email processing failed: ${result.error}`, {
        status: 500,
      });
    } catch (error) {
      logger.error("QStash worker error", { error });
      return new Response("Internal server error", { status: 500 });
    }
  }),
);
