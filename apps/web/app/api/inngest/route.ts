import { serve } from "inngest/next";
import { inngest } from "@/utils/inngest/client";
import { allFunctions } from "@/utils/inngest/functions";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("api/inngest");

// Track if we've already sent the initial cleanup event to avoid duplicates
let cleanupEventSent = false;

// Create the Inngest serve handler for Next.js App Router
const handler = serve({
  client: inngest,
  functions: allFunctions,
});

// Wrap the PUT handler to send cleanup event after successful registration
const originalPUT = handler.PUT;
const wrappedPUT: typeof originalPUT = async (req, ctx) => {
  const response = await originalPUT(req, ctx);

  // Kickstart the cleanup cycle after any PUT call (only once)
  // Note: We don't check response.status because self-hosted Inngest may return errors
  // during sync (like "Error deleting removed function") but functions still work fine
  if (!cleanupEventSent) {
    try {
      await inngest.send({
        name: "inbox-zero/cleanup.scheduled-actions",
        data: {
          scheduledBy: "auto-start",
          triggeredBy: "function-registration",
          timestamp: new Date().toISOString(),
        },
      });

      cleanupEventSent = true;
      logger.info(
        "Scheduled action cleanup cycle kickstarted after function registration",
      );
    } catch (error) {
      logger.error("Failed to kickstart cleanup cycle after registration", {
        error,
      });
    }
  }

  return response;
};

export const { GET, POST } = handler;
export const PUT = wrappedPUT;
