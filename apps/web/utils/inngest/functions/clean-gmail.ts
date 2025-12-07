import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import { z } from "zod";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { GmailLabel, labelThread } from "@/utils/gmail/label";
import { SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";
import { isDefined } from "@/utils/types";
import { CleanAction } from "@prisma/client";
import { updateThread } from "@/utils/redis/clean";

const logger = createScopedLogger("inngest/clean-gmail");

const cleanGmailPayload = z.object({
  emailAccountId: z.string(),
  threadId: z.string(),
  markDone: z.boolean(),
  action: z.enum([CleanAction.ARCHIVE, CleanAction.MARK_READ]),
  markedDoneLabelId: z.string().optional(),
  processedLabelId: z.string().optional(),
  jobId: z.string(),
});

export type CleanGmailPayload = z.infer<typeof cleanGmailPayload>;

export const cleanGmail = inngest.createFunction(
  {
    id: "clean-gmail",
    retries: 3,
  },
  { event: "inbox-zero/clean.gmail" },
  async ({ event, step }) => {
    const payload = cleanGmailPayload.parse(event.data);

    logger.info("Processing Gmail clean request", {
      emailAccountId: payload.emailAccountId,
      threadId: payload.threadId,
      jobId: payload.jobId,
    });

    const result = await step.run("perform-gmail-action", async () => {
      const {
        emailAccountId,
        threadId,
        markDone,
        markedDoneLabelId,
        processedLabelId,
        jobId,
        action,
      } = payload;

      // Get Gmail account
      const account = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          account: {
            select: {
              access_token: true,
              refresh_token: true,
              expires_at: true,
            },
          },
        },
      });

      if (!account) throw new SafeError("User not found", 404);
      if (!account.account?.access_token || !account.account?.refresh_token)
        throw new SafeError("No Gmail account found", 404);

      // Initialize Gmail client
      const gmail = await getGmailClientWithRefresh({
        accessToken: account.account.access_token,
        refreshToken: account.account.refresh_token,
        expiresAt: account.account.expires_at?.getTime() || null,
        emailAccountId,
      });

      const shouldArchive = markDone && action === CleanAction.ARCHIVE;
      const shouldMarkAsRead = markDone && action === CleanAction.MARK_READ;

      // Build label operations
      const addLabelIds = [
        processedLabelId,
        markDone ? markedDoneLabelId : undefined,
      ].filter(isDefined);

      const removeLabelIds = [
        shouldArchive ? GmailLabel.INBOX : undefined,
        shouldMarkAsRead ? GmailLabel.UNREAD : undefined,
      ].filter(isDefined);

      logger.info("Applying Gmail labels", {
        threadId,
        shouldArchive,
        shouldMarkAsRead,
        addLabelIds,
        removeLabelIds,
      });

      // Apply labels to thread
      await labelThread({
        gmail,
        threadId,
        addLabelIds,
        removeLabelIds,
      });

      // Save result to database
      await saveCleanResult({
        emailAccountId,
        threadId,
        markDone,
        jobId,
      });

      logger.info("Gmail clean action completed", {
        emailAccountId,
        threadId,
        shouldArchive,
        shouldMarkAsRead,
      });

      return {
        success: true,
        threadId,
        archived: shouldArchive,
        markAsRead: shouldMarkAsRead,
      };
    });

    return result;
  },
);

async function saveCleanResult({
  emailAccountId,
  threadId,
  markDone,
  jobId,
}: {
  emailAccountId: string;
  threadId: string;
  markDone: boolean;
  jobId: string;
}) {
  await Promise.all([
    updateThread({
      emailAccountId,
      jobId,
      threadId,
      update: { status: "completed" },
    }),
    saveToDatabase({
      emailAccountId,
      threadId,
      archive: markDone,
      jobId,
    }),
  ]);
}

async function saveToDatabase({
  emailAccountId,
  threadId,
  archive,
  jobId,
}: {
  emailAccountId: string;
  threadId: string;
  archive: boolean;
  jobId: string;
}) {
  await prisma.cleanupThread.create({
    data: {
      emailAccount: { connect: { id: emailAccountId } },
      threadId,
      archived: archive,
      job: { connect: { id: jobId } },
    },
  });
}
