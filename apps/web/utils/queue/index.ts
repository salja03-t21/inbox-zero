import { env } from "@/env";
import { inngest, isInngestConfigured } from "@/utils/inngest/client";
import { createScopedLogger } from "@/utils/logger";
import { INTERNAL_API_KEY_HEADER } from "@/utils/internal-api";
import { sleep } from "@/utils/sleep";

const logger = createScopedLogger("queue");

export type QueueProvider = "inngest" | "qstash" | "fallback";

/**
 * Detect which queue provider is active based on environment configuration
 * Priority: Inngest > QStash > Direct HTTP Fallback
 */
export function getActiveProvider(): QueueProvider {
  if (isInngestConfigured()) {
    return "inngest";
  }
  if (env.QSTASH_TOKEN) {
    return "qstash";
  }
  return "fallback";
}

export interface EnqueueJobOptions<T> {
  /** Event name - use Inngest format (e.g., 'inbox-zero/clean.process'). Legacy paths like '/api/clean' also supported. */
  name: string;
  /** Job payload data */
  data: T;
  /** Optional: Schedule job for future execution */
  scheduledFor?: Date;
  /** Optional: Unique ID to prevent duplicate processing */
  idempotencyKey?: string;
  /** Optional: Queue name for grouping (used by QStash queues) */
  queueName?: string;
  /** Optional: Max concurrent jobs from this queue */
  concurrency?: number;
}

/**
 * Enqueue a job using the active provider
 * Automatically selects: Inngest → QStash → Direct HTTP
 */
export async function enqueueJob<T>(
  options: EnqueueJobOptions<T>,
): Promise<{ provider: QueueProvider; messageId?: string }> {
  const provider = getActiveProvider();

  logger.info("Enqueueing job", {
    provider,
    name: options.name,
    scheduledFor: options.scheduledFor,
    queueName: options.queueName,
  });

  switch (provider) {
    case "inngest":
      return enqueueViaInngest(options);
    case "qstash":
      return enqueueViaQstash(options);
    default:
      return enqueueViaFallback(options);
  }
}

/**
 * Enqueue multiple jobs in batch
 */
export async function enqueueJobsBatch<T>(
  jobs: EnqueueJobOptions<T>[],
): Promise<{ provider: QueueProvider; count: number }> {
  const provider = getActiveProvider();

  logger.info("Enqueueing batch", { provider, count: jobs.length });

  switch (provider) {
    case "inngest":
      // Inngest supports batch sending
      await inngest.send(
        jobs.map((job) => ({
          name: job.name,
          data: {
            ...job.data,
            ...(job.scheduledFor && {
              scheduledFor: job.scheduledFor.toISOString(),
            }),
          },
          ...(job.idempotencyKey && { id: job.idempotencyKey }),
        })),
      );
      return { provider, count: jobs.length };

    case "qstash": {
      // QStash batch - delegate to existing implementation
      const { bulkPublishToQstash } = await import("@/utils/upstash");
      const baseUrl = env.WEBHOOK_URL || env.NEXT_PUBLIC_BASE_URL;
      await bulkPublishToQstash({
        items: jobs.map((job) => ({
          url: `${baseUrl}${job.name}`,
          body: job.data,
          // Add flow control if queueName and concurrency are specified
          ...(job.queueName &&
            job.concurrency && {
              flowControl: {
                key: job.queueName,
                parallelism: job.concurrency,
              },
            }),
        })),
      });
      return { provider, count: jobs.length };
    }

    default:
      // Fallback: send sequentially
      for (const job of jobs) {
        await enqueueViaFallback(job);
      }
      return { provider, count: jobs.length };
  }
}

async function enqueueViaInngest<T>(
  options: EnqueueJobOptions<T>,
): Promise<{ provider: QueueProvider; messageId?: string }> {
  const result = await inngest.send({
    name: options.name,
    data: {
      ...options.data,
      // Pass scheduledFor in data - the Inngest function will use step.sleepUntil()
      ...(options.scheduledFor && {
        scheduledFor: options.scheduledFor.toISOString(),
      }),
    },
    ...(options.idempotencyKey && { id: options.idempotencyKey }),
  });

  return {
    provider: "inngest",
    messageId: Array.isArray(result.ids) ? result.ids[0] : undefined,
  };
}

async function enqueueViaQstash<T>(
  options: EnqueueJobOptions<T>,
): Promise<{ provider: QueueProvider; messageId?: string }> {
  // Delegate to existing QStash implementation
  const { publishToQstash, publishToQstashQueue } = await import(
    "@/utils/upstash"
  );
  const { Client } = await import("@upstash/qstash");

  const baseUrl = env.WEBHOOK_URL || env.NEXT_PUBLIC_BASE_URL;
  // Convert Inngest event names to API paths (same as fallback)
  const path = options.name.startsWith("/")
    ? options.name
    : `/${options.name.replace("inbox-zero/", "api/").replace(".", "/")}`;
  const url = `${baseUrl}${path}`;

  // If queue name is specified, use queue-based publishing
  if (options.queueName) {
    await publishToQstashQueue({
      queueName: options.queueName,
      parallelism: options.concurrency || 1,
      url,
      body: options.data,
    });
    return { provider: "qstash" };
  }

  // If scheduled, use direct client with notBefore
  if (options.scheduledFor) {
    const client = new Client({ token: env.QSTASH_TOKEN! });
    const { getUnixTime } = await import("date-fns");

    const response = await client.publishJSON({
      url,
      body: options.data,
      notBefore: getUnixTime(options.scheduledFor),
      ...(options.idempotencyKey && {
        deduplicationId: options.idempotencyKey,
        contentBasedDeduplication: false,
      }),
    });

    return {
      provider: "qstash",
      messageId: "messageId" in response ? response.messageId : undefined,
    };
  }

  // Standard publish
  await publishToQstash(options.name, options.data);
  return { provider: "qstash" };
}

async function enqueueViaFallback<T>(
  options: EnqueueJobOptions<T>,
): Promise<{ provider: QueueProvider }> {
  logger.warn("Using fallback HTTP for job queue", { name: options.name });

  const baseUrl = env.WEBHOOK_URL || env.NEXT_PUBLIC_BASE_URL;
  // Convert Inngest event names to API paths
  const path = options.name.startsWith("/")
    ? options.name
    : `/${options.name.replace("inbox-zero/", "api/").replace(".", "/")}`;

  const url = `${baseUrl}${path}/simple`;

  // Fire and forget with small delay to ensure request is sent
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [INTERNAL_API_KEY_HEADER]: env.INTERNAL_API_KEY,
    },
    body: JSON.stringify(options.data),
  }).catch((error) => {
    logger.error("Fallback HTTP request failed", { error, url });
  });

  await sleep(100);
  return { provider: "fallback" };
}

/**
 * Cancel a scheduled job (only works with QStash currently)
 */
export async function cancelJob(messageId: string): Promise<boolean> {
  const provider = getActiveProvider();

  if (provider === "qstash" && env.QSTASH_TOKEN) {
    try {
      const { Client } = await import("@upstash/qstash");
      const client = new Client({ token: env.QSTASH_TOKEN });
      await client.http.request({
        path: ["v2", "messages", messageId],
        method: "DELETE",
      });
      logger.info("Cancelled QStash message", { messageId });
      return true;
    } catch (error) {
      logger.error("Failed to cancel QStash message", { messageId, error });
      return false;
    }
  }

  // Inngest cancellation would need different approach (by run ID)
  // For now, return false - scheduled actions are also tracked in DB
  logger.warn("Job cancellation not supported for provider", {
    provider,
    messageId,
  });
  return false;
}
