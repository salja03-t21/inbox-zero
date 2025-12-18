import prisma from "@/utils/prisma";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { createManagedOutlookSubscription } from "@/utils/outlook/subscription-manager";
import { captureException } from "@/utils/error";

const logger = createScopedLogger("outlook/subscription-recovery");

// In-memory cache to prevent hammering the same subscription
// Maps subscriptionId -> timestamp of last recovery attempt
const recoveryAttemptCache = new Map<string, number>();
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between recovery attempts for same subscription

/**
 * Attempts to recover a stale Outlook subscription by looking up the email account
 * and forcing a subscription refresh.
 *
 * This is called when we receive a webhook with an invalid clientState,
 * which typically means the subscription was created with a different secret
 * or has become stale after a deployment.
 */
export async function attemptSubscriptionRecovery(
  subscriptionId: string,
  parentLogger?: Logger,
): Promise<{ recovered: boolean; emailAccountId?: string }> {
  const log =
    parentLogger?.with({ subscriptionId }) || logger.with({ subscriptionId });

  // Check cooldown to prevent hammering
  const lastAttempt = recoveryAttemptCache.get(subscriptionId);
  const now = Date.now();

  if (lastAttempt && now - lastAttempt < RECOVERY_COOLDOWN_MS) {
    log.trace("Skipping recovery - cooldown active", {
      lastAttemptMs: now - lastAttempt,
      cooldownMs: RECOVERY_COOLDOWN_MS,
    });
    return { recovered: false };
  }

  // Mark this attempt
  recoveryAttemptCache.set(subscriptionId, now);

  // Clean up old entries (prevent memory leak)
  if (recoveryAttemptCache.size > 1000) {
    const oldestAllowed = now - RECOVERY_COOLDOWN_MS * 2;
    for (const [id, timestamp] of recoveryAttemptCache.entries()) {
      if (timestamp < oldestAllowed) {
        recoveryAttemptCache.delete(id);
      }
    }
  }

  try {
    // Find the email account with this stale subscription
    const emailAccount = await prisma.emailAccount.findFirst({
      where: { watchEmailsSubscriptionId: subscriptionId },
      select: {
        id: true,
        email: true,
        enabled: true,
        account: {
          select: {
            provider: true,
          },
        },
        user: {
          select: {
            premium: {
              select: {
                lemonSqueezyRenewsAt: true,
                stripeSubscriptionStatus: true,
              },
            },
          },
        },
      },
    });

    if (!emailAccount) {
      log.warn(
        "No email account found for stale subscription - cannot recover",
      );
      return { recovered: false };
    }

    // Only recover Microsoft/Outlook accounts
    if (emailAccount.account?.provider !== "microsoft") {
      log.info("Skipping recovery - not a Microsoft account", {
        provider: emailAccount.account?.provider,
      });
      return { recovered: false, emailAccountId: emailAccount.id };
    }

    // Don't recover disabled accounts
    if (emailAccount.enabled === false) {
      log.info("Skipping recovery - account is disabled");
      return { recovered: false, emailAccountId: emailAccount.id };
    }

    log.info("Attempting to recover stale subscription", {
      emailAccountId: emailAccount.id,
      email: emailAccount.email,
    });

    // Force refresh the subscription
    const newExpirationDate = await createManagedOutlookSubscription(
      emailAccount.id,
    );

    if (newExpirationDate) {
      log.info("Successfully recovered subscription", {
        emailAccountId: emailAccount.id,
        newExpirationDate,
      });
      return { recovered: true, emailAccountId: emailAccount.id };
    } else {
      log.warn(
        "Failed to recover subscription - createManagedOutlookSubscription returned null",
        {
          emailAccountId: emailAccount.id,
        },
      );
      return { recovered: false, emailAccountId: emailAccount.id };
    }
  } catch (error) {
    log.error("Error during subscription recovery", {
      error: error instanceof Error ? error.message : String(error),
    });
    captureException(error);
    return { recovered: false };
  }
}
