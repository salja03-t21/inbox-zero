import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import { z } from "zod";
import { getThreadsFromSenderWithSubject } from "@/utils/gmail/thread";
import {
  categorizeWithAi,
  getCategories,
  updateSenderCategory,
} from "@/utils/categorize/senders/categorize";
import { validateUserAndAiAccess } from "@/utils/user/validate";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { UNKNOWN_CATEGORY } from "@/utils/ai/categorize-sender/ai-categorize-senders";
import prisma from "@/utils/prisma";
import { saveCategorizationProgress } from "@/utils/redis/categorization-progress";
import { SafeError } from "@/utils/error";

const logger = createScopedLogger("inngest/categorize-senders-batch");

// Validation schema for the event payload
const categorizeSendersBatchSchema = z.object({
  emailAccountId: z.string(),
  senders: z.array(z.string()),
});

type CategorizeSendersBatchPayload = z.infer<
  typeof categorizeSendersBatchSchema
>;

/**
 * Inngest function for batch categorizing email senders
 * Replaces the QStash endpoint at /api/user/categorize/senders/batch
 *
 * Event: inbox-zero/categorize.senders-batch
 * Payload: { emailAccountId, senders: string[] }
 *
 * Features:
 * - Per-user concurrency control (max 3 concurrent batches per user)
 * - Fetches 3 sample messages per sender
 * - Uses AI to categorize senders
 * - Updates database with categorization results
 * - Tracks progress in Redis
 */
export const categorizeSendersBatch = inngest.createFunction(
  {
    id: "categorize-senders-batch",
    retries: 3,
    // 5 minute timeout to match the original route.ts maxDuration
    timeouts: { finish: "5m" },
    // Per-user concurrency control: max 3 concurrent batches per emailAccountId
    concurrency: {
      limit: 3,
      key: "event.data.emailAccountId",
    },
  },
  { event: "inbox-zero/categorize.senders-batch" },
  async ({ event, step }) => {
    // Validate payload
    const validationResult = categorizeSendersBatchSchema.safeParse(event.data);
    if (!validationResult.success) {
      logger.error("Invalid payload", {
        errors: validationResult.error.errors,
        receivedPayload: event.data,
      });
      throw new Error("Invalid payload structure");
    }

    const payload: CategorizeSendersBatchPayload = validationResult.data;
    const { emailAccountId, senders } = payload;

    logger.info("Processing sender categorization batch", {
      emailAccountId,
      senderCount: senders.length,
    });

    // Perform the categorization in a step for durability
    const result = await step.run("categorize-batch", async () => {
      // Validate user and AI access
      const userResult = await validateUserAndAiAccess({ emailAccountId });
      const { emailAccount } = userResult;

      // Get available categories for this user
      const categoriesResult = await getCategories({ emailAccountId });
      const { categories } = categoriesResult;

      // Get email account with OAuth tokens
      const emailAccountWithAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          account: {
            select: {
              access_token: true,
              refresh_token: true,
              expires_at: true,
              provider: true,
            },
          },
        },
      });

      const account = emailAccountWithAccount?.account;

      if (!account) throw new SafeError("No account found");
      if (!account.access_token || !account.refresh_token)
        throw new SafeError("No access or refresh token");

      // Initialize Gmail client with token refresh capability
      const gmail = await getGmailClientWithRefresh({
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        expiresAt: account.expires_at?.getTime() || null,
        emailAccountId,
      });

      // Fetch 3 sample messages for each sender
      const sendersWithEmails: Map<
        string,
        { subject: string; snippet: string }[]
      > = new Map();

      for (const sender of senders) {
        const threadsFromSender = await getThreadsFromSenderWithSubject(
          gmail,
          account.access_token,
          sender,
          3,
        );
        sendersWithEmails.set(sender, threadsFromSender);
      }

      logger.info("Fetched sample messages for senders", {
        emailAccountId,
        senderCount: senders.length,
      });

      // Categorize senders using AI
      const results = await categorizeWithAi({
        emailAccount: {
          ...emailAccount,
          account: { provider: account.provider },
        },
        sendersWithEmails,
        categories,
      });

      logger.info("AI categorization completed", {
        emailAccountId,
        categorizedCount: results.length,
      });

      // Save categorized senders to database
      for (const result of results) {
        await updateSenderCategory({
          sender: result.sender,
          categories,
          categoryName: result.category ?? UNKNOWN_CATEGORY,
          emailAccountId,
        });
      }

      // Update progress tracking in Redis
      await saveCategorizationProgress({
        emailAccountId,
        incrementCompleted: senders.length,
      });

      logger.info("Sender categorization batch completed", {
        emailAccountId,
        senderCount: senders.length,
      });

      return {
        success: true,
        categorizedCount: results.length,
        senderCount: senders.length,
      };
    });

    return result;
  },
);
