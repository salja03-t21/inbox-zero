import { Inngest } from "inngest";
import { env } from "@/env";

// Create Inngest client for self-hosted Inngest server
// For self-hosted servers that require authentication, we need to set the eventKey
// The baseUrl is automatically read from INNGEST_BASE_URL env var by the SDK
export const inngest = new Inngest({
  id: "inbox-zero",
  // Event key is required when self-hosted Inngest server is configured with INNGEST_EVENT_KEY
  eventKey: env.INNGEST_EVENT_KEY,
});

// Helper to check if Inngest is configured
export function isInngestConfigured(): boolean {
  return Boolean(
    env.INNGEST_BASE_URL || (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY),
  );
}
