import { serve } from "inngest/next";
import { inngest } from "@/utils/inngest/client";
import { allFunctions } from "@/utils/inngest/functions";

// Create the Inngest serve handler for Next.js App Router
// For self-hosted Inngest, we use servePath and landingPage to work with the local server
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
  servePath: "/api/inngest",
  landingPage: false, // Disable landing page for production
});
