import { z } from "zod";
import { createScopedLogger } from "@/utils/logger";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { getModel } from "@/utils/llms/model";
import { createGenerateObject } from "@/utils/llms";
import { truncate, removeExcessiveWhitespace } from "@/utils/string";
import type {
  SentEmail,
  EmailCluster,
  ExtractedPattern,
  PipelineProgress,
} from "./types";

const logger = createScopedLogger("knowledge-extract-patterns");

const MAX_EMAILS_PER_CLUSTER = 10; // Limit for context window
const MAX_CONTENT_LENGTH = 1500; // Per email content limit

export interface ExtractPatternsOptions {
  clusters: EmailCluster[];
  emails: SentEmail[];
  emailAccount: EmailAccountWithAI;
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Stage 3: Pattern Extraction
 * For each cluster, analyzes the full email content to extract:
 * - Response patterns (length, tone, structure, common phrases)
 * - Business context (key facts, common topics, relationships)
 */
export async function extractPatterns(
  options: ExtractPatternsOptions,
): Promise<ExtractedPattern[]> {
  const { clusters, emails, emailAccount, onProgress } = options;

  logger.info("Starting pattern extraction", { clusterCount: clusters.length });

  // Create email lookup map
  const emailMap = new Map(emails.map((e) => [e.id, e]));

  const patterns: ExtractedPattern[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];

    onProgress?.({
      stage: "extraction",
      stageProgress: Math.round(((i + 1) / clusters.length) * 100),
      totalEmails: emails.length,
      processedEmails: emails.length,
      clustersFound: clusters.length,
    });

    // Get full email content for this cluster
    const clusterEmails = cluster.emailIds
      .map((id) => emailMap.get(id))
      .filter((e): e is SentEmail => e !== undefined)
      .slice(0, MAX_EMAILS_PER_CLUSTER);

    if (clusterEmails.length < 2) {
      logger.warn("Skipping cluster with too few emails", {
        clusterId: cluster.clusterId,
        emailCount: clusterEmails.length,
      });
      continue;
    }

    try {
      const pattern = await extractClusterPattern(
        cluster,
        clusterEmails,
        emailAccount,
      );

      if (pattern) {
        patterns.push(pattern);
      }
    } catch (error) {
      logger.error("Error extracting pattern for cluster", {
        clusterId: cluster.clusterId,
        error,
      });
    }
  }

  logger.info("Pattern extraction complete", { patternCount: patterns.length });

  return patterns;
}

async function extractClusterPattern(
  cluster: EmailCluster,
  emails: SentEmail[],
  emailAccount: EmailAccountWithAI,
): Promise<ExtractedPattern | null> {
  const modelOptions = getModel(emailAccount.user, "economy");

  const generateObject = createGenerateObject({
    userEmail: emailAccount.email,
    label: "Knowledge Pattern Extraction",
    modelOptions,
  });

  const clusterContext =
    cluster.type === "TOPIC"
      ? `These emails are grouped by topic: "${cluster.name}"`
      : `These emails are grouped by recipient type: "${cluster.name}"`;

  const system = `You are an expert at analyzing email communication patterns.
Analyze the provided sent emails and extract patterns that would help draft similar emails in the future.

${clusterContext}

Extract:
1. Response Patterns: How the user typically writes these emails (length, tone, structure, common phrases)
2. Business Context: Key facts, topics, and relationship dynamics evident in the emails

Be specific and actionable. The extracted patterns will be used to help draft future emails.
Return the result as valid JSON.`;

  const prompt = `Analyze these ${emails.length} sent emails from the "${cluster.name}" cluster and extract patterns:

<emails>
${emails
  .map(
    (e, i) => `<email index="${i}">
  <to>${e.to}</to>
  <subject>${e.subject}</subject>
  <content>${truncate(removeExcessiveWhitespace(e.content), MAX_CONTENT_LENGTH)}</content>
</email>`,
  )
  .join("\n")}
</emails>

Extract response patterns and business context from these emails. Return valid JSON.`;

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        responsePatterns: z.object({
          typicalLength: z
            .string()
            .describe(
              "Typical length of these emails (e.g., '2-3 paragraphs', 'brief 1-2 sentences')",
            ),
          tone: z
            .string()
            .describe(
              "The typical tone (e.g., 'professional and friendly', 'formal', 'casual')",
            ),
          commonPhrases: z
            .array(z.string())
            .describe("Common phrases or expressions used in these emails"),
          structurePattern: z
            .string()
            .describe(
              "How these emails are typically structured (e.g., 'greeting, context, action item, closing')",
            ),
        }),
        businessContext: z.object({
          keyFacts: z
            .array(z.string())
            .describe(
              "Key facts about the business relationship or topic that should be remembered",
            ),
          commonTopics: z
            .array(z.string())
            .describe("Common topics or themes discussed in these emails"),
          relationships: z
            .array(z.string())
            .describe(
              "The type of relationships evident (e.g., 'client', 'vendor', 'colleague', 'manager')",
            ),
        }),
        confidence: z
          .number()
          .min(0.5)
          .max(1)
          .describe("How confident are you in these extracted patterns (0.5-1.0)"),
      }),
    });

    return {
      clusterId: cluster.clusterId,
      clusterName: cluster.name,
      clusterType: cluster.type,
      responsePatterns: result.object.responsePatterns,
      businessContext: result.object.businessContext,
      confidence: result.object.confidence,
      sourceEmailCount: emails.length,
    };
  } catch (error) {
    logger.error("Error in pattern extraction", {
      clusterId: cluster.clusterId,
      error,
    });
    return null;
  }
}
