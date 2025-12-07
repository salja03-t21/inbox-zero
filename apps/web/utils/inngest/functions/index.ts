// All Inngest functions will be exported from here
// Import individual functions as they are created

import { bulkProcessWorker } from "./bulk-process-worker";
import { scheduledActionExecute } from "./scheduled-action-execute";
import { cleanProcess } from "./clean-process";
import { cleanGmail } from "./clean-gmail";
import { cleanOutlook } from "./clean-outlook";
import { categorizeSendersBatch } from "./categorize-senders-batch";
import { aiDigest } from "./ai-digest";
import { resendDigest } from "./resend-digest";

// Export all Inngest functions
export const allFunctions = [
  // Phase 3.1: Bulk processing
  bulkProcessWorker,
  // Phase 3.7: Scheduled actions
  scheduledActionExecute,
  // Phase 3.3, 3.4, 3.5: Clean operations
  cleanProcess,
  cleanGmail,
  cleanOutlook,
  // Phase 3.2, 3.6, 3.8: Digest and categorization
  categorizeSendersBatch,
  aiDigest,
  resendDigest,
];
