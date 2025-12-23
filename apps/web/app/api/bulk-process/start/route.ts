import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { startBulkProcessSchema } from "@/utils/bulk-process/validation";
import {
  createBulkProcessJob,
  markJobAsRunning,
} from "@/utils/bulk-process/job-manager";
import { inngest } from "@/utils/inngest/client";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("api/bulk-process/start");

export const maxDuration = 30; // Reduced - we just trigger Inngest now

export const POST = withEmailProvider(async (request) => {
  const { userId, emailAccountId } = request.auth;

  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = startBulkProcessSchema.parse(body);

    // Note: Premium check removed - premium is enabled for all users in this fork

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
      forceReprocess: validatedData.forceReprocess,
    });

    logger.info("Created bulk process job", {
      jobId: job.id,
      emailAccountId,
      startDate: validatedData.startDate,
      endDate: validatedData.endDate,
    });

    // Mark job as running
    await markJobAsRunning(job.id);

    // Trigger the durable Inngest fetcher function
    // This will handle pagination, token refresh, and resilient queuing
    await inngest.send({
      name: "inbox-zero/bulk-process.fetcher",
      data: {
        jobId: job.id,
        emailAccountId,
        startDate: validatedData.startDate.toISOString(),
        endDate: validatedData.endDate?.toISOString(),
        onlyUnread: validatedData.onlyUnread,
        forceReprocess: validatedData.forceReprocess,
        pageToken: undefined,
        pageCount: 0,
      },
    });

    logger.info("Triggered bulk process fetcher", {
      jobId: job.id,
      emailAccountId,
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
