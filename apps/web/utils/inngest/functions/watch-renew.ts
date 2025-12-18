import { inngest } from "../client";
import prisma from "@/utils/prisma";
import { createManagedOutlookSubscription } from "@/utils/outlook/subscription-manager";
import { createScopedLogger } from "@/utils/logger";
import { hasAiAccess } from "@/utils/premium";
import { createEmailProvider } from "@/utils/email/provider";
import { watchEmails } from "@/app/api/watch/controller";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import { addDays } from "date-fns";

const logger = createScopedLogger("inngest/watch-renew");

/**
 * Inngest cron function to renew webhook subscriptions for all premium users.
 * Runs every 12 hours to ensure subscriptions don't expire (Microsoft subscriptions last 3 days max).
 */
export const watchRenew = inngest.createFunction(
  {
    id: "watch-renew",
    // Retry configuration
    retries: 3,
  },
  // Run every 12 hours
  { cron: "0 */12 * * *" },
  async ({ step }) => {
    const results = await step.run("renew-subscriptions", async () => {
      // Find all email accounts that need watching
      // Include users with:
      // - Active Lemon Squeezy subscription
      // - Active Stripe subscription
      // - LIFETIME tier
      const emailAccounts = await prisma.emailAccount.findMany({
        where: {
          user: {
            premium: {
              OR: [
                { lemonSqueezyRenewsAt: { gt: new Date() } },
                { stripeSubscriptionStatus: { in: ["active", "trialing"] } },
                { tier: "LIFETIME" },
              ],
            },
          },
          account: {
            access_token: { not: null },
            refresh_token: { not: null },
          },
        },
        select: {
          id: true,
          email: true,
          watchEmailsExpirationDate: true,
          watchEmailsSubscriptionId: true,
          account: {
            select: {
              provider: true,
              access_token: true,
              refresh_token: true,
              expires_at: true,
            },
          },
          user: {
            select: {
              aiApiKey: true,
              aiBaseUrl: true,
              premium: { select: { tier: true } },
            },
          },
        },
        orderBy: {
          watchEmailsExpirationDate: { sort: "asc", nulls: "first" },
        },
      });

      logger.info("Processing watch renewals", { count: emailAccounts.length });

      const processed = {
        renewed: 0,
        skipped: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const emailAccount of emailAccounts) {
        try {
          // Check if user has AI access
          const userHasAiAccess = hasAiAccess(
            emailAccount.user.premium?.tier || null,
            emailAccount.user.aiApiKey,
          );

          if (!userHasAiAccess) {
            logger.info("User does not have AI access, skipping", {
              email: emailAccount.email,
            });
            processed.skipped++;
            continue;
          }

          // Check if subscription needs renewal (expires in less than 1 day or doesn't exist)
          const needsRenewal =
            !emailAccount.watchEmailsExpirationDate ||
            !emailAccount.watchEmailsSubscriptionId ||
            new Date(emailAccount.watchEmailsExpirationDate) <
              addDays(new Date(), 1);

          if (!needsRenewal) {
            logger.info("Subscription still valid, skipping", {
              email: emailAccount.email,
              expirationDate: emailAccount.watchEmailsExpirationDate,
            });
            processed.skipped++;
            continue;
          }

          logger.info("Renewing subscription", {
            emailAccountId: emailAccount.id,
            email: emailAccount.email,
            provider: emailAccount.account.provider,
          });

          if (isMicrosoftProvider(emailAccount.account.provider)) {
            await createManagedOutlookSubscription(emailAccount.id);
          } else {
            const provider = await createEmailProvider({
              emailAccountId: emailAccount.id,
              provider: emailAccount.account.provider,
            });

            await watchEmails({
              emailAccountId: emailAccount.id,
              provider,
            });
          }

          processed.renewed++;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          // Don't fail the whole job for individual account errors
          const warn = [
            "invalid_grant",
            "Mail service not enabled",
            "Insufficient Permission",
          ];

          if (warn.some((w) => errorMessage.includes(w))) {
            logger.warn("Expected error for user, skipping", {
              email: emailAccount.email,
              error: errorMessage,
            });
            processed.skipped++;
          } else {
            logger.error("Failed to renew subscription", {
              email: emailAccount.email,
              error: errorMessage,
            });
            processed.failed++;
            processed.errors.push(`${emailAccount.email}: ${errorMessage}`);
          }
        }
      }

      return processed;
    });

    logger.info("Watch renewal complete", results);

    return results;
  },
);
