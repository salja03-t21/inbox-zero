"use server";

import prisma from "@/utils/prisma";
import {
  createKnowledgeBody,
  updateKnowledgeBody,
  deleteKnowledgeBody,
  startAutoGenerateBody,
  approveGeneratedKnowledgeBody,
  rejectGeneratedKnowledgeBody,
  updateKnowledgeSettingsBody,
} from "@/utils/actions/knowledge.validation";
import { actionClient } from "@/utils/actions/safe-action";
import { getEmailAccountWithAi } from "@/utils/user/get";
import { runAutoGenerateKnowledgePipeline } from "@/utils/ai/knowledge/auto-generate";
import type { GeneratedKnowledgeEntry } from "@/utils/ai/knowledge/auto-generate/types";
import { createKnowledgeContentHash } from "@/utils/ai/knowledge/auto-generate/generate-entries";
import { SafeError } from "@/utils/error";
import { checkAIRateLimit } from "@/utils/ai/rate-limit";

export const createKnowledgeAction = actionClient
  .metadata({ name: "createKnowledge" })
  .schema(createKnowledgeBody)
  .action(
    async ({ ctx: { emailAccountId }, parsedInput: { title, content } }) => {
      await prisma.knowledge.create({
        data: {
          title,
          content,
          emailAccountId,
        },
      });
    },
  );

export const updateKnowledgeAction = actionClient
  .metadata({ name: "updateKnowledge" })
  .schema(updateKnowledgeBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { id, title, content },
    }) => {
      await prisma.knowledge.update({
        where: { id, emailAccountId },
        data: { title, content },
      });
    },
  );

export const deleteKnowledgeAction = actionClient
  .metadata({ name: "deleteKnowledge" })
  .schema(deleteKnowledgeBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { id } }) => {
    await prisma.knowledge.delete({
      where: { id, emailAccountId },
    });
  });

// Auto-generate knowledge actions

export const startAutoGenerateKnowledgeAction = actionClient
  .metadata({ name: "startAutoGenerateKnowledge" })
  .schema(startAutoGenerateBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { startDate, endDate, maxEntries, groupBy },
    }) => {
      // Rate limit: 100 auto-generate requests per hour per account
      await checkAIRateLimit(emailAccountId, "auto-generate-knowledge", {
        limit: 100,
        windowSeconds: 3600,
      });

      // Get email account with AI settings
      const emailAccount = await getEmailAccountWithAi({ emailAccountId });
      if (!emailAccount) {
        throw new SafeError("Email account not found");
      }

      // Check for existing running job
      const existingJob = await prisma.knowledgeExtractionJob.findFirst({
        where: {
          emailAccountId,
          status: { in: ["PENDING", "RUNNING"] },
        },
      });

      if (existingJob) {
        throw new SafeError("An extraction job is already in progress");
      }

      // Create job record
      const job = await prisma.knowledgeExtractionJob.create({
        data: {
          emailAccountId,
          status: "RUNNING",
          triggerType: "MANUAL",
          startDate,
          endDate: endDate ?? new Date(),
        },
      });

      try {
        // Get existing knowledge for deduplication
        const existingKnowledge = await prisma.knowledge.findMany({
          where: { emailAccountId },
          select: { id: true, title: true, content: true },
        });

        // Run the pipeline
        const result = await runAutoGenerateKnowledgePipeline({
          emailAccountId,
          startDate,
          endDate,
          maxEntries,
          groupBy,
          emailAccount,
          existingKnowledge,
        });

        if (!result.success) {
          await prisma.knowledgeExtractionJob.update({
            where: { id: job.id },
            data: {
              status: "FAILED",
              error: result.error,
              completedAt: new Date(),
            },
          });

          throw new SafeError(result.error || "Pipeline failed");
        }

        // Update job with results
        await prisma.knowledgeExtractionJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            totalEmails: result.stats.totalEmailsScanned,
            processedEmails: result.stats.emailsAfterFiltering,
            entriesCreated: result.entries.length,
            completedAt: new Date(),
          },
        });

        // Check if auto-approve is enabled
        const settings = await prisma.emailAccount.findUnique({
          where: { id: emailAccountId },
          select: { knowledgeAutoApprove: true },
        });

        if (settings?.knowledgeAutoApprove && result.entries.length > 0) {
          // Auto-approve: create knowledge entries immediately
          await createKnowledgeEntriesFromGenerated(
            emailAccountId,
            result.entries,
          );

          logger.info("Auto-approved knowledge entries", {
            count: result.entries.length,
          });
        }

        // Update last extraction timestamp
        await prisma.emailAccount.update({
          where: { id: emailAccountId },
          data: { lastKnowledgeExtractionAt: new Date() },
        });

        return {
          jobId: job.id,
          entries: result.entries,
          stats: result.stats,
          autoApproved: settings?.knowledgeAutoApprove ?? false,
        };
      } catch (error) {
        // Update job status on error
        await prisma.knowledgeExtractionJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          },
        });

        throw error;
      }
    },
  );

export const approveGeneratedKnowledgeAction = actionClient
  .metadata({ name: "approveGeneratedKnowledge" })
  .schema(approveGeneratedKnowledgeBody)
  .action(
    async ({ ctx: { emailAccountId, logger }, parsedInput: { entries } }) => {
      // Validate we don't have too many entries at once
      if (entries.length > 50) {
        throw new SafeError("Cannot approve more than 50 entries at once");
      }

      // Create the knowledge entries - map validated input to GeneratedKnowledgeEntry
      const entriesToCreate: GeneratedKnowledgeEntry[] = entries.map(
        (entry) => ({
          title: entry.title,
          content: entry.content,
          topic: entry.topic ?? null,
          groupType: entry.groupType ?? "TOPIC",
          senderPattern: entry.senderPattern ?? null,
          sourceEmailCount: entry.sourceEmailCount ?? 0,
          confidence: entry.confidence,
          keywords: entry.keywords ?? [],
          sourceEmailIds: entry.sourceEmailIds ?? [],
        }),
      );

      const createdEntries = await createKnowledgeEntriesFromGenerated(
        emailAccountId,
        entriesToCreate,
      );

      logger.info("Approved knowledge entries", {
        count: createdEntries.length,
        emailAccountId,
      });

      return { approved: createdEntries.length };
    },
  );

export const rejectGeneratedKnowledgeAction = actionClient
  .metadata({ name: "rejectGeneratedKnowledge" })
  .schema(rejectGeneratedKnowledgeBody)
  .action(
    async ({ ctx: { emailAccountId, logger }, parsedInput: { jobId } }) => {
      // Get the job and verify ownership
      const job = await prisma.knowledgeExtractionJob.findUnique({
        where: { id: jobId, emailAccountId },
      });

      if (!job) {
        throw new SafeError("Job not found");
      }

      // Mark as rejected by setting entries to 0
      await prisma.knowledgeExtractionJob.update({
        where: { id: jobId },
        data: { entriesCreated: 0 },
      });

      logger.info("Rejected all entries", { jobId });

      return { rejected: true };
    },
  );

export const updateKnowledgeSettingsAction = actionClient
  .metadata({ name: "updateKnowledgeSettings" })
  .schema(updateKnowledgeSettingsBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { knowledgeExtractionEnabled, knowledgeAutoApprove },
    }) => {
      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: {
          ...(knowledgeExtractionEnabled !== undefined && {
            knowledgeExtractionEnabled,
          }),
          ...(knowledgeAutoApprove !== undefined && { knowledgeAutoApprove }),
        },
      });
    },
  );

// Helper function to create knowledge entries from generated entries
async function createKnowledgeEntriesFromGenerated(
  emailAccountId: string,
  entries: GeneratedKnowledgeEntry[],
) {
  const createPromises = entries.map((entry) =>
    prisma.knowledge.create({
      data: {
        title: entry.title,
        content: entry.content,
        source: "AUTO",
        status: "ACTIVE",
        topic: entry.topic,
        groupType: entry.groupType,
        senderPattern: entry.senderPattern,
        sourceEmailCount: entry.sourceEmailCount,
        contentHash: createKnowledgeContentHash(entry.content),
        autoMetadata: {
          confidence: entry.confidence,
          keywords: entry.keywords,
          sourceEmailIds: entry.sourceEmailIds,
        },
        emailAccountId,
      },
    }),
  );

  return Promise.all(createPromises);
}
