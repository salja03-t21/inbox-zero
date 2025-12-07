import type { ParsedMessage } from "@/utils/types";
import type { EmailProvider } from "@/utils/email/types";
import type { SentEmail, EmailSnippet, PipelineProgress } from "./types";
import { createScopedLogger } from "@/utils/logger";
import { createEmailProvider } from "@/utils/email/provider";
import { truncate, removeExcessiveWhitespace } from "@/utils/string";

const logger = createScopedLogger("knowledge-preprocess");

// Patterns that indicate auto-generated/automated emails to filter out
const AUTO_REPLY_PATTERNS = [
  /^(re:|fwd:|fw:)/i, // Skip replies and forwards
  /out of office/i,
  /automatic reply/i,
  /auto-reply/i,
  /autoreply/i,
  /vacation responder/i,
  /away from (my )?office/i,
  /i('m|am) currently (out|away|on leave)/i,
  /delivery notification/i,
  /undeliverable/i,
  /delivery status/i,
  /read receipt/i,
  /calendar invite/i,
  /meeting request/i,
  /meeting accepted/i,
  /meeting declined/i,
  /appointment confirmed/i,
  /do not reply/i,
  /no-reply/i,
  /noreply/i,
  /mailer-daemon/i,
  /postmaster/i,
];

// Email domains that typically indicate automated/system emails
const AUTOMATED_SENDER_DOMAINS = [
  "noreply",
  "no-reply",
  "donotreply",
  "mailer-daemon",
  "postmaster",
  "notifications",
  "alerts",
  "system",
  "automated",
];

export interface PreprocessOptions {
  emailAccountId: string;
  provider: string;
  startDate: Date;
  endDate?: Date;
  maxEmails?: number;
  onProgress?: (progress: PipelineProgress) => void;
}

export interface PreprocessResult {
  emails: SentEmail[];
  snippets: EmailSnippet[];
  filteredOutCount: number;
  totalFetched: number;
}

/**
 * Stage 1: Preprocessing
 * - Fetches sent emails within the date range
 * - Filters out auto-replies, system notifications, and low-quality emails
 * - Creates snippets for clustering stage
 * - Deduplicates by content hash
 */
export async function preprocessSentEmails(
  options: PreprocessOptions,
): Promise<PreprocessResult> {
  const {
    emailAccountId,
    provider,
    startDate,
    endDate,
    maxEmails = 500,
    onProgress,
  } = options;

  logger.info("Starting preprocessing", {
    emailAccountId,
    startDate,
    endDate,
    maxEmails,
  });

  // Create email provider with error handling
  let emailProvider: EmailProvider;
  try {
    emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
    });
  } catch (error) {
    logger.error("Failed to create email provider", {
      error: error instanceof Error ? error.message : error,
      emailAccountId,
      provider,
    });
    throw new Error(
      `Failed to connect to email provider: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  // Fetch sent emails
  const rawEmails = await fetchSentEmailsInRange(emailProvider, {
    startDate,
    endDate,
    maxEmails,
    onProgress,
  });

  logger.info("Fetched raw emails", { count: rawEmails.length });

  // Filter and convert emails
  const { emails, filteredOutCount } = filterAndConvertEmails(rawEmails);

  logger.info("Filtered emails", {
    kept: emails.length,
    filteredOut: filteredOutCount,
  });

  // Deduplicate by content similarity
  const deduplicatedEmails = deduplicateEmails(emails);

  logger.info("Deduplicated emails", {
    before: emails.length,
    after: deduplicatedEmails.length,
  });

  // Create snippets for clustering
  const snippets = createSnippets(deduplicatedEmails);

  return {
    emails: deduplicatedEmails,
    snippets,
    filteredOutCount,
    totalFetched: rawEmails.length,
  };
}

async function fetchSentEmailsInRange(
  emailProvider: EmailProvider,
  options: {
    startDate: Date;
    endDate?: Date;
    maxEmails: number;
    onProgress?: (progress: PipelineProgress) => void;
  },
): Promise<ParsedMessage[]> {
  const { startDate, endDate, maxEmails, onProgress } = options;
  const emails: ParsedMessage[] = [];
  let pageToken: string | undefined;
  const batchSize = 50;

  while (emails.length < maxEmails) {
    const response = await emailProvider.getMessagesByFields({
      type: "sent",
      after: startDate,
      before: endDate,
      maxResults: Math.min(batchSize, maxEmails - emails.length),
      pageToken,
    });

    emails.push(...response.messages);

    onProgress?.({
      stage: "preprocessing",
      stageProgress: Math.min((emails.length / maxEmails) * 100, 100),
      totalEmails: maxEmails,
      processedEmails: emails.length,
    });

    if (!response.nextPageToken || emails.length >= maxEmails) {
      break;
    }

    pageToken = response.nextPageToken;
  }

  return emails;
}

function filterAndConvertEmails(rawEmails: ParsedMessage[]): {
  emails: SentEmail[];
  filteredOutCount: number;
} {
  const emails: SentEmail[] = [];
  let filteredOutCount = 0;

  for (const raw of rawEmails) {
    if (!shouldIncludeEmail(raw)) {
      filteredOutCount++;
      continue;
    }

    const content = extractEmailContent(raw);
    if (!content || content.length < 50) {
      // Skip very short emails
      filteredOutCount++;
      continue;
    }

    emails.push({
      id: raw.id,
      subject: raw.headers.subject || "(No Subject)",
      to: raw.headers.to || "",
      from: raw.headers.from || "",
      date: new Date(raw.headers.date || Date.now()),
      content,
      threadId: raw.threadId || raw.id,
    });
  }

  return { emails, filteredOutCount };
}

function shouldIncludeEmail(email: ParsedMessage): boolean {
  const subject = email.headers.subject || "";
  const from = email.headers.from || "";
  const to = email.headers.to || "";

  // Check for auto-reply patterns in subject
  for (const pattern of AUTO_REPLY_PATTERNS) {
    if (pattern.test(subject)) {
      logger.trace("Filtering out email by subject pattern", {
        subject,
        pattern: pattern.source,
      });
      return false;
    }
  }

  // Check for automated sender domains
  const toLower = to.toLowerCase();
  for (const domain of AUTOMATED_SENDER_DOMAINS) {
    if (toLower.includes(domain)) {
      logger.trace("Filtering out email by recipient domain", { to, domain });
      return false;
    }
  }

  // Skip if sending to self (likely notes or testing)
  if (from && to && extractEmailAddress(from) === extractEmailAddress(to)) {
    logger.trace("Filtering out self-sent email", { from, to });
    return false;
  }

  return true;
}

function extractEmailContent(email: ParsedMessage): string {
  // Prefer plain text, fall back to stripping HTML
  let content = email.textPlain || "";

  if (!content && email.textHtml) {
    // Basic HTML stripping - remove tags and decode entities
    content = email.textHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // Clean up whitespace
  content = removeExcessiveWhitespace(content);

  // Remove common email signatures and quoted text
  content = removeQuotedText(content);
  content = removeSignature(content);

  return content.trim();
}

function removeQuotedText(content: string): string {
  // Remove lines starting with > (quoted replies)
  const lines = content.split("\n");
  const filteredLines = lines.filter((line) => !line.trim().startsWith(">"));

  // Remove "On ... wrote:" patterns
  const result = filteredLines
    .join("\n")
    .replace(/On .+? wrote:[\s\S]*$/i, "")
    .replace(/From: .+?\nSent: .+?\nTo:[\s\S]*$/i, "")
    .replace(/-{3,}\s*Original Message\s*-{3,}[\s\S]*/i, "");

  return result;
}

function removeSignature(content: string): string {
  // Common signature delimiters
  const signaturePatterns = [
    /\n--\s*\n[\s\S]*$/, // Standard signature delimiter
    /\n_{3,}[\s\S]*$/, // Underscores
    /\nBest regards?,?\n[\s\S]*$/i,
    /\nKind regards?,?\n[\s\S]*$/i,
    /\nThanks?,?\n[\s\S]*$/i,
    /\nCheers?,?\n[\s\S]*$/i,
    /\nSincerely,?\n[\s\S]*$/i,
    /\nRegards?,?\n[\s\S]*$/i,
    /\nSent from my (iPhone|iPad|Android|mobile)[\s\S]*$/i,
    /\nGet Outlook for [\s\S]*$/i,
  ];

  let result = content;
  for (const pattern of signaturePatterns) {
    result = result.replace(pattern, "");
  }

  return result;
}

function deduplicateEmails(emails: SentEmail[]): SentEmail[] {
  const seen = new Map<string, SentEmail>();

  for (const email of emails) {
    // Create a content hash for deduplication
    const contentHash = createContentHash(email);

    // Keep the most recent email if there's a duplicate
    const existing = seen.get(contentHash);
    if (!existing || email.date > existing.date) {
      seen.set(contentHash, email);
    }
  }

  return Array.from(seen.values());
}

function createContentHash(email: SentEmail): string {
  // Normalize content for comparison
  const normalizedContent = email.content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500); // Use first 500 chars for hash

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < normalizedContent.length; i++) {
    const char = normalizedContent.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return `${email.to.toLowerCase().split(",")[0].trim()}_${hash}`;
}

function createSnippets(emails: SentEmail[]): EmailSnippet[] {
  return emails.map((email) => ({
    id: email.id,
    subject: email.subject,
    snippet: truncate(removeExcessiveWhitespace(email.content), 200),
    to: email.to,
    date: email.date,
  }));
}

function extractEmailAddress(emailString: string): string {
  const match = emailString.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : emailString.toLowerCase().trim();
}
