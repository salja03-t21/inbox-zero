import { NextResponse, type NextRequest } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import { getBulkProcessJob, verifyJobOwnership } from "@/utils/bulk-process/job-manager";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("api/bulk-process/status");

export const dynamic = "force-dynamic";

export const GET = withEmailAccount(
  async (request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) => {
    const { emailAccountId } = request.auth;
    const { jobId } = await params;

    try {
      // Verify job ownership
      const hasAccess = await verifyJobOwnership(jobId, emailAccountId);
      if (!hasAccess) {
        return NextResponse.json(
          { error: "Job not found or access denied" },
          { status: 404 },
        );
      }

      // Get job details
      const job = await getBulkProcessJob(jobId);
      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      // Return job status and progress
      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        totalEmails: job.totalEmails,
        processedEmails: job.processedEmails,
        failedEmails: job.failedEmails,
        startDate: job.startDate,
        endDate: job.endDate,
        onlyUnread: job.onlyUnread,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error,
      });
    } catch (error) {
      logger.error("Error fetching job status", { error, jobId });
      return NextResponse.json(
        { error: "Failed to fetch job status" },
        { status: 500 },
      );
    }
  },
);

export type BulkProcessStatusResponse = {
  jobId: string;
  status: string;
  totalEmails: number;
  processedEmails: number;
  failedEmails: number;
  startDate: Date;
  endDate: Date | null;
  onlyUnread: boolean;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
};
