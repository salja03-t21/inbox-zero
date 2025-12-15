import pRetry from "p-retry";
import { createScopedLogger } from "@/utils/logger";
import { sleep } from "@/utils/sleep";

const logger = createScopedLogger("outlook-retry");

interface ErrorInfo {
  status?: number;
  code?: string;
  errorMessage: string;
}

/**
 * Extracts error information from various error shapes
 */
export function extractErrorInfo(error: unknown): ErrorInfo {
  const err = error as Record<string, unknown>;
  const cause = (err?.cause ?? err) as Record<string, unknown>;
  const status =
    (cause?.status as number) ??
    (cause?.statusCode as number) ??
    ((cause?.response as Record<string, unknown>)?.status as number) ??
    undefined;
  const code =
    (cause?.code as string) ??
    ((cause?.error as Record<string, unknown>)?.code as string) ??
    undefined;
  const primaryMessage =
    (cause?.message as string) ??
    (err?.message as string) ??
    (cause?.error as string) ??
    (err?.error as string) ??
    ((cause?.error as Record<string, unknown>)?.message as string) ??
<<<<<<< HEAD
    (((cause?.response as Record<string, unknown>)?.data as Record<string, unknown>)?.error as string) ??
=======
    ((
      (cause?.response as Record<string, unknown>)?.data as Record<
        string,
        unknown
      >
    )?.error as string) ??
>>>>>>> production
    "";

  const errorMessage = String(primaryMessage);

  return { status, code, errorMessage };
}

/**
 * Determines if an error is retryable (rate limit or server error)
 */
export function isRetryableError(errorInfo: ErrorInfo): {
  retryable: boolean;
  isRateLimit: boolean;
  isServerError: boolean;
  isTimeout: boolean;
} {
  const { status, code, errorMessage } = errorInfo;

  // Microsoft Graph rate limiting: 429 or specific error codes
  const isRateLimit =
    status === 429 ||
    code === "TooManyRequests" ||
    code === "activityLimitReached" ||
    /rate limit|throttl(ed|ing)|too many requests/i.test(errorMessage);

  // Temporary server errors that should be retried (502, 503, 504)
  const isServerError =
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "ServiceUnavailable" ||
    code === "generalException" ||
<<<<<<< HEAD
    /502|503|504|server error|temporarily unavailable|service unavailable/i.test(errorMessage);
=======
    /502|503|504|server error|temporarily unavailable|service unavailable/i.test(
      errorMessage,
    );
>>>>>>> production

  // Timeout errors
  const isTimeout =
    code === "Timeout" ||
    code === "RequestTimeout" ||
    status === 408 ||
    /timeout|timed out/i.test(errorMessage);

  return {
    retryable: isRateLimit || isServerError || isTimeout,
    isRateLimit,
    isServerError,
    isTimeout,
  };
}

/**
 * Calculates retry delay based on error type and attempt number
 */
export function calculateRetryDelay(
  isRateLimit: boolean,
  isServerError: boolean,
  isTimeout: boolean,
  attemptNumber: number,
  retryAfterHeader?: string,
): number {
  // Handle Retry-After header
  if (retryAfterHeader) {
    const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(retryAfterSeconds)) {
      return retryAfterSeconds * 1000;
    }

    // Try parsing as HTTP-date
    const retryDate = new Date(retryAfterHeader);
    if (!Number.isNaN(retryDate.getTime())) {
      const delayMs = Math.max(0, retryDate.getTime() - Date.now());
      if (delayMs > 0) {
        return delayMs;
      }
    }
  }

  // Use different fallback delays based on error type
  if (isServerError) {
    // Exponential backoff for server errors: 5s, 10s, 20s, 40s, 80s
    return Math.min(5000 * 2 ** (attemptNumber - 1), 80_000);
  }

  if (isRateLimit) {
    // Exponential backoff for rate limits: 10s, 20s, 40s, 80s, 160s
    return Math.min(10_000 * 2 ** (attemptNumber - 1), 160_000);
  }

  if (isTimeout) {
    // Exponential backoff for timeouts: 2s, 4s, 8s, 16s, 32s
    return Math.min(2000 * 2 ** (attemptNumber - 1), 32_000);
  }

  return 0;
}

/**
 * Retries an Outlook/Microsoft Graph API operation when rate limits or temporary server errors are encountered
 * - Rate limits: 429, TooManyRequests, activityLimitReached
 * - Server errors: 502, 503, 504, ServiceUnavailable
 * - Timeouts: 408, Timeout
 */
export async function withOutlookRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  return pRetry(operation, {
    retries: maxRetries,
    onFailedAttempt: async (error) => {
      const errorInfo = extractErrorInfo(error);
      const { retryable, isRateLimit, isServerError, isTimeout } =
        isRetryableError(errorInfo);

      if (!retryable) {
        logger.warn("Non-retryable error encountered", {
          error,
          status: errorInfo.status,
          code: errorInfo.code,
        });
        throw error;
      }

      const err = error as Record<string, unknown>;
      const cause = (err?.cause ?? err) as Record<string, unknown>;
      const retryAfterHeader = (
        (cause?.response as Record<string, unknown>)?.headers as Record<
          string,
          string
        >
      )?.[" retry-after"];

      const delayMs = calculateRetryDelay(
        isRateLimit,
        isServerError,
        isTimeout,
        error.attemptNumber,
        retryAfterHeader,
      );

      logger.warn("Outlook error. Will retry", {
        delaySeconds: Math.ceil(delayMs / 1000),
        attemptNumber: error.attemptNumber,
        maxRetries,
        status: errorInfo.status,
        code: errorInfo.code,
        isRateLimit,
        isServerError,
        isTimeout,
      });

      // Apply the custom delay
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    },
  });
}
