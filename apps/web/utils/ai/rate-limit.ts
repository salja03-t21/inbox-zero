import { redis } from "@/utils/redis";
import { SafeError } from "@/utils/error";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("ai/rate-limit");

export interface RateLimitConfig {
  limit: number; // requests per window
  windowSeconds: number; // time window in seconds
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  "choose-rule": { limit: 10_000, windowSeconds: 3600 }, // 10000 per hour
  "generate-draft": { limit: 50, windowSeconds: 3600 }, // 50 per hour
  categorize: { limit: 200, windowSeconds: 3600 }, // 200 per hour
  default: { limit: 100, windowSeconds: 3600 },
};

/**
 * Check rate limit for AI operations to prevent abuse
 * Uses sliding window rate limiting
 */
export async function checkAIRateLimit(
  emailAccountId: string,
  operation: string,
  customConfig?: RateLimitConfig,
): Promise<void> {
  const config =
    customConfig || DEFAULT_CONFIGS[operation] || DEFAULT_CONFIGS.default;
  const key = `ai:ratelimit:${emailAccountId}:${operation}`;

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      // Set expiry on first request
      await redis.expire(key, config.windowSeconds);
    }

    if (current > config.limit) {
      logger.warn("AI rate limit exceeded", {
        emailAccountId,
        operation,
        current,
        limit: config.limit,
      });

      throw new SafeError("Rate limit exceeded. Please try again later.", 429);
    }

    // Log warning when approaching limit
    if (current > config.limit * 0.8) {
      logger.info("Approaching AI rate limit", {
        emailAccountId,
        operation,
        current,
        limit: config.limit,
        percentUsed: Math.round((current / config.limit) * 100),
      });
    }
  } catch (error) {
    // If Redis fails, log but don't block the request
    if (error instanceof SafeError) {
      throw error;
    }

    logger.error("Rate limit check failed", {
      error,
      emailAccountId,
      operation,
    });
    // Continue without rate limiting if Redis is down
  }
}

/**
 * Get current rate limit status for an operation
 */
export async function getRateLimitStatus(
  emailAccountId: string,
  operation: string,
): Promise<{
  current: number;
  limit: number;
  remaining: number;
  resetAt: Date;
}> {
  const config = DEFAULT_CONFIGS[operation] || DEFAULT_CONFIGS.default;
  const key = `ai:ratelimit:${emailAccountId}:${operation}`;

  try {
    const current = (await redis.get(key)) || 0;
    const ttl = await redis.ttl(key);
    const resetAt = new Date(
      Date.now() + (ttl > 0 ? ttl * 1000 : config.windowSeconds * 1000),
    );

    return {
      current: Number(current),
      limit: config.limit,
      remaining: Math.max(0, config.limit - Number(current)),
      resetAt,
    };
  } catch (error) {
    logger.error("Failed to get rate limit status", {
      error,
      emailAccountId,
      operation,
    });

    return {
      current: 0,
      limit: config.limit,
      remaining: config.limit,
      resetAt: new Date(Date.now() + config.windowSeconds * 1000),
    };
  }
}
