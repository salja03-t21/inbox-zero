import type { z } from "zod";
import { after, NextResponse } from "next/server";
import { withError } from "@/utils/middleware";
import { processHistoryForUser } from "@/app/api/outlook/webhook/process-history";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { env } from "@/env";
import { webhookBodySchema } from "@/app/api/outlook/webhook/types";
import { handleWebhookError } from "@/utils/webhook/error-handler";
import { getWebhookEmailAccount } from "@/utils/webhook/validate-webhook-account";
import { attemptSubscriptionRecovery } from "@/utils/outlook/subscription-recovery";

export const maxDuration = 300;

export const POST = withError(async (request) => {
  const searchParams = new URL(request.url).searchParams;
  const validationToken = searchParams.get("validationToken");

  const logger = createScopedLogger("outlook/webhook");

  if (validationToken) {
    logger.info("Received validation request", { validationToken });
    return new NextResponse(validationToken, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  const rawBody = await request.json();

  const parseResult = webhookBodySchema.safeParse(rawBody);

  if (!parseResult.success) {
    logger.error("Invalid webhook payload", {
      body: rawBody,
      errors: parseResult.error.errors,
    });
    return NextResponse.json(
      {
        error: "Invalid webhook payload",
        details: parseResult.error.errors,
      },
      { status: 400 },
    );
  }

  const body = parseResult.data;

  // Validate clientState for security (verify webhook is from Microsoft)
  // If clientState is invalid, attempt to auto-recover the subscription
  const invalidNotifications: string[] = [];
  for (const notification of body.value) {
    if (notification.clientState !== env.MICROSOFT_WEBHOOK_CLIENT_STATE) {
      logger.warn("Invalid or missing clientState - attempting auto-recovery", {
        receivedClientState: notification.clientState,
        hasExpectedClientState: !!env.MICROSOFT_WEBHOOK_CLIENT_STATE,
        subscriptionId: notification.subscriptionId,
      });
      invalidNotifications.push(notification.subscriptionId);
    }
  }

  // If any notifications had invalid clientState, trigger recovery asynchronously
  // and return 200 OK to acknowledge receipt (prevents Microsoft from retrying)
  if (invalidNotifications.length > 0) {
    // Deduplicate subscription IDs
    const uniqueSubscriptionIds = Array.from(new Set(invalidNotifications));

    // Trigger recovery in the background
    after(async () => {
      for (const subscriptionId of uniqueSubscriptionIds) {
        const result = await attemptSubscriptionRecovery(
          subscriptionId,
          logger,
        );
        if (result.recovered) {
          logger.info("Successfully recovered stale subscription", {
            subscriptionId,
            emailAccountId: result.emailAccountId,
          });
        }
      }
    });

    // Return 200 OK to acknowledge - don't return 403 as that causes retries
    // The stale webhook notification itself is not processed, but we've triggered recovery
    return NextResponse.json({
      ok: true,
      recovered: invalidNotifications.length,
    });
  }

  logger.info("Received webhook notification - acknowledging immediately", {
    notificationCount: body.value.length,
    subscriptionIds: body.value.map((n) => n.subscriptionId),
  });

  const notifications = body.value;

  // Process notifications asynchronously using after() to avoid Microsoft webhook timeout
  // Microsoft expects a response within 3 seconds
  after(() => processNotificationsAsync(notifications, logger));

  return NextResponse.json({ ok: true });
});

async function processNotificationsAsync(
  notifications: z.infer<typeof webhookBodySchema>["value"],
  log: Logger,
) {
  for (const notification of notifications) {
    const { subscriptionId, resourceData } = notification;
    const logger = log.with({ subscriptionId, messageId: resourceData.id });

    logger.info("Processing notification", {
      changeType: notification.changeType,
    });

    try {
      await processHistoryForUser({
        subscriptionId,
        resourceData,
        logger,
      });
    } catch (error) {
      const emailAccount = await getWebhookEmailAccount(
        { watchEmailsSubscriptionId: subscriptionId },
        logger,
      ).catch((error) => {
        logger.error("Error getting email account", {
          error: error instanceof Error ? error.message : error,
        });
        return null;
      });

      if (emailAccount?.email) {
        await handleWebhookError(error, {
          email: emailAccount.email,
          url: "/api/outlook/webhook",
          logger,
        });
      } else {
        logger.error("Error processing notification (no email account found)", {
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }
}
