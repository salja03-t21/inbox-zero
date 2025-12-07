import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import type { NextRequest } from "next/server";
import { withError } from "@/utils/middleware";
import { bulkProcessWorkerSchema } from "@/utils/bulk-process/validation";
import { processEmail } from "@/utils/bulk-process/worker";
import { createScopedLogger } from "@/utils/logger";
import { INTERNAL_API_KEY_HEADER } from "@/utils/internal-api";
import { env } from "@/env";

const logger = createScopedLogger("api/bulk-process/worker");

export const maxDuration = 300; // 5 minutes

/**
 * Worker endpoint for processing individual emails in bulk jobs
 * Supports both QStash webhooks and direct internal calls (Inngest fallback)
 */
export const POST = withError(async (request: NextRequest) => {
  // Check if this is an internal call (Inngest fallback mode)
  const internalKey = request.headers.get(INTERNAL_API_KEY_HEADER);
  if (internalKey === env.INTERNAL_API_KEY) {
    logger.info("Processing bulk email via internal API");
    return handleRequest(request);
  }

  // Otherwise, verify QStash signature
  logger.info("Processing bulk email via QStash");
  return verifySignatureAppRouter(handleRequest)(request);
});

async function handleRequest(request: NextRequest) {
  try {
    logger.info("Bulk process worker request received", {
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
    logger.error("Worker error", { error });
    return new Response("Internal server error", { status: 500 });
  }
}
