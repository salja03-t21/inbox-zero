import { createScopedLogger } from "@/utils/logger";
import type { EmailForLLM } from "@/utils/types";

const logger = createScopedLogger("ai/sanitize");

/**
 * Detects and logs potential prompt injection attempts
 */
export function detectPromptInjection(text: string): {
  isSuspicious: boolean;
  patterns: string[];
} {
  const suspiciousPatterns = [
    /ignore\s+(previous|above|all)\s+instructions?/i,
    /system\s*:?\s*you\s+are/i,
    /new\s+instructions?:/i,
    /disregard\s+(previous|all)/i,
    /<\/?system>/i,
    /<\/?instructions?>/i,
    /forget\s+(everything|all|previous)/i,
    /reveal\s+.*\s*(prompt|instruction|system|rule)/i,
    /show\s+me\s+.*\s*(prompt|instruction|system)/i,
    /what\s+(are|is)\s+your\s+.*\s*(prompt|instruction|rule)/i,
    /\bexfiltrate\b/i,
    /override\s+(previous|system|all)/i,
    /end\s+of\s+(system|instructions?)/i,
    /\[SYSTEM\]/i,
    /\[INST\]/i,
  ];

  const detectedPatterns: string[] = [];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(text)) {
      detectedPatterns.push(pattern.source);
    }
  }

  if (detectedPatterns.length > 0) {
    logger.warn("Potential prompt injection detected", {
      patternCount: detectedPatterns.length,
      patterns: detectedPatterns,
      contentPreview: text.substring(0, 100),
    });
  }

  return {
    isSuspicious: detectedPatterns.length > 0,
    patterns: detectedPatterns,
  };
}

/**
 * Sanitizes email content before sending to LLM
 * Prevents email content from breaking out of its designated XML tags
 */
export function sanitizeEmailForLLM(
  email: EmailForLLM,
  _maxLength: number,
): {
  sanitizedEmail: EmailForLLM;
  wasSanitized: boolean;
  suspiciousPatterns: string[];
} {
  // Detect injection attempts in the content
  const { isSuspicious, patterns } = detectPromptInjection(email.content);

  // Sanitize content by replacing XML-breaking sequences
  // This prevents email content from escaping its <body> tag
  const sanitizedContent = email.content
    .replace(/<\/email>/gi, "[/email]")
    .replace(/<\/body>/gi, "[/body]")
    .replace(/<\/system>/gi, "[/system]")
    .replace(/<\/instructions?>/gi, "[/instructions]")
    .replace(/<system>/gi, "[system]")
    .replace(/<instructions?>/gi, "[instructions]")
    .replace(/```/g, "'''"); // Prevent markdown code block escape

  // Sanitize subject line
  const sanitizedSubject = email.subject
    .replace(/<\/subject>/gi, "[/subject]")
    .replace(/<system>/gi, "[system]")
    .replace(/<instructions?>/gi, "[instructions]");

  const wasSanitized =
    sanitizedContent !== email.content || sanitizedSubject !== email.subject;

  if (wasSanitized) {
    logger.info("Email content sanitized", {
      hadSuspiciousPatterns: isSuspicious,
      replacementsMade: true,
    });
  }

  return {
    sanitizedEmail: {
      ...email,
      content: sanitizedContent,
      subject: sanitizedSubject,
    },
    wasSanitized,
    suspiciousPatterns: patterns,
  };
}
