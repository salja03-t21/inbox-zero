import { Inngest } from "inngest";
import { env } from "@/env";

// Create Inngest client - only active when INNGEST_EVENT_KEY is configured
export const inngest = new Inngest({
  id: "inbox-zero",
  // For self-hosted Inngest, we need to explicitly set the event key
  // This tells the SDK to use the self-hosted server instead of cloud
  eventKey: env.INNGEST_EVENT_KEY,
  // baseUrl is set via INNGEST_BASE_URL env var automatically by the SDK
});

// Helper to check if Inngest is configured
export function isInngestConfigured(): boolean {
  return Boolean(env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY);
}
