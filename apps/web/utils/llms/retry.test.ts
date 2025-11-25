import { describe, it, expect, vi } from "vitest";
import { APICallError, RetryError } from "ai";
import {
  extractLLMErrorInfo,
  isRetryableLLMError,
  calculateLLMRetryDelay,
  withLLMRetry,
} from "./retry";

// Mock the logger to avoid console output during tests
vi.mock("@/utils/logger", () => ({
  createScopedLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("extractLLMErrorInfo", () => {
  it("should extract info from APICallError with 429 status", () => {
    const error = new APICallError({
      message: "Rate limit exceeded",
      statusCode: 429,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
    });

    const info = extractLLMErrorInfo(error);
    expect(info.statusCode).toBe(429);
    expect(info.isRateLimit).toBe(true);
    expect(info.isServerError).toBe(false);
    expect(info.errorMessage).toBe("Rate limit exceeded");
  });

  it("should detect rate limit from error message", () => {
    const error = new Error("API rate limit exceeded for requests");

    const info = extractLLMErrorInfo(error);
    expect(info.isRateLimit).toBe(true);
  });

  it("should detect server errors from status code", () => {
    const error = new APICallError({
      message: "Service unavailable",
      statusCode: 503,
      url: "https://api.example.com",
      requestBodyValues: {},
      responseHeaders: undefined,
      responseBody: undefined,
      isRetryable: true,
    });

    const info = extractLLMErrorInfo(error);
    expect(info.statusCode).toBe(503);
    expect(info.isServerError).toBe(true);
    expect(info.isRateLimit).toBe(false);
  });

  it("should handle RetryError as rate limit", () => {
    const error = new RetryError({
      message: "Quota exceeded",
      reason: "RATE_LIMIT",
      errors: [],
    });

    const info = extractLLMErrorInfo(error);
    expect(info.statusCode).toBe(429);
    expect(info.isRateLimit).toBe(true);
  });
});

describe("isRetryableLLMError", () => {
  it("should return true for rate limit errors", () => {
    const info = {
      statusCode: 429,
      isRateLimit: true,
      isServerError: false,
      errorMessage: "Rate limit",
    };
    expect(isRetryableLLMError(info)).toBe(true);
  });

  it("should return true for server errors", () => {
    const info = {
      statusCode: 503,
      isRateLimit: false,
      isServerError: true,
      errorMessage: "Service unavailable",
    };
    expect(isRetryableLLMError(info)).toBe(true);
  });

  it("should return false for other errors", () => {
    const info = {
      statusCode: 400,
      isRateLimit: false,
      isServerError: false,
      errorMessage: "Bad request",
    };
    expect(isRetryableLLMError(info)).toBe(false);
  });
});

describe("calculateLLMRetryDelay", () => {
  it("should use exponential backoff for rate limits", () => {
    const info = {
      statusCode: 429,
      isRateLimit: true,
      isServerError: false,
      errorMessage: "Rate limit",
    };

    expect(calculateLLMRetryDelay(info, 1)).toBe(5000); // 5s
    expect(calculateLLMRetryDelay(info, 2)).toBe(10_000); // 10s
    expect(calculateLLMRetryDelay(info, 3)).toBe(20_000); // 20s
    expect(calculateLLMRetryDelay(info, 4)).toBe(40_000); // 40s
    expect(calculateLLMRetryDelay(info, 5)).toBe(80_000); // 80s (capped)
    expect(calculateLLMRetryDelay(info, 6)).toBe(80_000); // 80s (stays capped)
  });

  it("should use exponential backoff for server errors", () => {
    const info = {
      statusCode: 503,
      isRateLimit: false,
      isServerError: true,
      errorMessage: "Service unavailable",
    };

    expect(calculateLLMRetryDelay(info, 1)).toBe(2000); // 2s
    expect(calculateLLMRetryDelay(info, 2)).toBe(4000); // 4s
    expect(calculateLLMRetryDelay(info, 3)).toBe(8000); // 8s
    expect(calculateLLMRetryDelay(info, 4)).toBe(16_000); // 16s
    expect(calculateLLMRetryDelay(info, 5)).toBe(32_000); // 32s (capped)
  });

  it("should return 0 for non-retryable errors", () => {
    const info = {
      statusCode: 400,
      isRateLimit: false,
      isServerError: false,
      errorMessage: "Bad request",
    };
    expect(calculateLLMRetryDelay(info, 1)).toBe(0);
  });
});

describe("withLLMRetry", () => {
  it("should succeed without retry on successful call", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await withLLMRetry(operation);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry on rate limit error and eventually succeed", async () => {
    let attemptCount = 0;
    const operation = vi.fn(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new APICallError({
          message: "Rate limit exceeded",
          statusCode: 429,
          url: "https://api.example.com",
          requestBodyValues: {},
          responseHeaders: undefined,
          responseBody: undefined,
          isRetryable: true,
        });
      }
      return "success";
    });

    const result = await withLLMRetry(operation, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });

  it("should not retry on non-retryable error", async () => {
    const operation = vi.fn(async () => {
      throw new APICallError({
        message: "Invalid API key",
        statusCode: 401,
        url: "https://api.example.com",
        requestBodyValues: {},
        responseHeaders: undefined,
        responseBody: undefined,
        isRetryable: false,
      });
    });

    await expect(withLLMRetry(operation, { maxRetries: 3 })).rejects.toThrow(
      "Invalid API key",
    );
    expect(operation).toHaveBeenCalledTimes(1); // No retries
  });

  it("should exhaust retries and throw last error", async () => {
    const operation = vi.fn(async () => {
      throw new APICallError({
        message: "Rate limit exceeded",
        statusCode: 429,
        url: "https://api.example.com",
        requestBodyValues: {},
        responseHeaders: undefined,
        responseBody: undefined,
        isRetryable: true,
      });
    });

    await expect(withLLMRetry(operation, { maxRetries: 2 })).rejects.toThrow(
      "Rate limit exceeded",
    );
    expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });
});
