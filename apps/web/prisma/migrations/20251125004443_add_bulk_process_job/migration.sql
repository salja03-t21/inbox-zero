-- CreateEnum
CREATE TYPE "BulkProcessJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BulkProcessJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BulkProcessJobStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "onlyUnread" BOOLEAN NOT NULL DEFAULT true,
    "totalEmails" INTEGER NOT NULL DEFAULT 0,
    "processedEmails" INTEGER NOT NULL DEFAULT 0,
    "failedEmails" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "BulkProcessJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkProcessJob_emailAccountId_status_idx" ON "BulkProcessJob"("emailAccountId", "status");

-- CreateIndex
CREATE INDEX "BulkProcessJob_userId_status_idx" ON "BulkProcessJob"("userId", "status");

-- CreateIndex
CREATE INDEX "BulkProcessJob_status_createdAt_idx" ON "BulkProcessJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "BulkProcessJob" ADD CONSTRAINT "BulkProcessJob_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkProcessJob" ADD CONSTRAINT "BulkProcessJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
