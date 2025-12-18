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
const missingSubsLogger = createScopedLogger(
  "inngest/create-missing-subscriptions",
);

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

/**
 * Inngest cron function to create webhook subscriptions for Microsoft accounts
 * that are enabled but have no active subscription.
 *
 * This handles cases where:
 * 1. Database was reset but accounts remain
 * 2. Subscription expired and wasn't renewed
 * 3. Account setup was incomplete
 *
 * Runs every 15 minutes to quickly catch accounts with missing subscriptions.
 * Rate limited to max 10 accounts per run to avoid overwhelming the API.
 */
export const createMissingOutlookSubscriptions = inngest.createFunction(
  {
    id: "create-missing-outlook-subscriptions",
    retries: 2,
  },
  // Run every 15 minutes
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const results = await step.run("create-missing-subscriptions", async () => {
      // Find Microsoft email accounts that are enabled but have no subscription
      // Limit to 10 accounts per run to avoid rate limiting
      const accountsMissingSubscriptions = await prisma.emailAccount.findMany({
        where: {
          enabled: true,
          OR: [
            { watchEmailsSubscriptionId: null },
            { watchEmailsSubscriptionId: "" },
          ],
          account: {
            provider: { in: ["microsoft", "azure-ad"] },
            access_token: { not: null },
            refresh_token: { not: null },
          },
          // Only process accounts for users with premium/AI access
          user: {
            premium: {
              OR: [
                { lemonSqueezyRenewsAt: { gt: new Date() } },
                { stripeSubscriptionStatus: { in: ["active", "trialing"] } },
                { tier: "LIFETIME" },
              ],
            },
          },
        },
        select: {
          id: true,
          email: true,
          user: {
            select: {
              aiApiKey: true,
              premium: { select: { tier: true } },
            },
          },
        },
        take: 10, // Max 10 per run to avoid API rate limits
        orderBy: {
          createdAt: "asc", // Process oldest accounts first
        },
      });

      missingSubsLogger.info("Found accounts missing subscriptions", {
        count: accountsMissingSubscriptions.length,
      });

      if (accountsMissingSubscriptions.length === 0) {
        return {
          created: 0,
          failed: 0,
          errors: [] as string[],
        };
      }

      const processed = {
        created: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const emailAccount of accountsMissingSubscriptions) {
        try {
          // Verify user has AI access before creating subscription
          const userHasAiAccess = hasAiAccess(
            emailAccount.user.premium?.tier || null,
            emailAccount.user.aiApiKey,
          );

          if (!userHasAiAccess) {
            missingSubsLogger.info("User does not have AI access, skipping", {
              email: emailAccount.email,
            });
            continue;
          }

          missingSubsLogger.info("Creating subscription for account", {
            emailAccountId: emailAccount.id,
            email: emailAccount.email,
          });

          const expirationDate = await createManagedOutlookSubscription(
            emailAccount.id,
          );

          if (expirationDate) {
            missingSubsLogger.info("Successfully created subscription", {
              email: emailAccount.email,
              expirationDate,
            });
            processed.created++;
          } else {
            missingSubsLogger.warn("Failed to create subscription (no error)", {
              email: emailAccount.email,
            });
            processed.failed++;
            processed.errors.push(
              `${emailAccount.email}: No subscription returned`,
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          // Expected errors that we shouldn't retry
          const expectedErrors = [
            "invalid_grant",
            "Token refresh failed",
            "Access token expired",
          ];

          if (expectedErrors.some((e) => errorMessage.includes(e))) {
            missingSubsLogger.warn("Token error for account, skipping", {
              email: emailAccount.email,
              error: errorMessage,
            });
          } else {
            missingSubsLogger.error("Failed to create subscription", {
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

    missingSubsLogger.info("Create missing subscriptions complete", results);

    return results;
  },
);
