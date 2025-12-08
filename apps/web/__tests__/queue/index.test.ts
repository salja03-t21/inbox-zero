import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock environment before importing the module
const mockEnv = {
  INNGEST_EVENT_KEY: "",
  INNGEST_SIGNING_KEY: "",
  QSTASH_TOKEN: "",
  WEBHOOK_URL: "https://test.example.com",
  NEXT_PUBLIC_BASE_URL: "https://test.example.com",
  INTERNAL_API_KEY: "test-internal-key",
};

vi.mock("@/env", () => ({
  env: mockEnv,
}));

// Mock inngest client
const mockInngestSend = vi.fn();
vi.mock("@/utils/inngest/client", () => ({
  inngest: {
    send: mockInngestSend,
  },
  isInngestConfigured: vi.fn(() => false),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock sleep
vi.mock("@/utils/sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock upstash
const mockPublishToQstash = vi.fn();
const mockPublishToQstashQueue = vi.fn();
const mockBulkPublishToQstash = vi.fn();
vi.mock("@/utils/upstash", () => ({
  publishToQstash: mockPublishToQstash,
  publishToQstashQueue: mockPublishToQstashQueue,
  bulkPublishToQstash: mockBulkPublishToQstash,
}));

// Mock @upstash/qstash
const mockPublishJSON = vi.fn();
const mockHttpRequest = vi.fn();

class MockQstashClient {
  publishJSON = mockPublishJSON;
  http = {
    request: mockHttpRequest,
  };
}

vi.mock("@upstash/qstash", () => ({
  Client: MockQstashClient,
}));

// Mock date-fns
vi.mock("date-fns", () => ({
  getUnixTime: vi.fn((date: Date) => Math.floor(date.getTime() / 1000)),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Queue Abstraction Layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to defaults
    mockEnv.INNGEST_EVENT_KEY = "";
    mockEnv.INNGEST_SIGNING_KEY = "";
    mockEnv.QSTASH_TOKEN = "";

    // Reset mocked returns
    mockInngestSend.mockResolvedValue({ ids: ["test-id-123"] });
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("getActiveProvider", () => {
    it("should return 'inngest' when Inngest is configured", async () => {
      // Dynamically mock isInngestConfigured to return true
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(true);

      const { getActiveProvider } = await import("@/utils/queue");
      expect(getActiveProvider()).toBe("inngest");
    });

    it("should return 'qstash' when only QStash is configured", async () => {
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(false);
      mockEnv.QSTASH_TOKEN = "test-qstash-token";

      const { getActiveProvider } = await import("@/utils/queue");
      expect(getActiveProvider()).toBe("qstash");
    });

    it("should return 'fallback' when no queue providers are configured", async () => {
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(false);
      mockEnv.QSTASH_TOKEN = "";

      const { getActiveProvider } = await import("@/utils/queue");
      expect(getActiveProvider()).toBe("fallback");
    });

    it("should prefer Inngest over QStash when both are configured", async () => {
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(true);
      mockEnv.QSTASH_TOKEN = "test-qstash-token";

      const { getActiveProvider } = await import("@/utils/queue");
      expect(getActiveProvider()).toBe("inngest");
    });
  });

  describe("enqueueJob", () => {
    describe("via Inngest", () => {
      beforeEach(async () => {
        const { isInngestConfigured } = await import("@/utils/inngest/client");
        vi.mocked(isInngestConfigured).mockReturnValue(true);
      });

      it("should enqueue to Inngest with correct event format", async () => {
        const { enqueueJob } = await import("@/utils/queue");

        const result = await enqueueJob({
          name: "inbox-zero/test.event",
          data: { foo: "bar" },
        });

        expect(result.provider).toBe("inngest");
        expect(result.messageId).toBe("test-id-123");
        expect(mockInngestSend).toHaveBeenCalledWith({
          name: "inbox-zero/test.event",
          data: { foo: "bar" },
        });
      });

      it("should include scheduledFor in data when provided", async () => {
        const { enqueueJob } = await import("@/utils/queue");
        const scheduledFor = new Date("2025-01-01T12:00:00Z");

        await enqueueJob({
          name: "inbox-zero/test.event",
          data: { foo: "bar" },
          scheduledFor,
        });

        expect(mockInngestSend).toHaveBeenCalledWith({
          name: "inbox-zero/test.event",
          data: {
            foo: "bar",
            scheduledFor: "2025-01-01T12:00:00.000Z",
          },
        });
      });

      it("should include idempotency key when provided", async () => {
        const { enqueueJob } = await import("@/utils/queue");

        await enqueueJob({
          name: "inbox-zero/test.event",
          data: { foo: "bar" },
          idempotencyKey: "unique-key-123",
        });

        expect(mockInngestSend).toHaveBeenCalledWith({
          name: "inbox-zero/test.event",
          data: { foo: "bar" },
          id: "unique-key-123",
        });
      });
    });

    describe("via QStash", () => {
      beforeEach(async () => {
        const { isInngestConfigured } = await import("@/utils/inngest/client");
        vi.mocked(isInngestConfigured).mockReturnValue(false);
        mockEnv.QSTASH_TOKEN = "test-qstash-token";
      });

      it("should enqueue to QStash with standard publish", async () => {
        const { enqueueJob } = await import("@/utils/queue");

        const result = await enqueueJob({
          name: "/api/test",
          data: { foo: "bar" },
        });

        expect(result.provider).toBe("qstash");
        expect(mockPublishToQstash).toHaveBeenCalledWith("/api/test", {
          foo: "bar",
        });
      });

      it("should use queue-based publishing when queueName is specified", async () => {
        const { enqueueJob } = await import("@/utils/queue");

        await enqueueJob({
          name: "/api/test",
          data: { foo: "bar" },
          queueName: "test-queue",
          concurrency: 5,
        });

        expect(mockPublishToQstashQueue).toHaveBeenCalledWith({
          queueName: "test-queue",
          parallelism: 5,
          url: "https://test.example.com/api/test",
          body: { foo: "bar" },
        });
      });

      it("should use notBefore for scheduled jobs", async () => {
        const { enqueueJob } = await import("@/utils/queue");
        const scheduledFor = new Date("2025-01-01T12:00:00Z");
        mockPublishJSON.mockResolvedValue({
          messageId: "qstash-msg-123",
        });

        const result = await enqueueJob({
          name: "/api/test",
          data: { foo: "bar" },
          scheduledFor,
        });

        expect(result.provider).toBe("qstash");
        expect(result.messageId).toBe("qstash-msg-123");
        expect(mockPublishJSON).toHaveBeenCalledWith({
          url: "https://test.example.com/api/test",
          body: { foo: "bar" },
          notBefore: Math.floor(scheduledFor.getTime() / 1000),
        });
      });
    });

    describe("via Fallback", () => {
      beforeEach(async () => {
        const { isInngestConfigured } = await import("@/utils/inngest/client");
        vi.mocked(isInngestConfigured).mockReturnValue(false);
        mockEnv.QSTASH_TOKEN = "";
      });

      it("should use direct HTTP fallback when no providers configured", async () => {
        const { enqueueJob } = await import("@/utils/queue");

        const result = await enqueueJob({
          name: "inbox-zero/clean.process",
          data: { foo: "bar" },
        });

        expect(result.provider).toBe("fallback");
        expect(mockFetch).toHaveBeenCalledWith(
          "https://test.example.com/api/clean/process/simple",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({ foo: "bar" }),
          }),
        );
      });

      it("should convert Inngest event names to API paths", async () => {
        const { enqueueJob } = await import("@/utils/queue");

        await enqueueJob({
          name: "inbox-zero/bulk.process",
          data: {},
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "https://test.example.com/api/bulk/process/simple",
          expect.any(Object),
        );
      });

      it("should handle paths that already start with /", async () => {
        const { enqueueJob } = await import("@/utils/queue");

        await enqueueJob({
          name: "/api/custom/endpoint",
          data: {},
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "https://test.example.com/api/custom/endpoint/simple",
          expect.any(Object),
        );
      });
    });
  });

  describe("enqueueJobsBatch", () => {
    describe("via Inngest", () => {
      beforeEach(async () => {
        const { isInngestConfigured } = await import("@/utils/inngest/client");
        vi.mocked(isInngestConfigured).mockReturnValue(true);
      });

      it("should batch send multiple jobs to Inngest", async () => {
        const { enqueueJobsBatch } = await import("@/utils/queue");

        const jobs = [
          { name: "inbox-zero/event1", data: { id: 1 } },
          { name: "inbox-zero/event2", data: { id: 2 } },
          { name: "inbox-zero/event3", data: { id: 3 } },
        ];

        const result = await enqueueJobsBatch(jobs);

        expect(result.provider).toBe("inngest");
        expect(result.count).toBe(3);
        expect(mockInngestSend).toHaveBeenCalledWith([
          { name: "inbox-zero/event1", data: { id: 1 } },
          { name: "inbox-zero/event2", data: { id: 2 } },
          { name: "inbox-zero/event3", data: { id: 3 } },
        ]);
      });

      it("should include scheduledFor for batch jobs", async () => {
        const { enqueueJobsBatch } = await import("@/utils/queue");
        const scheduledFor = new Date("2025-01-01T12:00:00Z");

        await enqueueJobsBatch([
          { name: "inbox-zero/event1", data: { id: 1 }, scheduledFor },
        ]);

        expect(mockInngestSend).toHaveBeenCalledWith([
          {
            name: "inbox-zero/event1",
            data: { id: 1, scheduledFor: "2025-01-01T12:00:00.000Z" },
          },
        ]);
      });

      it("should include idempotency keys for batch jobs", async () => {
        const { enqueueJobsBatch } = await import("@/utils/queue");

        await enqueueJobsBatch([
          {
            name: "inbox-zero/event1",
            data: { id: 1 },
            idempotencyKey: "key-1",
          },
        ]);

        expect(mockInngestSend).toHaveBeenCalledWith([
          { name: "inbox-zero/event1", data: { id: 1 }, id: "key-1" },
        ]);
      });
    });

    describe("via QStash", () => {
      beforeEach(async () => {
        const { isInngestConfigured } = await import("@/utils/inngest/client");
        vi.mocked(isInngestConfigured).mockReturnValue(false);
        mockEnv.QSTASH_TOKEN = "test-qstash-token";
      });

      it("should use bulk publish to QStash", async () => {
        const { enqueueJobsBatch } = await import("@/utils/queue");

        const jobs = [
          { name: "/api/test1", data: { id: 1 } },
          { name: "/api/test2", data: { id: 2 } },
        ];

        const result = await enqueueJobsBatch(jobs);

        expect(result.provider).toBe("qstash");
        expect(result.count).toBe(2);
        expect(mockBulkPublishToQstash).toHaveBeenCalledWith({
          items: [
            { url: "https://test.example.com/api/test1", body: { id: 1 } },
            { url: "https://test.example.com/api/test2", body: { id: 2 } },
          ],
        });
      });

      it("should include flow control when queueName and concurrency specified", async () => {
        const { enqueueJobsBatch } = await import("@/utils/queue");

        await enqueueJobsBatch([
          {
            name: "/api/test",
            data: { id: 1 },
            queueName: "test-queue",
            concurrency: 3,
          },
        ]);

        expect(mockBulkPublishToQstash).toHaveBeenCalledWith({
          items: [
            {
              url: "https://test.example.com/api/test",
              body: { id: 1 },
              flowControl: { key: "test-queue", parallelism: 3 },
            },
          ],
        });
      });
    });

    describe("via Fallback", () => {
      beforeEach(async () => {
        const { isInngestConfigured } = await import("@/utils/inngest/client");
        vi.mocked(isInngestConfigured).mockReturnValue(false);
        mockEnv.QSTASH_TOKEN = "";
      });

      it("should send jobs sequentially via HTTP fallback", async () => {
        const { enqueueJobsBatch } = await import("@/utils/queue");

        const jobs = [
          { name: "/api/test1", data: { id: 1 } },
          { name: "/api/test2", data: { id: 2 } },
        ];

        const result = await enqueueJobsBatch(jobs);

        expect(result.provider).toBe("fallback");
        expect(result.count).toBe(2);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("cancelJob", () => {
    it("should cancel QStash message when QStash is active", async () => {
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(false);
      mockEnv.QSTASH_TOKEN = "test-qstash-token";
      mockHttpRequest.mockResolvedValue({});

      const { cancelJob } = await import("@/utils/queue");
      const result = await cancelJob("msg-123");

      expect(result).toBe(true);
      expect(mockHttpRequest).toHaveBeenCalledWith({
        path: ["v2", "messages", "msg-123"],
        method: "DELETE",
      });
    });

    it("should return false when cancellation fails", async () => {
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(false);
      mockEnv.QSTASH_TOKEN = "test-qstash-token";
      mockHttpRequest.mockRejectedValue(new Error("Not found"));

      const { cancelJob } = await import("@/utils/queue");
      const result = await cancelJob("msg-123");

      expect(result).toBe(false);
    });

    it("should return false for Inngest provider (not yet supported)", async () => {
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(true);

      const { cancelJob } = await import("@/utils/queue");
      const result = await cancelJob("msg-123");

      expect(result).toBe(false);
    });

    it("should return false for fallback provider", async () => {
      const { isInngestConfigured } = await import("@/utils/inngest/client");
      vi.mocked(isInngestConfigured).mockReturnValue(false);
      mockEnv.QSTASH_TOKEN = "";

      const { cancelJob } = await import("@/utils/queue");
      const result = await cancelJob("msg-123");

      expect(result).toBe(false);
    });
  });
});
