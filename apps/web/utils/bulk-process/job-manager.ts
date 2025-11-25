import prisma from "@/utils/prisma";
import { BulkProcessJobStatus } from "@prisma/client";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("bulk-process-job-manager");

export interface CreateJobParams {
  emailAccountId: string;
  userId: string;
  startDate: Date;
  endDate?: Date;
  onlyUnread: boolean;
}

export interface UpdateJobProgressParams {
  jobId: string;
  totalEmails?: number;
  processedEmails?: number;
  failedEmails?: number;
}

/**
 * Create a new bulk processing job
 */
export async function createBulkProcessJob(params: CreateJobParams) {
  const { emailAccountId, userId, startDate, endDate, onlyUnread } = params;

  // Check if there's already an active job for this account
  const existingJob = await prisma.bulkProcessJob.findFirst({
    where: {
      emailAccountId,
      status: {
        in: [BulkProcessJobStatus.PENDING, BulkProcessJobStatus.RUNNING],
      },
    },
  });

  if (existingJob) {
    throw new Error(
      "A bulk processing job is already running for this account. Please wait for it to complete or cancel it.",
    );
  }

  const job = await prisma.bulkProcessJob.create({
    data: {
      emailAccountId,
      userId,
      startDate,
      endDate,
      onlyUnread,
      status: BulkProcessJobStatus.PENDING,
    },
  });

  logger.info("Created bulk process job", {
    jobId: job.id,
    emailAccountId,
    startDate,
    endDate,
  });

  return job;
}

/**
 * Get a bulk processing job by ID
 */
export async function getBulkProcessJob(jobId: string) {
  return prisma.bulkProcessJob.findUnique({
    where: { id: jobId },
    include: {
      emailAccount: {
        select: {
          email: true,
        },
      },
    },
  });
}

/**
 * Update the status of a bulk processing job
 */
export async function updateJobStatus(
  jobId: string,
  status: BulkProcessJobStatus,
  error?: string,
) {
  const data: {
    status: BulkProcessJobStatus;
    completedAt?: Date;
    error?: string;
  } = {
    status,
  };

  if (
    status === BulkProcessJobStatus.COMPLETED ||
    status === BulkProcessJobStatus.FAILED ||
    status === BulkProcessJobStatus.CANCELLED
  ) {
    data.completedAt = new Date();
  }

  if (error) {
    data.error = error;
  }

  return prisma.bulkProcessJob.update({
    where: { id: jobId },
    data,
  });
}

/**
 * Mark job as running
 */
export async function markJobAsRunning(jobId: string) {
  return updateJobStatus(jobId, BulkProcessJobStatus.RUNNING);
}

/**
 * Mark job as completed
 */
export async function markJobAsCompleted(jobId: string) {
  return updateJobStatus(jobId, BulkProcessJobStatus.COMPLETED);
}

/**
 * Mark job as failed
 */
export async function markJobAsFailed(jobId: string, error: string) {
  return updateJobStatus(jobId, BulkProcessJobStatus.FAILED, error);
}

/**
 * Mark job as cancelled
 */
export async function markJobAsCancelled(jobId: string) {
  return updateJobStatus(jobId, BulkProcessJobStatus.CANCELLED);
}

/**
 * Update job progress counters (atomic increment)
 */
export async function updateJobProgress(params: UpdateJobProgressParams) {
  const { jobId, totalEmails, processedEmails, failedEmails } = params;

  const updateData: Record<string, unknown> = {};

  if (totalEmails !== undefined) {
    updateData.totalEmails = { increment: totalEmails };
  }
  if (processedEmails !== undefined) {
    updateData.processedEmails = { increment: processedEmails };
  }
  if (failedEmails !== undefined) {
    updateData.failedEmails = { increment: failedEmails };
  }

  return prisma.bulkProcessJob.update({
    where: { id: jobId },
    data: updateData,
  });
}

/**
 * Increment total emails counter
 */
export async function incrementTotalEmails(jobId: string, count: number) {
  return updateJobProgress({ jobId, totalEmails: count });
}

/**
 * Increment processed emails counter
 */
export async function incrementProcessedEmails(jobId: string) {
  return updateJobProgress({ jobId, processedEmails: 1 });
}

/**
 * Increment failed emails counter
 */
export async function incrementFailedEmails(jobId: string) {
  return updateJobProgress({ jobId, failedEmails: 1 });
}

/**
 * Check if job is cancelled
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const job = await prisma.bulkProcessJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  return job?.status === BulkProcessJobStatus.CANCELLED;
}

/**
 * Verify that the job belongs to the user's email account
 */
export async function verifyJobOwnership(
  jobId: string,
  emailAccountId: string,
): Promise<boolean> {
  const job = await prisma.bulkProcessJob.findUnique({
    where: { id: jobId },
    select: { emailAccountId: true },
  });

  return job?.emailAccountId === emailAccountId;
}
