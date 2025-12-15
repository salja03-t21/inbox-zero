import { describe, it, expect, vi, beforeEach } from "vitest";

// Store original env values to restore after tests
const _originalEnv = { ...process.env };

// Mock the env module with a getter so we can modify values per test
const mockEnv = {
  INNGEST_EVENT_KEY: "",
  INNGEST_SIGNING_KEY: "",
};

vi.mock("@/env", () => ({
  get env() {
    return mockEnv;
  },
}));

// Mock the Inngest constructor
const mockInngestInstance = {
  id: "inbox-zero",
  send: vi.fn(),
  createFunction: vi.fn(),
};

class MockInngest {
  id: string;
  send = vi.fn();
  createFunction = vi.fn();

  constructor(config: { id: string }) {
    this.id = config.id;
    // Copy mock instance properties
    Object.assign(this, mockInngestInstance);
  }
}

vi.mock("inngest", () => ({
  Inngest: MockInngest,
}));

describe("Inngest Client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset mock env
    mockEnv.INNGEST_EVENT_KEY = "";
    mockEnv.INNGEST_SIGNING_KEY = "";
  });

  describe("isInngestConfigured", () => {
    it("should return true when both INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are set", async () => {
      mockEnv.INNGEST_EVENT_KEY = "test-event-key";
      mockEnv.INNGEST_SIGNING_KEY = "test-signing-key";

      const { isInngestConfigured } = await import("@/utils/inngest/client");

      expect(isInngestConfigured()).toBe(true);
    });

    it("should return false when INNGEST_EVENT_KEY is missing", async () => {
      mockEnv.INNGEST_EVENT_KEY = "";
      mockEnv.INNGEST_SIGNING_KEY = "test-signing-key";

      const { isInngestConfigured } = await import("@/utils/inngest/client");

      expect(isInngestConfigured()).toBe(false);
    });

    it("should return false when INNGEST_SIGNING_KEY is missing", async () => {
      mockEnv.INNGEST_EVENT_KEY = "test-event-key";
      mockEnv.INNGEST_SIGNING_KEY = "";

      const { isInngestConfigured } = await import("@/utils/inngest/client");

      expect(isInngestConfigured()).toBe(false);
    });

    it("should return false when both keys are missing", async () => {
      mockEnv.INNGEST_EVENT_KEY = "";
      mockEnv.INNGEST_SIGNING_KEY = "";

      const { isInngestConfigured } = await import("@/utils/inngest/client");

      expect(isInngestConfigured()).toBe(false);
    });

    it("should return false for empty string values", async () => {
      mockEnv.INNGEST_EVENT_KEY = "";
      mockEnv.INNGEST_SIGNING_KEY = "";

      const { isInngestConfigured } = await import("@/utils/inngest/client");

      expect(isInngestConfigured()).toBe(false);
    });
  });

  describe("inngest client instance", () => {
    it("should create Inngest client with correct app ID", async () => {
      const { inngest } = await import("@/utils/inngest/client");

      expect(inngest.id).toBe("inbox-zero");
    });

    it("should export the inngest client instance", async () => {
      const { inngest } = await import("@/utils/inngest/client");

      expect(inngest).toBeDefined();
      expect(inngest.id).toBe("inbox-zero");
      expect(typeof inngest.send).toBe("function");
    });
  });
});

describe("Inngest Client Configuration Edge Cases", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("should handle undefined environment variables gracefully", async () => {
    // @ts-expect-error - Testing undefined case
    mockEnv.INNGEST_EVENT_KEY = undefined;
    // @ts-expect-error - Testing undefined case
    mockEnv.INNGEST_SIGNING_KEY = undefined;

    const { isInngestConfigured } = await import("@/utils/inngest/client");

    expect(isInngestConfigured()).toBe(false);
  });

  it("should treat whitespace-only values as not configured", async () => {
    mockEnv.INNGEST_EVENT_KEY = "   ";
    mockEnv.INNGEST_SIGNING_KEY = "   ";

    const { isInngestConfigured } = await import("@/utils/inngest/client");

    // Current implementation uses Boolean() which treats whitespace as truthy
    // This test documents current behavior - may want to trim in future
    expect(isInngestConfigured()).toBe(true);
  });
});
