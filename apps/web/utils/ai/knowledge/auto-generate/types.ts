import type { KnowledgeGroupType } from "@prisma/client";

// Input types
export interface SentEmail {
  id: string;
  subject: string;
  to: string;
  from: string;
  date: Date;
  content: string;
  threadId: string;
}

export interface EmailSnippet {
  id: string;
  subject: string;
  snippet: string; // First 200 chars of content
  to: string;
  date: Date;
}

// Stage 2: Clustering types
export interface EmailCluster {
  clusterId: string;
  type: "TOPIC" | "SENDER";
  name: string; // e.g., "Meeting Scheduling" or "Vendor Communications"
  emailIds: string[];
  confidence: number;
}

export interface ClusteringResult {
  clusters: EmailCluster[];
  unclusteredEmailIds: string[];
}

// Stage 3: Pattern extraction types
export interface ExtractedPattern {
  clusterId: string;
  clusterName: string;
  clusterType: "TOPIC" | "SENDER";
  responsePatterns: {
    typicalLength: string;
    tone: string;
    commonPhrases: string[];
    structurePattern: string; // e.g., "greeting, context, action, sign-off"
  };
  businessContext: {
    keyFacts: string[];
    commonTopics: string[];
    relationships: string[]; // e.g., "vendor", "client", "colleague"
  };
  confidence: number;
  sourceEmailCount: number;
}

// Stage 4: Knowledge entry generation types
export interface GeneratedKnowledgeEntry {
  title: string;
  content: string;
  topic: string | null;
  groupType: KnowledgeGroupType;
  senderPattern: string | null;
  sourceEmailCount: number;
  confidence: number;
  keywords: string[];
  sourceEmailIds: string[];
}

// Stage 5: Deduplication result
export interface DeduplicationResult {
  entries: GeneratedKnowledgeEntry[];
  mergedCount: number;
  removedCount: number;
}

// Pipeline progress tracking
export interface PipelineProgress {
  stage: "preprocessing" | "clustering" | "extraction" | "generation" | "deduplication";
  stageProgress: number; // 0-100
  totalEmails: number;
  processedEmails: number;
  clustersFound?: number;
  entriesGenerated?: number;
}

// Full pipeline options
export interface AutoGenerateOptions {
  emailAccountId: string;
  startDate: Date;
  endDate?: Date;
  maxEntries?: number;
  groupBy?: "topic" | "sender" | "both";
  onProgress?: (progress: PipelineProgress) => void;
}

// Full pipeline result
export interface AutoGenerateResult {
  success: boolean;
  entries: GeneratedKnowledgeEntry[];
  stats: {
    totalEmailsScanned: number;
    emailsAfterFiltering: number;
    clustersFound: number;
    entriesGenerated: number;
    entriesMerged: number;
    processingTimeMs: number;
  };
  error?: string;
}
