import pRetry, { AbortError } from "p-retry";
import { APICallError, RetryError } from "ai";
import { createScopedLogger } from "@/utils/logger";
import { sleep } from "@/utils/sleep";

const logger = createScopedLogger("llms-retry");

interface LLMErrorInfo {
  statusCode?: number;
  isRateLimit: boolean;
  isServerError: boolean;
  errorMessage: string;
}

/**
 * Extracts error information from LLM API errors
 */
export function extractLLMErrorInfo(error: unknown): LLMErrorInfo {
  let statusCode: number | undefined;
  let errorMessage = "";

  if (APICallError.isInstance(error)) {
    statusCode = error.statusCode;
    errorMessage = error.message;
    // For Bad Request errors, try to get more details from responseBody
    if (statusCode === 400) {
      try {
        const responseBody =
          typeof error.responseBody === "string"
            ? error.responseBody
            : JSON.stringify(error.responseBody);
        if (responseBody) {
          errorMessage = `${errorMessage} | Response: ${responseBody}`;
        }
      } catch {
        // Ignore if can't stringify
      }
    }
  } else if (RetryError.isInstance(error)) {
    statusCode = 429; // RetryError typically means rate limit
    errorMessage = error.message;
  } else if (error instanceof Error) {
    errorMessage = error.message;
    statusCode =
      (error as { statusCode?: number; status?: number }).statusCode ||
      (error as { statusCode?: number; status?: number }).status;
  }

  // Detect rate limit errors
  const isRateLimit =
    statusCode === 429 ||
    /(rate limit|quota exceeded|too many requests)/i.test(errorMessage);

  // Detect server errors (502, 503, 504)
  const isServerError =
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    /502|503|504|server error|service unavailable/i.test(errorMessage);

  return {
    statusCode,
    isRateLimit,
    isServerError,
    errorMessage,
  };
}

/**
 * Determines if an LLM error is retryable
 */
export function isRetryableLLMError(errorInfo: LLMErrorInfo): boolean {
  return errorInfo.isRateLimit || errorInfo.isServerError;
}

/**
 * Calculates retry delay for LLM API errors with exponential backoff
 */
export function calculateLLMRetryDelay(
  errorInfo: LLMErrorInfo,
  attemptNumber: number,
): number {
  const { isRateLimit, isServerError } = errorInfo;

  if (isRateLimit) {
    // Exponential backoff for rate limits: 5s, 10s, 20s, 40s, 80s
    return Math.min(5000 * 2 ** (attemptNumber - 1), 80_000);
  }

  if (isServerError) {
    // Exponential backoff for server errors: 2s, 4s, 8s, 16s, 32s
    return Math.min(2000 * 2 ** (attemptNumber - 1), 32_000);
  }

  return 0;
}

/**
 * Retries an LLM API operation when rate limits or temporary server errors are encountered
 * - Rate limits: 429 status or rate limit messages
 * - Server errors: 502, 503, 504
 */
export async function withLLMRetry<T>(
  operation: () => Promise<T>,
  {
    maxRetries = 5,
    operationLabel = "LLM call",
  }: {
    maxRetries?: number;
    operationLabel?: string;
  } = {},
): Promise<T> {
  return pRetry(operation, {
    retries: maxRetries,
    onFailedAttempt: async (failedAttempt) => {
      // p-retry wraps errors - extract the original error
      const originalError =
        (failedAttempt as { error?: unknown }).error || failedAttempt;
      const errorInfo = extractLLMErrorInfo(originalError);
      const retryable = isRetryableLLMError(errorInfo);

      if (!retryable) {
        logger.warn("Non-retryable LLM error encountered", {
          operationLabel,
          statusCode: errorInfo.statusCode,
          errorMessage: errorInfo.errorMessage.slice(0, 200),
        });
        // Wrap in AbortError to stop p-retry from retrying
        throw new AbortError(
          originalError instanceof Error
            ? originalError
            : new Error(String(originalError)),
        );
      }

      const delayMs = calculateLLMRetryDelay(
        errorInfo,
        failedAttempt.attemptNumber,
      );

      logger.warn("LLM API error. Will retry", {
        operationLabel,
        delaySeconds: Math.ceil(delayMs / 1000),
        attemptNumber: failedAttempt.attemptNumber,
        maxRetries,
        statusCode: errorInfo.statusCode,
        isRateLimit: errorInfo.isRateLimit,
        isServerError: errorInfo.isServerError,
        errorMessage: errorInfo.errorMessage.slice(0, 200),
      });

      // Apply the exponential backoff delay
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    },
  });
}
