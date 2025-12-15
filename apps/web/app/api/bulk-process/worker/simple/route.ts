import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { withError } from "@/utils/middleware";
import { bulkProcessWorkerSchema } from "@/utils/bulk-process/validation";
import { processEmail } from "@/utils/bulk-process/worker";
import { env } from "@/env";
import { isValidInternalApiKey } from "@/utils/internal-api";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("api/bulk-process/worker/simple");

export const maxDuration = 300; // 5 minutes

/**
 * Simple worker endpoint for local development without QStash
 * This endpoint is only called when QSTASH_TOKEN is not set
 */
export const POST = withError(async (request: NextRequest) => {
  if (env.QSTASH_TOKEN) {
    return NextResponse.json({
      error: "Qstash is set. This endpoint is disabled.",
    });
  }

  if (!isValidInternalApiKey(await headers(), logger)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    logger.info("Simple bulk process worker request received");

    // Parse and validate the payload
    const rawPayload = await request.json();
    const validationResult = bulkProcessWorkerSchema.safeParse(rawPayload);

    if (!validationResult.success) {
      logger.error("Invalid payload structure", {
        errors: validationResult.error.errors,
        receivedPayload: rawPayload,
      });
      return NextResponse.json(
        { error: "Invalid payload structure" },
        { status: 400 },
      );
    }

    const payload = validationResult.data;

    logger.info("Processing bulk email (simple)", {
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
      return NextResponse.json({ success: true });
    }

    if (result.skipped) {
      logger.info("Email skipped", {
        jobId: payload.jobId,
        messageId: payload.messageId,
        reason: result.reason,
      });
      return NextResponse.json({ success: true, skipped: true });
    }

    logger.error("Failed to process email", {
      jobId: payload.jobId,
      messageId: payload.messageId,
      error: result.error,
    });
    return NextResponse.json(
      { error: `Email processing failed: ${result.error}` },
      { status: 500 },
    );
  } catch (error) {
    logger.error("Simple worker error", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
