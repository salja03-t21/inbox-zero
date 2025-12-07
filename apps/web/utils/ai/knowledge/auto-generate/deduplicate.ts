import { z } from "zod";
import { createScopedLogger } from "@/utils/logger";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { getModel } from "@/utils/llms/model";
import { createGenerateObject } from "@/utils/llms";
import type {
  GeneratedKnowledgeEntry,
  DeduplicationResult,
  PipelineProgress,
} from "./types";
import { createKnowledgeContentHash } from "./generate-entries";

const logger = createScopedLogger("knowledge-deduplicate");

const SIMILARITY_BATCH_SIZE = 10; // Compare entries in batches

export interface DeduplicateOptions {
  entries: GeneratedKnowledgeEntry[];
  emailAccount: EmailAccountWithAI;
  existingKnowledge?: Array<{ id: string; title: string; content: string }>;
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Stage 5: Deduplication
 * - Identifies similar entries and merges them
 * - Checks against existing knowledge base entries
 * - Removes low-confidence duplicates
 */
export async function deduplicateEntries(
  options: DeduplicateOptions,
): Promise<DeduplicationResult> {
  const { entries, emailAccount, existingKnowledge = [], onProgress } = options;

  logger.info("Starting deduplication", {
    newEntryCount: entries.length,
    existingKnowledgeCount: existingKnowledge.length,
  });

  let mergedCount = 0;
  let removedCount = 0;

  // Step 1: Quick hash-based deduplication
  const hashDeduped = hashBasedDeduplication(entries);
  removedCount += entries.length - hashDeduped.length;

  logger.info("Hash-based deduplication complete", {
    before: entries.length,
    after: hashDeduped.length,
    removed: entries.length - hashDeduped.length,
  });

  // Step 2: AI-based similarity check and merge
  const { entries: aiDeduped, merged } = await aiBasedDeduplication(
    hashDeduped,
    emailAccount,
    onProgress,
  );
  mergedCount += merged;

  logger.info("AI-based deduplication complete", {
    before: hashDeduped.length,
    after: aiDeduped.length,
    merged,
  });

  // Step 3: Check against existing knowledge
  const { entries: finalEntries, removed } = await filterExistingKnowledge(
    aiDeduped,
    existingKnowledge,
    emailAccount,
  );
  removedCount += removed;

  logger.info("Deduplication complete", {
    finalEntryCount: finalEntries.length,
    totalMerged: mergedCount,
    totalRemoved: removedCount,
  });

  return {
    entries: finalEntries,
    mergedCount,
    removedCount,
  };
}

/**
 * Quick hash-based deduplication for exact or near-exact matches
 */
function hashBasedDeduplication(
  entries: GeneratedKnowledgeEntry[],
): GeneratedKnowledgeEntry[] {
  const seen = new Map<string, GeneratedKnowledgeEntry>();

  for (const entry of entries) {
    const hash = createKnowledgeContentHash(entry.content);

    const existing = seen.get(hash);
    if (!existing || entry.confidence > existing.confidence) {
      seen.set(hash, entry);
    }
  }

  return Array.from(seen.values());
}

/**
 * AI-based similarity detection and merging
 */
async function aiBasedDeduplication(
  entries: GeneratedKnowledgeEntry[],
  emailAccount: EmailAccountWithAI,
  onProgress?: (progress: PipelineProgress) => void,
): Promise<{ entries: GeneratedKnowledgeEntry[]; merged: number }> {
  if (entries.length <= 1) {
    return { entries, merged: 0 };
  }

  // For small sets, check all pairs
  if (entries.length <= SIMILARITY_BATCH_SIZE) {
    return await findAndMergeSimilar(entries, emailAccount);
  }

  // For larger sets, process in batches
  const batches = createBatches(entries, SIMILARITY_BATCH_SIZE);
  let allEntries: GeneratedKnowledgeEntry[] = [];
  let totalMerged = 0;

  for (let i = 0; i < batches.length; i++) {
    onProgress?.({
      stage: "deduplication",
      stageProgress: Math.round(((i + 1) / batches.length) * 100),
      totalEmails: 0,
      processedEmails: 0,
      entriesGenerated: entries.length,
    });

    const { entries: batchEntries, merged } = await findAndMergeSimilar(
      batches[i],
      emailAccount,
    );
    allEntries.push(...batchEntries);
    totalMerged += merged;
  }

  // Do a final pass to catch cross-batch duplicates
  if (allEntries.length > SIMILARITY_BATCH_SIZE) {
    const { entries: finalEntries, merged } = await findAndMergeSimilar(
      allEntries.slice(0, SIMILARITY_BATCH_SIZE * 2),
      emailAccount,
    );
    // Combine with remaining entries
    allEntries = [
      ...finalEntries,
      ...allEntries.slice(SIMILARITY_BATCH_SIZE * 2),
    ];
    totalMerged += merged;
  }

  return { entries: allEntries, merged: totalMerged };
}

async function findAndMergeSimilar(
  entries: GeneratedKnowledgeEntry[],
  emailAccount: EmailAccountWithAI,
): Promise<{ entries: GeneratedKnowledgeEntry[]; merged: number }> {
  const modelOptions = getModel(emailAccount.user, "default");

  const generateObject = createGenerateObject({
    userEmail: emailAccount.email,
    label: "Knowledge Deduplication",
    modelOptions,
  });

  const system = `You are an expert at identifying similar knowledge base entries.
Analyze the provided entries and identify which ones are similar enough to be merged.

Two entries should be merged if:
1. They cover the same topic or use case
2. They would be used in similar email contexts
3. Their content overlaps significantly (>50%)

Return groups of entry indices that should be merged together.
If an entry is unique, it should be in its own group.
Return the result as valid JSON.`;

  const prompt = `Analyze these knowledge base entries and identify which should be merged:

<entries>
${entries
  .map(
    (e, i) => `<entry index="${i}">
  <title>${e.title}</title>
  <topic>${e.topic || "N/A"}</topic>
  <groupType>${e.groupType}</groupType>
  <content>${e.content.slice(0, 500)}</content>
</entry>`,
  )
  .join("\n")}
</entries>

Return groups of indices that should be merged. Each group is an array of indices.
Entries that are unique should be in their own single-element group.
Return valid JSON.`;

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        groups: z
          .array(z.array(z.number()))
          .describe(
            "Groups of entry indices to merge. Each group is merged into one entry.",
          ),
      }),
    });

    // Merge entries within each group
    const mergedEntries: GeneratedKnowledgeEntry[] = [];
    let mergedCount = 0;

    for (const group of result.object.groups) {
      const validIndices = group.filter((i) => i >= 0 && i < entries.length);
      if (validIndices.length === 0) continue;

      if (validIndices.length === 1) {
        mergedEntries.push(entries[validIndices[0]]);
      } else {
        // Merge entries - keep the one with highest confidence as base
        const groupEntries = validIndices.map((i) => entries[i]);
        const merged = mergeEntries(groupEntries);
        mergedEntries.push(merged);
        mergedCount += validIndices.length - 1;
      }
    }

    return { entries: mergedEntries, merged: mergedCount };
  } catch (error) {
    logger.error("Error in AI deduplication", { error });
    return { entries, merged: 0 };
  }
}

function mergeEntries(
  entries: GeneratedKnowledgeEntry[],
): GeneratedKnowledgeEntry {
  // Sort by confidence (highest first)
  const sorted = [...entries].sort((a, b) => b.confidence - a.confidence);
  const primary = sorted[0];

  // Combine keywords from all entries
  const allKeywords = [...new Set(entries.flatMap((e) => e.keywords))];

  // Combine source email IDs
  const allSourceIds = [...new Set(entries.flatMap((e) => e.sourceEmailIds))];

  // Sum up source email counts
  const totalSourceCount = entries.reduce(
    (sum, e) => sum + e.sourceEmailCount,
    0,
  );

  // Average confidence
  const avgConfidence =
    entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length;

  return {
    ...primary,
    keywords: allKeywords.slice(0, 10), // Limit keywords
    sourceEmailIds: allSourceIds.slice(0, 20), // Limit source IDs
    sourceEmailCount: totalSourceCount,
    confidence: avgConfidence,
  };
}

/**
 * Filter out entries that are too similar to existing knowledge
 */
async function filterExistingKnowledge(
  entries: GeneratedKnowledgeEntry[],
  existingKnowledge: Array<{ id: string; title: string; content: string }>,
  emailAccount: EmailAccountWithAI,
): Promise<{ entries: GeneratedKnowledgeEntry[]; removed: number }> {
  if (existingKnowledge.length === 0) {
    return { entries, removed: 0 };
  }

  const modelOptions = getModel(emailAccount.user, "default");

  const generateObject = createGenerateObject({
    userEmail: emailAccount.email,
    label: "Knowledge Duplicate Check",
    modelOptions,
  });

  const system = `You are checking if new knowledge entries duplicate existing ones.
For each new entry, determine if it's too similar to any existing entry.

An entry is a duplicate if:
1. It covers essentially the same information
2. Adding it would be redundant
3. The existing entry already serves the same purpose

Return the indices of new entries that should be KEPT (are not duplicates).
Return the result as valid JSON.`;

  const prompt = `Check these new entries against existing knowledge:

<existing>
${existingKnowledge
  .slice(0, 20) // Limit for context
  .map(
    (e) => `<entry>
  <title>${e.title}</title>
  <content>${e.content.slice(0, 300)}</content>
</entry>`,
  )
  .join("\n")}
</existing>

<new>
${entries
  .map(
    (e, i) => `<entry index="${i}">
  <title>${e.title}</title>
  <content>${e.content.slice(0, 300)}</content>
</entry>`,
  )
  .join("\n")}
</new>

Return indices of NEW entries that should be KEPT (not duplicates of existing).
Return valid JSON.`;

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        keepIndices: z
          .array(z.number())
          .describe("Indices of new entries to keep (not duplicates)"),
      }),
    });

    const validIndices = result.object.keepIndices.filter(
      (i) => i >= 0 && i < entries.length,
    );
    const keptEntries = validIndices.map((i) => entries[i]);

    return {
      entries: keptEntries,
      removed: entries.length - keptEntries.length,
    };
  } catch (error) {
    logger.error("Error checking against existing knowledge", { error });
    return { entries, removed: 0 };
  }
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
