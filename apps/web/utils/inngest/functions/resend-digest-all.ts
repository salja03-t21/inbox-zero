import { inngest } from "../client";
import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";
import subDays from "date-fns/subDays";

const logger = createScopedLogger("inngest/resend-digest-all");

/**
 * Inngest cron function to trigger digest emails for all eligible accounts.
 * Replaces the external cron trigger for /api/resend/digest/all.
 *
 * Runs every hour to find accounts whose nextOccurrenceAt is in the past
 * and fires an inbox-zero/resend.digest event for each one.
 */
export const resendDigestAll = inngest.createFunction(
  {
    id: "resend-digest-all",
    retries: 1,
  },
  { cron: "0 * * * *" }, // Every hour
  async ({ step }) => {
    const results = await step.run("find-and-trigger-digests", async () => {
      const now = new Date();

      // Find all email accounts that are due for a digest
      const emailAccounts = await prisma.emailAccount.findMany({
        where: {
          digestSchedule: {
            nextOccurrenceAt: { lte: now },
          },
          createdAt: {
            lt: subDays(now, 1),
          },
        },
        select: {
          id: true,
          email: true,
        },
      });

      logger.info("Found accounts due for digest", {
        count: emailAccounts.length,
      });

      return emailAccounts;
    });

    if (results.length === 0) {
      return { triggered: 0 };
    }

    // Send a resend.digest event for each account
    await inngest.send(
      results.map((account) => ({
        name: "inbox-zero/resend.digest" as const,
        data: { emailAccountId: account.id },
      })),
    );

    logger.info("Triggered digest emails", { count: results.length });

    return { triggered: results.length };
  },
);
