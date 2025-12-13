import { serve } from "inngest/next";
import { inngest } from "@/utils/inngest/client";
import { allFunctions } from "@/utils/inngest/functions";
import { env } from "@/env";

// Create the Inngest serve handler for Next.js App Router
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
  // For self-hosted Inngest, we need to explicitly provide the signing key
  // The SDK will use this to verify requests from the Inngest server
  signingKey: env.INNGEST_SIGNING_KEY,
});
