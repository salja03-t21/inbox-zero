import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mock functions that can be referenced in vi.mock factories
const {
  mockInngestSend,
  mockIsInngestConfigured,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  getTestEnvConfig,
  setTestEnvConfig,
} = vi.hoisted(() => {
  let testEnvConfig: {
    INNGEST_EVENT_KEY?: string;
    INNGEST_SIGNING_KEY?: string;
    QSTASH_TOKEN?: string;
  } = {};

  return {
    mockInngestSend: vi.fn().mockResolvedValue({ ids: ["test-id"] }),
    mockIsInngestConfigured: vi.fn().mockReturnValue(false),
    mockLoggerInfo: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerError: vi.fn(),
    getTestEnvConfig: () => testEnvConfig,
    setTestEnvConfig: (config: typeof testEnvConfig) => {
      testEnvConfig = config;
    },
  };
});

// Mock environment and dependencies
vi.mock("@/env", () => ({
  env: {
    get INNGEST_EVENT_KEY() {
      return getTestEnvConfig().INNGEST_EVENT_KEY;
    },
    get INNGEST_SIGNING_KEY() {
      return getTestEnvConfig().INNGEST_SIGNING_KEY;
    },
    get QSTASH_TOKEN() {
      return getTestEnvConfig().QSTASH_TOKEN;
    },
    INTERNAL_API_KEY: "test-internal-key",
    WEBHOOK_URL: "https://test.example.com",
    NEXT_PUBLIC_BASE_URL: "https://test.example.com",
  },
}));

vi.mock("@/utils/inngest/client", () => ({
  inngest: {
    send: (...args: unknown[]) => mockInngestSend(...args),
  },
  isInngestConfigured: () => mockIsInngestConfigured(),
}));

vi.mock("@/utils/logger", () => ({
  createScopedLogger: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }),
}));

vi.mock("@/utils/sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/upstash", () => ({
  publishToQstash: vi.fn().mockResolvedValue(undefined),
  publishToQstashQueue: vi.fn().mockResolvedValue(undefined),
  bulkPublishToQstash: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import {
  getActiveProvider,
  enqueueJob,
  enqueueJobsBatch,
  cancelJob,
} from "@/utils/queue/index";

describe("Queue Abstraction Layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    setTestEnvConfig({});
    mockIsInngestConfigured.mockReturnValue(false);
    mockInngestSend.mockResolvedValue({ ids: ["test-id"] });
    // Reset fetch mock
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });
  });

  describe("getActiveProvider", () => {
    it("returns 'inngest' when Inngest is configured", () => {
      mockIsInngestConfigured.mockReturnValue(true);

      const provider = getActiveProvider();

      expect(provider).toBe("inngest");
    });

    it("returns 'qstash' when only QStash is configured", () => {
      mockIsInngestConfigured.mockReturnValue(false);
      setTestEnvConfig({ QSTASH_TOKEN: "test-qstash-token" });

      const provider = getActiveProvider();

      expect(provider).toBe("qstash");
    });

    it("returns 'fallback' when neither is configured", () => {
      mockIsInngestConfigured.mockReturnValue(false);
      setTestEnvConfig({});

      const provider = getActiveProvider();

      expect(provider).toBe("fallback");
    });

    it("prefers Inngest over QStash when both are configured", () => {
      mockIsInngestConfigured.mockReturnValue(true);
      setTestEnvConfig({ QSTASH_TOKEN: "test-qstash-token" });

      const provider = getActiveProvider();

      expect(provider).toBe("inngest");
    });
  });

  describe("enqueueJob", () => {
    describe("with Inngest provider", () => {
      beforeEach(() => {
        mockIsInngestConfigured.mockReturnValue(true);
      });

      it("successfully enqueues job via Inngest", async () => {
        const result = await enqueueJob({
          name: "inbox-zero/test.event",
          data: { userId: "user-123" },
        });

        expect(result.provider).toBe("inngest");
        expect(mockInngestSend).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "inbox-zero/test.event",
            data: { userId: "user-123" },
          }),
        );
      });

      it("includes scheduledFor in data when provided", async () => {
        const scheduledFor = new Date("2025-01-15T10:00:00Z");

        await enqueueJob({
          name: "inbox-zero/test.event",
          data: { userId: "user-123" },
          scheduledFor,
        });

        expect(mockInngestSend).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: "user-123",
              scheduledFor: scheduledFor.toISOString(),
            }),
          }),
        );
      });

      it("uses idempotencyKey as event ID when provided", async () => {
        await enqueueJob({
          name: "inbox-zero/test.event",
          data: { userId: "user-123" },
          idempotencyKey: "unique-key-123",
        });

        expect(mockInngestSend).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "unique-key-123",
          }),
        );
      });

      it("returns messageId from Inngest response", async () => {
        mockInngestSend.mockResolvedValue({ ids: ["inngest-msg-123"] });

        const result = await enqueueJob({
          name: "inbox-zero/test.event",
          data: { userId: "user-123" },
        });

        expect(result.messageId).toBe("inngest-msg-123");
      });
    });

    describe("with fallback provider", () => {
      beforeEach(() => {
        mockIsInngestConfigured.mockReturnValue(false);
        setTestEnvConfig({});
      });

      it("falls back to direct HTTP when no provider configured", async () => {
        const result = await enqueueJob({
          name: "inbox-zero/clean.process",
          data: { emailAccountId: "account-123" },
        });

        expect(result.provider).toBe("fallback");
        expect(global.fetch).toHaveBeenCalled();
      });

      it("converts event names to API paths correctly", async () => {
        await enqueueJob({
          name: "inbox-zero/clean.process",
          data: { emailAccountId: "account-123" },
        });

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/clean/process/simple"),
          expect.any(Object),
        );
      });

      it("uses INTERNAL_API_KEY for authentication", async () => {
        await enqueueJob({
          name: "inbox-zero/clean.process",
          data: { emailAccountId: "account-123" },
        });

        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              "x-api-key": "test-internal-key",
            }),
          }),
        );
      });

      it("logs warning when using fallback", async () => {
        await enqueueJob({
          name: "inbox-zero/test.event",
          data: {},
        });

        expect(mockLoggerWarn).toHaveBeenCalledWith(
          "Using fallback HTTP for job queue",
          expect.any(Object),
        );
      });
    });
  });

  describe("enqueueJobsBatch", () => {
    describe("with Inngest provider", () => {
      beforeEach(() => {
        mockIsInngestConfigured.mockReturnValue(true);
      });

      it("sends batch via Inngest when configured", async () => {
        const jobs = [
          { name: "inbox-zero/event1", data: { id: 1 } },
          { name: "inbox-zero/event2", data: { id: 2 } },
        ];

        const result = await enqueueJobsBatch(jobs);

        expect(result.provider).toBe("inngest");
        expect(result.count).toBe(2);
        expect(mockInngestSend).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "inbox-zero/event1" }),
            expect.objectContaining({ name: "inbox-zero/event2" }),
          ]),
        );
      });

      it("includes scheduledFor for jobs that have it", async () => {
        const scheduledFor = new Date("2025-01-15T10:00:00Z");
        const jobs = [
          { name: "inbox-zero/event1", data: { id: 1 }, scheduledFor },
          { name: "inbox-zero/event2", data: { id: 2 } },
        ];

        await enqueueJobsBatch(jobs);

        expect(mockInngestSend).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                scheduledFor: scheduledFor.toISOString(),
              }),
            }),
          ]),
        );
      });
    });

    describe("with fallback provider", () => {
      beforeEach(() => {
        mockIsInngestConfigured.mockReturnValue(false);
        setTestEnvConfig({});
      });

      it("sends sequentially in fallback mode", async () => {
        const jobs = [
          { name: "inbox-zero/event1", data: { id: 1 } },
          { name: "inbox-zero/event2", data: { id: 2 } },
        ];

        const result = await enqueueJobsBatch(jobs);

        expect(result.provider).toBe("fallback");
        expect(result.count).toBe(2);
        // Fetch should be called for each job
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("cancelJob", () => {
    it("logs warning when Inngest is the provider", async () => {
      mockIsInngestConfigured.mockReturnValue(true);

      const result = await cancelJob("some-message-id");

      expect(result).toBe(false);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "Job cancellation not supported for provider",
        expect.objectContaining({ provider: "inngest" }),
      );
    });

    it("logs warning for fallback provider", async () => {
      mockIsInngestConfigured.mockReturnValue(false);
      setTestEnvConfig({});

      const result = await cancelJob("some-message-id");

      expect(result).toBe(false);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "Job cancellation not supported for provider",
        expect.objectContaining({ provider: "fallback" }),
      );
    });
  });

  describe("logging", () => {
    it("logs job enqueueing with provider info", async () => {
      mockIsInngestConfigured.mockReturnValue(true);

      await enqueueJob({
        name: "inbox-zero/test.event",
        data: { userId: "user-123" },
      });

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Enqueueing job",
        expect.objectContaining({
          provider: "inngest",
          name: "inbox-zero/test.event",
        }),
      );
    });

    it("logs batch enqueueing with count", async () => {
      mockIsInngestConfigured.mockReturnValue(true);

      await enqueueJobsBatch([
        { name: "event1", data: {} },
        { name: "event2", data: {} },
      ]);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Enqueueing batch",
        expect.objectContaining({
          provider: "inngest",
          count: 2,
        }),
      );
    });
  });
});
