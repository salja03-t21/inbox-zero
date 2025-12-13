import { Inngest } from "inngest";
import { env } from "@/env";

// Create Inngest client for self-hosted Inngest server
// NOTE: For self-hosted, we DON'T set eventKey - that's only for Inngest Cloud
// The SDK will automatically use dev/self-hosted mode when INNGEST_BASE_URL is set
export const inngest = new Inngest({
  id: "inbox-zero",
  // baseUrl is set via INNGEST_BASE_URL env var automatically by the SDK
  // When INNGEST_BASE_URL is set, the SDK uses self-hosted mode
});

// Helper to check if Inngest is configured
export function isInngestConfigured(): boolean {
  return Boolean(env.INNGEST_BASE_URL || (env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY));
}
