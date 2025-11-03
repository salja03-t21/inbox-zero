import { createScopedLogger } from "@/utils/logger";
import { captureException } from "@sentry/nextjs";

const logger = createScopedLogger("ai/security");

export interface AISecurityEvent {
  emailAccountId: string;
  operation: string;
  suspiciousPatterns?: string[];
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Log security events for monitoring and alerting
 * These events are sent to logging infrastructure and Sentry
 */
export function logSecurityEvent(event: AISecurityEvent): void {
  logger.warn("AI security event detected", {
    ...event,
    timestamp: event.timestamp.toISOString(),
  });

  // Send to Sentry for alerting
  captureException(new Error("AI Security Event: Potential Prompt Injection"), {
    level: "warning",
    tags: {
      type: "prompt_injection_attempt",
      operation: event.operation,
      emailAccountId: event.emailAccountId,
    },
    extra: {
      ...event,
      patternCount: event.suspiciousPatterns?.length || 0,
      patterns: event.suspiciousPatterns,
    },
  });
}

/**
 * Log successful AI operations for audit trail
 */
export function logAIOperation(
  emailAccountId: string,
  operation: string,
  metadata?: Record<string, unknown>,
): void {
  logger.trace("AI operation executed", {
    emailAccountId,
    operation,
    ...metadata,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log when sanitization was performed
 */
export function logSanitization(
  emailAccountId: string,
  operation: string,
  details: {
    hadSuspiciousPatterns: boolean;
    patternCount: number;
    wasContentModified: boolean;
  },
): void {
  logger.info("Email content sanitized before AI processing", {
    emailAccountId,
    operation,
    ...details,
    timestamp: new Date().toISOString(),
  });
}
