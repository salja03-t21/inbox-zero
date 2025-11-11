-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "isSharedMailbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharedMailboxOwner" TEXT;
