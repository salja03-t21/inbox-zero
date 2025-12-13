import { z } from "zod";
import { createScopedLogger } from "@/utils/logger";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { getModel } from "@/utils/llms/model";
import { createGenerateObject } from "@/utils/llms";
import type {
  ExtractedPattern,
  GeneratedKnowledgeEntry,
  SentEmail,
  PipelineProgress,
} from "./types";

const logger = createScopedLogger("knowledge-generate-entries");

export interface GenerateEntriesOptions {
  patterns: ExtractedPattern[];
  emails: SentEmail[];
  emailAccount: EmailAccountWithAI;
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Stage 4: Knowledge Entry Generation
 * Converts extracted patterns into well-formatted knowledge base entries
 * that can be used for drafting future emails.
 */
export async function generateKnowledgeEntries(
  options: GenerateEntriesOptions,
): Promise<GeneratedKnowledgeEntry[]> {
  const { patterns, emails, emailAccount, onProgress } = options;

  logger.info("Starting knowledge entry generation", {
    patternCount: patterns.length,
  });

  // Create email lookup map for source tracking
  const emailMap = new Map(emails.map((e) => [e.id, e]));

  const entries: GeneratedKnowledgeEntry[] = [];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];

    onProgress?.({
      stage: "generation",
      stageProgress: Math.round(((i + 1) / patterns.length) * 100),
      totalEmails: emails.length,
      processedEmails: emails.length,
      clustersFound: patterns.length,
      entriesGenerated: entries.length,
    });

    try {
      const entry = await generateEntryFromPattern(pattern, emailAccount);

      if (entry) {
        // Find source email IDs for this pattern's cluster
        const sourceEmailIds = findSourceEmailIds(pattern, emails);
        entries.push({
          ...entry,
          sourceEmailIds,
        });
      }
    } catch (error) {
      logger.error("Error generating entry from pattern", {
        clusterId: pattern.clusterId,
        error,
      });
    }
  }

  logger.info("Knowledge entry generation complete", {
    entryCount: entries.length,
  });

  return entries;
}

async function generateEntryFromPattern(
  pattern: ExtractedPattern,
  emailAccount: EmailAccountWithAI,
): Promise<Omit<GeneratedKnowledgeEntry, "sourceEmailIds"> | null> {
  const modelOptions = getModel(emailAccount.user, "default");

  const generateObject = createGenerateObject({
    userEmail: emailAccount.email,
    label: "Knowledge Entry Generation",
    modelOptions,
  });

  const system = `You are an expert at creating knowledge base entries for email drafting assistance.
Convert the extracted email patterns into a well-structured knowledge base entry.

The entry should:
1. Have a clear, descriptive title that indicates when this knowledge applies
2. Contain actionable content that helps draft similar emails
3. Include specific phrases, tone guidance, and structural patterns
4. Be written in second person ("When emailing...", "You typically...")

The content should be practical and immediately useful for drafting emails.
Return the result as valid JSON.`;

  const prompt = `Convert this extracted pattern into a knowledge base entry:

<pattern>
  <clusterName>${pattern.clusterName}</clusterName>
  <clusterType>${pattern.clusterType}</clusterType>
  <sourceEmailCount>${pattern.sourceEmailCount}</sourceEmailCount>

  <responsePatterns>
    <typicalLength>${pattern.responsePatterns.typicalLength}</typicalLength>
    <tone>${pattern.responsePatterns.tone}</tone>
    <commonPhrases>${pattern.responsePatterns.commonPhrases.join(", ")}</commonPhrases>
    <structurePattern>${pattern.responsePatterns.structurePattern}</structurePattern>
  </responsePatterns>

  <businessContext>
    <keyFacts>${pattern.businessContext.keyFacts.join("; ")}</keyFacts>
    <commonTopics>${pattern.businessContext.commonTopics.join(", ")}</commonTopics>
    <relationships>${pattern.businessContext.relationships.join(", ")}</relationships>
  </businessContext>
</pattern>

Create a knowledge base entry that captures this information in a practical, actionable format. Return valid JSON.`;

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        title: z
          .string()
          .describe(
            "A clear, descriptive title for this knowledge entry (e.g., 'Client Meeting Follow-ups', 'Team Status Updates')",
          ),
        content: z
          .string()
          .describe(
            "The full knowledge content including style guidance, common phrases, and context (500-1500 chars)",
          ),
        topic: z
          .string()
          .nullable()
          .describe("The main topic this knowledge applies to, if topic-based"),
        senderPattern: z
          .string()
          .nullable()
          .describe(
            "Email pattern this applies to (e.g., '@company.com'), if sender-based",
          ),
        keywords: z
          .array(z.string())
          .describe(
            "Keywords that would indicate when this knowledge should be used",
          ),
      }),
    });

    return {
      title: result.object.title,
      content: result.object.content,
      topic: result.object.topic,
      groupType: pattern.clusterType,
      senderPattern: result.object.senderPattern,
      sourceEmailCount: pattern.sourceEmailCount,
      confidence: pattern.confidence,
      keywords: result.object.keywords,
    };
  } catch (error) {
    logger.error("Error in entry generation", {
      clusterId: pattern.clusterId,
      error,
    });
    return null;
  }
}

function findSourceEmailIds(
  pattern: ExtractedPattern,
  emails: SentEmail[],
): string[] {
  // This is a simplified approach - in the full pipeline, we'd track
  // which emails went into which clusters/patterns
  // For now, return emails that match the pattern's topic or sender pattern
  return emails
    .filter((email) => {
      // Match by topic keywords
      if (pattern.businessContext.commonTopics.length > 0) {
        const emailText = `${email.subject} ${email.content}`.toLowerCase();
        return pattern.businessContext.commonTopics.some((topic) =>
          emailText.includes(topic.toLowerCase()),
        );
      }
      return false;
    })
    .slice(0, 10) // Limit to 10 source emails
    .map((e) => e.id);
}

/**
 * Utility to create a content hash for deduplication
 */
export function createKnowledgeContentHash(content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return hash.toString(36);
}
