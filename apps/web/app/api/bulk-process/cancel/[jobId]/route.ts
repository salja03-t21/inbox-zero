import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import {
  verifyJobOwnership,
  markJobAsCancelled,
  getBulkProcessJob,
} from "@/utils/bulk-process/job-manager";
import { createScopedLogger } from "@/utils/logger";
import { BulkProcessJobStatus } from "@prisma/client";

const logger = createScopedLogger("api/bulk-process/cancel");

export const POST = withEmailAccount(async (request, { params }) => {
  const { emailAccountId } = request.auth;
  const { jobId } = await (params as Promise<{ jobId: string }>);

  try {
    // Verify job ownership
    const hasAccess = await verifyJobOwnership(jobId, emailAccountId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Job not found or access denied" },
        { status: 404 },
      );
    }

    // Get current job state
    const job = await getBulkProcessJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Only allow cancelling PENDING or RUNNING jobs
    if (
      job.status !== BulkProcessJobStatus.PENDING &&
      job.status !== BulkProcessJobStatus.RUNNING
    ) {
      return NextResponse.json(
        { error: `Cannot cancel job with status: ${job.status}` },
        { status: 400 },
      );
    }

    // Mark job as cancelled
    const updatedJob = await markJobAsCancelled(jobId);

    logger.info("Job cancelled", { jobId, emailAccountId });

    return NextResponse.json({
      jobId: updatedJob.id,
      status: updatedJob.status,
      message: "Job cancelled successfully",
    });
  } catch (error) {
    logger.error("Error cancelling job", { error, jobId });
    return NextResponse.json(
      { error: "Failed to cancel job" },
      { status: 500 },
    );
  }
});
