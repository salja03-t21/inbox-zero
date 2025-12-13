import { z } from "zod";
import { createScopedLogger } from "@/utils/logger";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { getModel } from "@/utils/llms/model";
import { createGenerateObject } from "@/utils/llms";
import type {
  EmailSnippet,
  EmailCluster,
  ClusteringResult,
  PipelineProgress,
} from "./types";

const logger = createScopedLogger("knowledge-cluster");

const BATCH_SIZE = 50; // Process emails in batches to avoid token limits
const MIN_CLUSTER_SIZE = 3; // Minimum emails needed to form a cluster

export interface ClusterOptions {
  snippets: EmailSnippet[];
  emailAccount: EmailAccountWithAI;
  groupBy: "topic" | "sender" | "both";
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Stage 2: Clustering
 * Uses AI to identify patterns and group emails into clusters
 * - Topic clusters: Groups by subject matter (e.g., "Meeting Scheduling", "Project Updates")
 * - Sender clusters: Groups by recipient categories (e.g., "Client Communications", "Team Updates")
 */
export async function clusterEmails(
  options: ClusterOptions,
): Promise<ClusteringResult> {
  const { snippets, emailAccount, groupBy, onProgress } = options;

  logger.info("Starting email clustering", {
    emailCount: snippets.length,
    groupBy,
  });

  if (snippets.length < MIN_CLUSTER_SIZE) {
    logger.warn("Not enough emails to cluster", { count: snippets.length });
    return {
      clusters: [],
      unclusteredEmailIds: snippets.map((s) => s.id),
    };
  }

  const allClusters: EmailCluster[] = [];
  const clusteredEmailIds = new Set<string>();

  // Cluster by topic if requested
  if (groupBy === "topic" || groupBy === "both") {
    const topicClusters = await clusterByTopic(
      snippets,
      emailAccount,
      onProgress,
    );
    for (const cluster of topicClusters) {
      allClusters.push(cluster);
      cluster.emailIds.forEach((id) => clusteredEmailIds.add(id));
    }
  }

  // Cluster by sender category if requested
  if (groupBy === "sender" || groupBy === "both") {
    // For sender clustering, only use emails not already clustered by topic
    const remainingSnippets =
      groupBy === "both"
        ? snippets.filter((s) => !clusteredEmailIds.has(s.id))
        : snippets;

    if (remainingSnippets.length >= MIN_CLUSTER_SIZE) {
      const senderClusters = await clusterBySender(
        remainingSnippets,
        emailAccount,
        onProgress,
      );
      for (const cluster of senderClusters) {
        allClusters.push(cluster);
        cluster.emailIds.forEach((id) => clusteredEmailIds.add(id));
      }
    }
  }

  // Identify unclustered emails
  const unclusteredEmailIds = snippets
    .filter((s) => !clusteredEmailIds.has(s.id))
    .map((s) => s.id);

  logger.info("Clustering complete", {
    totalClusters: allClusters.length,
    clusteredEmails: clusteredEmailIds.size,
    unclusteredEmails: unclusteredEmailIds.length,
  });

  return {
    clusters: allClusters,
    unclusteredEmailIds,
  };
}

async function clusterByTopic(
  snippets: EmailSnippet[],
  emailAccount: EmailAccountWithAI,
  onProgress?: (progress: PipelineProgress) => void,
): Promise<EmailCluster[]> {
  logger.info("Clustering by topic", { emailCount: snippets.length });

  // Process in batches to avoid token limits
  const batches = createBatches(snippets, BATCH_SIZE);
  const allTopicClusters: EmailCluster[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    onProgress?.({
      stage: "clustering",
      stageProgress: Math.round(((i + 1) / batches.length) * 50), // Topic = first 50%
      totalEmails: snippets.length,
      processedEmails: Math.min((i + 1) * BATCH_SIZE, snippets.length),
    });

    const batchClusters = await clusterBatchByTopic(batch, emailAccount);
    allTopicClusters.push(...batchClusters);
  }

  // Merge similar clusters across batches
  const mergedClusters = mergeSimilarClusters(allTopicClusters, "TOPIC");

  return mergedClusters.filter((c) => c.emailIds.length >= MIN_CLUSTER_SIZE);
}

async function clusterBatchByTopic(
  snippets: EmailSnippet[],
  emailAccount: EmailAccountWithAI,
): Promise<EmailCluster[]> {
  const modelOptions = getModel(emailAccount.user, "default");

  const generateObject = createGenerateObject({
    userEmail: emailAccount.email,
    label: "Knowledge Clustering - Topic",
    modelOptions,
  });

  const system = `You are an email analyst specializing in identifying communication patterns.
Analyze the email snippets and group them into topic-based clusters.

Guidelines:
- Group emails by their primary topic or purpose (e.g., "Meeting Scheduling", "Project Updates", "Sales Inquiries")
- Each cluster should contain at least 3 emails with clearly related topics
- Be specific with cluster names - avoid generic names like "General" or "Other"
- Assign confidence scores based on how well emails fit the cluster (0.5-1.0)
- An email can only belong to one cluster
- If an email doesn't fit any cluster well, leave it unclustered

Return the result as valid JSON.`;

  const prompt = `Analyze these sent email snippets and identify topic-based clusters:

<emails>
${snippets
  .map(
    (s, i) => `<email id="${s.id}" index="${i}">
  <subject>${s.subject}</subject>
  <to>${s.to}</to>
  <snippet>${s.snippet}</snippet>
</email>`,
  )
  .join("\n")}
</emails>

Identify clusters of emails with similar topics. Return JSON with the clusters found.`;

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        clusters: z.array(
          z.object({
            name: z
              .string()
              .describe("Descriptive name for this topic cluster"),
            emailIds: z
              .array(z.string())
              .describe("IDs of emails belonging to this cluster"),
            confidence: z
              .number()
              .min(0.5)
              .max(1)
              .describe("How confident are you in this clustering (0.5-1.0)"),
          }),
        ),
      }),
    });

    return result.object.clusters.map((c, i) => ({
      clusterId: `topic_${Date.now()}_${i}`,
      type: "TOPIC" as const,
      name: c.name,
      emailIds: c.emailIds.filter((id) => snippets.some((s) => s.id === id)), // Validate IDs
      confidence: c.confidence,
    }));
  } catch (error) {
    logger.error("Error clustering batch by topic", { error });
    return [];
  }
}

async function clusterBySender(
  snippets: EmailSnippet[],
  emailAccount: EmailAccountWithAI,
  onProgress?: (progress: PipelineProgress) => void,
): Promise<EmailCluster[]> {
  logger.info("Clustering by sender category", { emailCount: snippets.length });

  const batches = createBatches(snippets, BATCH_SIZE);
  const allSenderClusters: EmailCluster[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    onProgress?.({
      stage: "clustering",
      stageProgress: 50 + Math.round(((i + 1) / batches.length) * 50), // Sender = second 50%
      totalEmails: snippets.length,
      processedEmails: Math.min((i + 1) * BATCH_SIZE, snippets.length),
    });

    const batchClusters = await clusterBatchBySender(batch, emailAccount);
    allSenderClusters.push(...batchClusters);
  }

  // Merge similar clusters across batches
  const mergedClusters = mergeSimilarClusters(allSenderClusters, "SENDER");

  return mergedClusters.filter((c) => c.emailIds.length >= MIN_CLUSTER_SIZE);
}

async function clusterBatchBySender(
  snippets: EmailSnippet[],
  emailAccount: EmailAccountWithAI,
): Promise<EmailCluster[]> {
  const modelOptions = getModel(emailAccount.user, "default");

  const generateObject = createGenerateObject({
    userEmail: emailAccount.email,
    label: "Knowledge Clustering - Sender",
    modelOptions,
  });

  const system = `You are an email analyst specializing in identifying communication patterns.
Analyze the email snippets and group them by recipient relationship categories.

Guidelines:
- Group emails by the type of relationship with the recipient (e.g., "Client Communications", "Team Updates", "Vendor Correspondence")
- Look at recipient domains, email patterns, and communication style to infer relationships
- Each cluster should contain at least 3 emails with similar recipient types
- Be specific with cluster names based on the actual patterns you see
- Assign confidence scores based on how certain you are about the relationship (0.5-1.0)
- An email can only belong to one cluster

Return the result as valid JSON.`;

  const prompt = `Analyze these sent email snippets and identify sender-relationship clusters:

<emails>
${snippets
  .map(
    (s, i) => `<email id="${s.id}" index="${i}">
  <subject>${s.subject}</subject>
  <to>${s.to}</to>
  <snippet>${s.snippet}</snippet>
</email>`,
  )
  .join("\n")}
</emails>

Identify clusters of emails with similar recipient relationship types. Return JSON with the clusters found.`;

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        clusters: z.array(
          z.object({
            name: z
              .string()
              .describe("Descriptive name for this relationship category"),
            senderPattern: z
              .string()
              .optional()
              .describe(
                "Common pattern in recipients (e.g., '@company.com', 'support@')",
              ),
            emailIds: z
              .array(z.string())
              .describe("IDs of emails belonging to this cluster"),
            confidence: z
              .number()
              .min(0.5)
              .max(1)
              .describe("How confident are you in this clustering (0.5-1.0)"),
          }),
        ),
      }),
    });

    return result.object.clusters.map((c, i) => ({
      clusterId: `sender_${Date.now()}_${i}`,
      type: "SENDER" as const,
      name: c.name,
      emailIds: c.emailIds.filter((id) => snippets.some((s) => s.id === id)), // Validate IDs
      confidence: c.confidence,
    }));
  } catch (error) {
    logger.error("Error clustering batch by sender", { error });
    return [];
  }
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

function mergeSimilarClusters(
  clusters: EmailCluster[],
  type: "TOPIC" | "SENDER",
): EmailCluster[] {
  if (clusters.length <= 1) return clusters;

  const merged: EmailCluster[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < clusters.length; i++) {
    if (usedIndices.has(i)) continue;

    const current = clusters[i];
    const similar: EmailCluster[] = [current];
    usedIndices.add(i);

    // Find similar clusters
    for (let j = i + 1; j < clusters.length; j++) {
      if (usedIndices.has(j)) continue;

      const other = clusters[j];
      if (areSimilarClusterNames(current.name, other.name)) {
        similar.push(other);
        usedIndices.add(j);
      }
    }

    // Merge similar clusters
    if (similar.length > 1) {
      const mergedCluster: EmailCluster = {
        clusterId: `${type.toLowerCase()}_merged_${Date.now()}`,
        type,
        name: current.name, // Use the first cluster's name
        emailIds: [...new Set(similar.flatMap((c) => c.emailIds))],
        confidence:
          similar.reduce((sum, c) => sum + c.confidence, 0) / similar.length,
      };
      merged.push(mergedCluster);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function areSimilarClusterNames(name1: string, name2: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .split(" ")
      .filter(Boolean)
      .sort()
      .join(" ");

  const n1 = normalize(name1);
  const n2 = normalize(name2);

  // Check for exact match after normalization
  if (n1 === n2) return true;

  // Check if one contains most words from the other
  const words1 = n1.split(" ");
  const words2 = n2.split(" ");

  const commonWords = words1.filter((w) => words2.includes(w));
  const similarity =
    commonWords.length / Math.max(words1.length, words2.length);

  return similarity >= 0.7; // 70% word overlap
}
