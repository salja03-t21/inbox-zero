import { createScopedLogger } from "@/utils/logger";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type {
  AutoGenerateOptions,
  AutoGenerateResult,
  GeneratedKnowledgeEntry,
  PipelineProgress,
} from "./types";
import { preprocessSentEmails } from "./preprocess";
import { clusterEmails } from "./cluster";
import { extractPatterns } from "./extract-patterns";
import { generateKnowledgeEntries } from "./generate-entries";
import { deduplicateEntries } from "./deduplicate";

const logger = createScopedLogger("auto-generate-knowledge");

export interface RunPipelineOptions extends AutoGenerateOptions {
  emailAccount: EmailAccountWithAI;
  existingKnowledge?: Array<{ id: string; title: string; content: string }>;
}

/**
 * Main orchestrator for the auto-generate knowledge pipeline
 *
 * Pipeline stages:
 * 1. Preprocessing: Fetch and filter sent emails
 * 2. Clustering: Group emails by topic/sender using AI
 * 3. Pattern Extraction: Extract response patterns from each cluster
 * 4. Entry Generation: Convert patterns into knowledge entries
 * 5. Deduplication: Remove/merge similar entries
 */
export async function runAutoGenerateKnowledgePipeline(
  options: RunPipelineOptions,
): Promise<AutoGenerateResult> {
  const {
    emailAccountId,
    startDate,
    endDate,
    maxEntries = 20,
    groupBy = "both",
    onProgress,
    emailAccount,
    existingKnowledge = [],
  } = options;

  const startTime = Date.now();

  logger.info("Starting auto-generate knowledge pipeline", {
    emailAccountId,
    startDate,
    endDate,
    maxEntries,
    groupBy,
  });

  try {
    // Stage 1: Preprocessing
    logger.info("Stage 1: Preprocessing");
    const preprocessResult = await preprocessSentEmails({
      emailAccountId,
      provider: emailAccount.account.provider,
      startDate,
      endDate,
      maxEmails: 500, // Fetch up to 500 emails
      onProgress,
    });

    if (preprocessResult.emails.length === 0) {
      logger.warn("No emails found after preprocessing");
      return {
        success: true,
        entries: [],
        stats: {
          totalEmailsScanned: preprocessResult.totalFetched,
          emailsAfterFiltering: 0,
          clustersFound: 0,
          entriesGenerated: 0,
          entriesMerged: 0,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }

    // Stage 2: Clustering
    logger.info("Stage 2: Clustering");
    const clusterResult = await clusterEmails({
      snippets: preprocessResult.snippets,
      emailAccount,
      groupBy,
      onProgress,
    });

    if (clusterResult.clusters.length === 0) {
      logger.warn("No clusters identified");
      return {
        success: true,
        entries: [],
        stats: {
          totalEmailsScanned: preprocessResult.totalFetched,
          emailsAfterFiltering: preprocessResult.emails.length,
          clustersFound: 0,
          entriesGenerated: 0,
          entriesMerged: 0,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }

    // Stage 3: Pattern Extraction
    logger.info("Stage 3: Pattern Extraction");
    const patterns = await extractPatterns({
      clusters: clusterResult.clusters,
      emails: preprocessResult.emails,
      emailAccount,
      onProgress,
    });

    // Stage 4: Entry Generation
    logger.info("Stage 4: Entry Generation");
    const rawEntries = await generateKnowledgeEntries({
      patterns,
      emails: preprocessResult.emails,
      emailAccount,
      onProgress,
    });

    // Stage 5: Deduplication
    logger.info("Stage 5: Deduplication");
    const dedupResult = await deduplicateEntries({
      entries: rawEntries,
      emailAccount,
      existingKnowledge,
      onProgress,
    });

    // Limit to maxEntries, sorted by confidence
    const finalEntries = dedupResult.entries
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxEntries);

    const result: AutoGenerateResult = {
      success: true,
      entries: finalEntries,
      stats: {
        totalEmailsScanned: preprocessResult.totalFetched,
        emailsAfterFiltering: preprocessResult.emails.length,
        clustersFound: clusterResult.clusters.length,
        entriesGenerated: rawEntries.length,
        entriesMerged: dedupResult.mergedCount,
        processingTimeMs: Date.now() - startTime,
      },
    };

    logger.info("Pipeline complete", {
      ...result.stats,
      finalEntries: finalEntries.length,
    });

    return result;
  } catch (error) {
    logger.error("Pipeline failed", { error });

    return {
      success: false,
      entries: [],
      stats: {
        totalEmailsScanned: 0,
        emailsAfterFiltering: 0,
        clustersFound: 0,
        entriesGenerated: 0,
        entriesMerged: 0,
        processingTimeMs: Date.now() - startTime,
      },
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Re-export types for convenience
export type {
  AutoGenerateOptions,
  AutoGenerateResult,
  GeneratedKnowledgeEntry,
  PipelineProgress,
} from "./types";
