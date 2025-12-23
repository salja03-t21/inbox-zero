// All Inngest functions will be exported from here
// Import individual functions as they are created

import { bulkProcessWorker } from "./bulk-process-worker";
import { bulkProcessFetcher } from "./bulk-process-fetcher";
import { scheduledActionExecute } from "./scheduled-action-execute";
import { scheduledActionCleanup } from "./scheduled-action-cleanup";
import { cleanProcess } from "./clean-process";
import { cleanGmail } from "./clean-gmail";
import { cleanOutlook } from "./clean-outlook";
import { categorizeSendersBatch } from "./categorize-senders-batch";
import { aiDigest } from "./ai-digest";
import { resendDigest } from "./resend-digest";
import { watchRenew, createMissingOutlookSubscriptions } from "./watch-renew";

// Export all Inngest functions
export const allFunctions = [
  // Phase 3.1: Bulk processing
  bulkProcessWorker,
  bulkProcessFetcher,
  // Phase 3.7: Scheduled actions
  scheduledActionExecute,
  scheduledActionCleanup,
  // Phase 3.3, 3.4, 3.5: Clean operations
  cleanProcess,
  cleanGmail,
  cleanOutlook,
  // Phase 3.2, 3.6, 3.8: Digest and categorization
  categorizeSendersBatch,
  aiDigest,
  resendDigest,
  // Webhook subscription renewal (runs every 12 hours)
  watchRenew,
  // Create missing Outlook subscriptions (runs every 15 minutes)
  createMissingOutlookSubscriptions,
];
