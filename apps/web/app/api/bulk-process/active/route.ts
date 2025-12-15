import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import { getActiveBulkProcessJob } from "@/utils/bulk-process/job-manager";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("api/bulk-process/active");

export const dynamic = "force-dynamic";

export const GET = withEmailAccount(async (request) => {
  const { emailAccountId } = request.auth;

  try {
    const job = await getActiveBulkProcessJob(emailAccountId);

    if (!job) {
      return NextResponse.json({ job: null });
    }

    return NextResponse.json({
      job: {
        jobId: job.id,
        status: job.status,
        totalEmails: job.totalEmails,
        emailsQueued: job.emailsQueued,
        processedEmails: job.processedEmails,
        failedEmails: job.failedEmails,
        startDate: job.startDate,
        endDate: job.endDate,
        onlyUnread: job.onlyUnread,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error,
      },
    });
  } catch (error) {
    logger.error("Error fetching active job", { error, emailAccountId });
    return NextResponse.json(
      { error: "Failed to fetch active job" },
      { status: 500 },
    );
  }
});

export type ActiveBulkProcessJobResponse = {
  job: {
    jobId: string;
    status: string;
    totalEmails: number;
    emailsQueued: number;
    processedEmails: number;
    failedEmails: number;
    startDate: Date;
    endDate: Date | null;
    onlyUnread: boolean;
    createdAt: Date;
    completedAt: Date | null;
    error: string | null;
  } | null;
};
