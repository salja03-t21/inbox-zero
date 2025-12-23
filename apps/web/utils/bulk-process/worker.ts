import { createScopedLogger } from "@/utils/logger";
import {
  incrementProcessedEmails,
  incrementFailedEmails,
  isJobCancelled,
  checkAndMarkJobComplete,
} from "./job-manager";
import { runRules } from "@/utils/ai/choose-rule/run-rules";
import prisma from "@/utils/prisma";
import { createEmailProvider } from "@/utils/email/provider";
import { getEmailAccountWithAi } from "@/utils/user/get";

const logger = createScopedLogger("bulk-process-worker");

export interface ProcessEmailParams {
  jobId: string;
  emailAccountId: string;
  messageId: string;
  threadId: string;
  forceReprocess?: boolean;
}

/**
 * Process a single email as part of a bulk processing job
 * This is called by the QStash worker endpoint
 */
export async function processEmail(params: ProcessEmailParams) {
  const { jobId, emailAccountId, messageId, threadId, forceReprocess } = params;

  logger.info("Processing email", {
    jobId,
    emailAccountId,
    messageId,
    threadId,
  });

  try {
    // Check if job was cancelled
    const cancelled = await isJobCancelled(jobId);
    if (cancelled) {
      logger.info("Job cancelled, skipping email", { jobId, messageId });
      return {
        success: false,
        skipped: true,
        reason: "Job cancelled",
      };
    }

    // Get email account with AI config
    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
    if (!emailAccount) {
      throw new Error("Email account not found");
    }

    // Create email provider
    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider: emailAccount.account.provider,
    });

    // Fetch the message
    const message = await emailProvider.getMessage(messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // Check if rules already executed for this message (skip check if forceReprocess is true)
    if (!forceReprocess) {
      const existingRules = await prisma.executedRule.findMany({
        where: {
          emailAccountId,
          threadId,
          messageId,
        },
      });

      if (existingRules.length > 0) {
        logger.info("Rules already executed, skipping", { messageId });
        await incrementProcessedEmails(jobId);
        await checkAndMarkJobComplete(jobId);
        return {
          success: true,
          skipped: true,
          reason: "Already processed",
        };
      }
    } else {
      logger.info(
        "Force reprocess enabled, running rules regardless of previous execution",
        { messageId },
      );
    }

    // Get enabled rules for this account
    const rules = await prisma.rule.findMany({
      where: {
        emailAccountId,
        enabled: true,
      },
      include: { actions: true },
    });

    if (rules.length === 0) {
      logger.info("No rules configured for account", { emailAccountId });
      await incrementProcessedEmails(jobId);
      await checkAndMarkJobComplete(jobId);
      return {
        success: true,
        skipped: true,
        reason: "No rules configured",
      };
    }

    // Run rules on the message
    const results = await runRules({
      isTest: false,
      provider: emailProvider,
      message,
      rules,
      emailAccount,
      modelType: "chat",
    });

    logger.info("Rules executed successfully", {
      jobId,
      messageId,
      rulesMatched: results.length,
    });

    // Increment processed counter and check if job is complete
    await incrementProcessedEmails(jobId);
    await checkAndMarkJobComplete(jobId);

    return {
      success: true,
      skipped: false,
      rulesMatched: results.length,
    };
  } catch (error) {
    logger.error("Error processing email", {
      error,
      jobId,
      messageId,
      threadId,
    });

    // Increment failed counter and check if job is complete
    await incrementFailedEmails(jobId);
    await checkAndMarkJobComplete(jobId);

    return {
      success: false,
      skipped: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
