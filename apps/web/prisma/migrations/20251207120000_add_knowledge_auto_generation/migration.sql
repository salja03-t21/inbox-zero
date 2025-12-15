-- CreateEnum
CREATE TYPE "KnowledgeSource" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('PENDING', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeGroupType" AS ENUM ('TOPIC', 'SENDER');

-- CreateEnum
CREATE TYPE "KnowledgeExtractionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeExtractionTriggerType" AS ENUM ('MANUAL', 'SCHEDULED');

-- AlterTable: Add new columns to Knowledge table
ALTER TABLE "Knowledge" ADD COLUMN "source" "KnowledgeSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Knowledge" ADD COLUMN "status" "KnowledgeStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Knowledge" ADD COLUMN "topic" TEXT;
ALTER TABLE "Knowledge" ADD COLUMN "groupType" "KnowledgeGroupType";
ALTER TABLE "Knowledge" ADD COLUMN "senderPattern" TEXT;
ALTER TABLE "Knowledge" ADD COLUMN "sourceEmailCount" INTEGER;
ALTER TABLE "Knowledge" ADD COLUMN "autoMetadata" JSONB;
ALTER TABLE "Knowledge" ADD COLUMN "contentHash" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeExtractionJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "KnowledgeExtractionJobStatus" NOT NULL DEFAULT 'PENDING',
    "triggerType" "KnowledgeExtractionTriggerType" NOT NULL DEFAULT 'MANUAL',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "totalEmails" INTEGER NOT NULL DEFAULT 0,
    "processedEmails" INTEGER NOT NULL DEFAULT 0,
    "entriesCreated" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "emailAccountId" TEXT NOT NULL,

    CONSTRAINT "KnowledgeExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeExtractionJob_emailAccountId_status_idx" ON "KnowledgeExtractionJob"("emailAccountId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeExtractionJob_emailAccountId_createdAt_idx" ON "KnowledgeExtractionJob"("emailAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "KnowledgeExtractionJob" ADD CONSTRAINT "KnowledgeExtractionJob_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: Add indexes for Knowledge table queries
CREATE INDEX "Knowledge_emailAccountId_source_idx" ON "Knowledge"("emailAccountId", "source");
CREATE INDEX "Knowledge_emailAccountId_status_idx" ON "Knowledge"("emailAccountId", "status");
CREATE INDEX "Knowledge_contentHash_idx" ON "Knowledge"("contentHash");

-- AlterTable: Add knowledge extraction settings to EmailAccount
ALTER TABLE "EmailAccount" ADD COLUMN "knowledgeExtractionEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailAccount" ADD COLUMN "knowledgeAutoApprove" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailAccount" ADD COLUMN "lastKnowledgeExtractionAt" TIMESTAMP(3);
