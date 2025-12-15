/* eslint-disable no-process-env */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // this is your Sentry.init call from `sentry.server.config.js|ts`
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      // Adjust this value in production, or use tracesSampler for greater control
      tracesSampleRate: 1,
      // Setting this option to true will print useful information to the console while you're setting up Sentry.
      debug: false,
      // uncomment the line below to enable Spotlight (https://spotlightjs.com)
      // spotlight: process.env.NODE_ENV === 'development',
    });

    // Auto-start the scheduled action cleanup cycle on app startup
    // This sends the initial event to bootstrap the self-perpetuating cleanup cycle
    // The cleanup function will then schedule itself every 5 minutes
    //
    // Note: This may run multiple times if there are multiple worker processes,
    // but that's OK - the cleanup function is idempotent and the duplicate events
    // will just trigger extra cleanup runs which won't hurt anything
    try {
      const { inngest } = await import("./utils/inngest/client");
      const { createScopedLogger } = await import("./utils/logger");
      const logger = createScopedLogger("instrumentation");

      await inngest.send({
        name: "inbox-zero/cleanup.scheduled-actions",
        data: {
          scheduledBy: "auto-start",
          triggeredBy: "system-initialization",
          timestamp: new Date().toISOString(),
        },
      });

      logger.info(
        "Scheduled action cleanup cycle auto-started on app initialization",
      );
    } catch (error) {
      console.error("Failed to auto-start cleanup cycle:", error);
      // Don't throw - we don't want to prevent app startup if this fails
    }
  }

  // This is your Sentry.init call from `sentry.edge.config.js|ts`
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      // Adjust this value in production, or use tracesSampler for greater control
      tracesSampleRate: 1,
      // Setting this option to true will print useful information to the console while you're setting up Sentry.
      debug: false,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
