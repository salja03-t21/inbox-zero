import { serve } from "inngest/next";
import { inngest } from "@/utils/inngest/client";
import { allFunctions } from "@/utils/inngest/functions";

// Create the Inngest serve handler for Next.js App Router
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
});
