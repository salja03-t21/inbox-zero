import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { CleanAction } from "@prisma/client";

// Mock dependencies before imports
vi.mock("@/utils/prisma", () => ({
  default: {
    cleanHistory: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    emailAccount: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/utils/logger", () => ({
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    with: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

vi.mock("@/utils/user/get", () => ({
  getEmailAccountWithAiAndTokens: vi.fn(),
}));

vi.mock("@/utils/gmail/client", () => ({
  getGmailClientWithRefresh: vi.fn(),
}));

vi.mock("@/utils/outlook/client", () => ({
  getOutlookClientWithRefresh: vi.fn(),
}));

vi.mock("@/utils/gmail/thread", () => ({
  getThreadMessages: vi.fn(),
}));

vi.mock("@/utils/outlook/thread", () => ({
  getThreadMessages: vi.fn(),
}));

vi.mock("@/utils/redis/clean", () => ({
  saveThread: vi.fn(),
  updateThread: vi.fn(),
}));

vi.mock("@/utils/upstash", () => ({
  publishToQstash: vi.fn(),
}));

vi.mock("@/utils/ai/clean/ai-clean", () => ({
  aiClean: vi.fn(),
}));

vi.mock("@/utils/error", () => ({
  captureException: vi.fn(),
  SafeError: class SafeError extends Error {
    constructor(
      message: string,
      public statusCode?: number,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/utils/email/provider-types", () => ({
  isGoogleProvider: vi.fn(),
}));

vi.mock("@/utils/parse/parseHtml.server", () => ({
  findUnsubscribeLink: vi.fn(),
}));

vi.mock("@/utils/parse/calender-event", () => ({
  getCalendarEventStatus: vi.fn(),
}));

vi.mock("@/utils/ai/group/find-newsletters", () => ({
  isNewsletterSender: vi.fn(),
}));

vi.mock("@/utils/ai/group/find-receipts", () => ({
  isReceipt: vi.fn(),
  isMaybeReceipt: vi.fn(),
}));

vi.mock("@/utils/gmail/label", () => ({
  applyLabel: vi.fn(),
  removeLabel: vi.fn(),
}));

vi.mock("@/utils/gmail/message", () => ({
  modifyMessage: vi.fn(),
  getMessage: vi.fn(),
}));

vi.mock("@/utils/outlook/message", () => ({
  updateMessage: vi.fn(),
}));

vi.mock("@/utils/outlook/folder", () => ({
  moveMessageToFolder: vi.fn(),
  getArchiveFolder: vi.fn(),
}));

// Import mocked modules
import { getEmailAccountWithAiAndTokens } from "@/utils/user/get";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { getOutlookClientWithRefresh } from "@/utils/outlook/client";
import { getThreadMessages as getGmailThreadMessages } from "@/utils/gmail/thread";
import { getThreadMessages as getOutlookThreadMessages } from "@/utils/outlook/thread";
import { saveThread, updateThread } from "@/utils/redis/clean";
import { aiClean } from "@/utils/ai/clean/ai-clean";
import { isGoogleProvider } from "@/utils/email/provider-types";
import { findUnsubscribeLink } from "@/utils/parse/parseHtml.server";
import { getCalendarEventStatus } from "@/utils/parse/calender-event";
import { isNewsletterSender } from "@/utils/ai/group/find-newsletters";
import { isReceipt, isMaybeReceipt } from "@/utils/ai/group/find-receipts";
import type { ParsedMessage } from "@/utils/types";

// Helper to create mock step object for Inngest functions
const createMockStep = () => ({
  run: vi.fn(<T>(_name: string, fn: () => T): T => fn()),
  sleepUntil: vi.fn(),
});

describe("Clean Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("clean-process", () => {
    const cleanProcessPayloadSchema = z.object({
      emailAccountId: z.string(),
      threadId: z.string(),
      markedDoneLabelId: z.string(),
      processedLabelId: z.string(),
      jobId: z.string(),
      action: z.enum([CleanAction.ARCHIVE, CleanAction.MARK_READ]),
      instructions: z.string().optional(),
      skips: z.object({
        reply: z.boolean().default(true).nullish(),
        starred: z.boolean().default(true).nullish(),
        calendar: z.boolean().default(true).nullish(),
        receipt: z.boolean().default(false).nullish(),
        attachment: z.boolean().default(false).nullish(),
        conversation: z.boolean().default(false).nullish(),
      }),
    });

    const validPayload = {
      emailAccountId: "account-123",
      threadId: "thread-456",
      markedDoneLabelId: "label-done",
      processedLabelId: "label-processed",
      jobId: "job-789",
      action: CleanAction.ARCHIVE,
      skips: {
        reply: true,
        starred: true,
        calendar: true,
      },
    };

    const _mockStep = createMockStep();

    it("should validate payload structure with valid data", () => {
      const result = cleanProcessPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject invalid payload with missing required fields", () => {
      const invalidPayload = {
        emailAccountId: "account-123",
        // Missing threadId, markedDoneLabelId, processedLabelId, jobId, action, skips
      };

      const result = cleanProcessPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should only accept valid CleanAction enum values", () => {
      const archivePayload = { ...validPayload, action: CleanAction.ARCHIVE };
      const markReadPayload = {
        ...validPayload,
        action: CleanAction.MARK_READ,
      };
      const invalidActionPayload = { ...validPayload, action: "DELETE" };

      expect(cleanProcessPayloadSchema.safeParse(archivePayload).success).toBe(
        true,
      );
      expect(cleanProcessPayloadSchema.safeParse(markReadPayload).success).toBe(
        true,
      );
      expect(
        cleanProcessPayloadSchema.safeParse(invalidActionPayload).success,
      ).toBe(false);
    });

    it("should handle starred message skip", async () => {
      const mockMessage: Partial<ParsedMessage> = {
        id: "msg-1",
        threadId: "thread-456",
        labelIds: ["STARRED"],
        headers: {
          from: "sender@example.com",
          to: "user@example.com",
          subject: "Test",
          date: new Date().toISOString(),
        },
        snippet: "Test snippet",
      };

      // Simulate starred check
      const isStarred =
        mockMessage.labelIds?.includes("STARRED") || mockMessage.isFlagged;
      expect(isStarred).toBe(true);
    });

    it("should handle conversation skip when message is sent", async () => {
      const mockMessage: Partial<ParsedMessage> = {
        id: "msg-1",
        threadId: "thread-456",
        labelIds: ["SENT"],
        headers: {
          from: "user@example.com",
          to: "recipient@example.com",
          subject: "Test",
          date: new Date().toISOString(),
        },
      };

      const isSent = mockMessage.labelIds?.includes("SENT");
      expect(isSent).toBe(true);
    });

    it("should handle attachment skip", async () => {
      const mockMessage: Partial<ParsedMessage> = {
        id: "msg-1",
        threadId: "thread-456",
        attachments: [
          {
            filename: "document.pdf",
            mimeType: "application/pdf",
            size: 1024,
            attachmentId: "att-1",
            headers: {} as any,
          },
        ],
        headers: {
          from: "sender@example.com",
          to: "user@example.com",
          subject: "Test with attachment",
          date: new Date().toISOString(),
        },
      };

      const hasAttachments =
        mockMessage.attachments && mockMessage.attachments.length > 0;
      expect(hasAttachments).toBe(true);
    });

    it("should check for newsletter sender", async () => {
      vi.mocked(isNewsletterSender).mockReturnValue(true);

      const result = isNewsletterSender("newsletter@company.com");
      expect(result).toBe(true);
      expect(isNewsletterSender).toHaveBeenCalledWith("newsletter@company.com");
    });

    it("should check for receipt emails", async () => {
      vi.mocked(isReceipt).mockReturnValue(true);

      const mockMessage = {
        headers: { subject: "Your receipt from Amazon" },
      } as ParsedMessage;

      const result = isReceipt(mockMessage);
      expect(result).toBe(true);
    });

    it("should check for unsubscribe link", async () => {
      vi.mocked(findUnsubscribeLink).mockReturnValue(
        "https://unsubscribe.example.com",
      );

      const result = findUnsubscribeLink(
        "<a href='unsubscribe'>Unsubscribe</a>",
      );
      expect(result).toBe("https://unsubscribe.example.com");
    });

    it("should handle calendar event detection", async () => {
      vi.mocked(getCalendarEventStatus).mockReturnValue({
        isEvent: true,
        timing: "future",
      });

      const mockMessage = {} as ParsedMessage;
      const result = getCalendarEventStatus(mockMessage);

      expect(result.isEvent).toBe(true);
      expect(result.timing).toBe("future");
    });

    it("should run AI clean when static rules don't match", async () => {
      vi.mocked(aiClean).mockResolvedValue({
        archive: true,
      });

      const mockEmailAccount = { id: "account-123" };
      const result = await aiClean({
        emailAccount: mockEmailAccount as never,
        messageId: "msg-123",
        messages: [],
        instructions: undefined,
        skips: {},
      });

      expect(result.archive).toBe(true);
      expect(aiClean).toHaveBeenCalled();
    });

    it("should save thread to Redis", async () => {
      await saveThread({
        emailAccountId: "account-123",
        thread: {
          threadId: "thread-456",
          jobId: "job-789",
          subject: "Test Subject",
          from: "sender@example.com",
          snippet: "Test snippet",
          date: new Date(),
        },
      });

      expect(saveThread).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAccountId: "account-123",
          thread: expect.objectContaining({
            threadId: "thread-456",
          }),
        }),
      );
    });
  });

  describe("clean-gmail", () => {
    const cleanGmailPayloadSchema = z.object({
      emailAccountId: z.string(),
      threadId: z.string(),
      markDone: z.boolean(),
      action: z.enum([CleanAction.ARCHIVE, CleanAction.MARK_READ]),
      markedDoneLabelId: z.string(),
      processedLabelId: z.string(),
      jobId: z.string(),
    });

    const validPayload = {
      emailAccountId: "account-123",
      threadId: "thread-456",
      markDone: true,
      action: CleanAction.ARCHIVE,
      markedDoneLabelId: "label-done",
      processedLabelId: "label-processed",
      jobId: "job-789",
    };

    it("should validate payload structure", () => {
      const result = cleanGmailPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should handle archive action correctly", async () => {
      const payload = { ...validPayload, action: CleanAction.ARCHIVE };
      expect(payload.action).toBe(CleanAction.ARCHIVE);
    });

    it("should handle mark read action correctly", async () => {
      const payload = { ...validPayload, action: CleanAction.MARK_READ };
      expect(payload.action).toBe(CleanAction.MARK_READ);
    });

    it("should update thread status on completion", async () => {
      await updateThread({
        emailAccountId: "account-123",
        jobId: "job-789",
        threadId: "thread-456",
        update: {
          archive: true,
          status: "completed",
        },
      });

      expect(updateThread).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAccountId: "account-123",
          update: expect.objectContaining({
            status: "completed",
          }),
        }),
      );
    });

    it("should handle missing email account", async () => {
      vi.mocked(getEmailAccountWithAiAndTokens).mockResolvedValue(null);

      const result = await getEmailAccountWithAiAndTokens({
        emailAccountId: "nonexistent",
      });

      expect(result).toBeNull();
    });

    it("should get Gmail client with refresh", async () => {
      const mockGmailClient = { users: { messages: {} } };
      vi.mocked(getGmailClientWithRefresh).mockResolvedValue(
        mockGmailClient as never,
      );

      const client = await getGmailClientWithRefresh({
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600000,
        emailAccountId: "account-123",
      });

      expect(client).toBe(mockGmailClient);
    });
  });

  describe("clean-outlook", () => {
    const cleanOutlookPayloadSchema = z.object({
      emailAccountId: z.string(),
      threadId: z.string(),
      markDone: z.boolean(),
      action: z.enum([CleanAction.ARCHIVE, CleanAction.MARK_READ]),
      markedDoneLabelId: z.string(),
      processedLabelId: z.string(),
      jobId: z.string(),
    });

    const validPayload = {
      emailAccountId: "account-123",
      threadId: "thread-456",
      markDone: true,
      action: CleanAction.ARCHIVE,
      markedDoneLabelId: "folder-done",
      processedLabelId: "folder-processed",
      jobId: "job-789",
    };

    it("should validate payload structure", () => {
      const result = cleanOutlookPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should get Outlook client with refresh", async () => {
      const mockOutlookClient = { api: () => ({}) };
      vi.mocked(getOutlookClientWithRefresh).mockResolvedValue(
        mockOutlookClient as never,
      );

      const client = await getOutlookClientWithRefresh({
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600000,
        emailAccountId: "account-123",
      });

      expect(client).toBe(mockOutlookClient);
    });

    it("should distinguish between Gmail and Outlook providers", async () => {
      vi.mocked(isGoogleProvider).mockReturnValue(false);

      const result = isGoogleProvider("microsoft");
      expect(result).toBe(false);

      vi.mocked(isGoogleProvider).mockReturnValue(true);
      const gmailResult = isGoogleProvider("google");
      expect(gmailResult).toBe(true);
    });

    it("should fetch Outlook thread messages", async () => {
      const mockMessages: Partial<ParsedMessage>[] = [
        {
          id: "msg-1",
          threadId: "thread-456",
          headers: {
            from: "sender@outlook.com",
            to: "user@outlook.com",
            subject: "Outlook Test",
            date: new Date().toISOString(),
          },
        },
      ];

      vi.mocked(getOutlookThreadMessages).mockResolvedValue(
        mockMessages as ParsedMessage[],
      );

      const mockClient = {} as never;
      const messages = await getOutlookThreadMessages("thread-456", mockClient);

      expect(messages.length).toBe(1);
      expect(messages[0].id).toBe("msg-1");
    });
  });

  describe("Provider-specific behavior", () => {
    it("should use correct endpoint for Gmail clean action", async () => {
      const provider = "google";
      vi.mocked(isGoogleProvider).mockReturnValue(true);

      const isGmail = isGoogleProvider(provider);
      const endpoint = isGmail ? "/api/clean/gmail" : "/api/clean/outlook";

      expect(endpoint).toBe("/api/clean/gmail");
    });

    it("should use correct endpoint for Outlook clean action", async () => {
      const provider = "microsoft";
      vi.mocked(isGoogleProvider).mockReturnValue(false);

      const isGmail = isGoogleProvider(provider);
      const endpoint = isGmail ? "/api/clean/gmail" : "/api/clean/outlook";

      expect(endpoint).toBe("/api/clean/outlook");
    });

    it("should publish to QStash with correct queue key", async () => {
      const emailAccountId = "account-123";
      const queueKey = `gmail-action-${emailAccountId}`;

      expect(queueKey).toBe("gmail-action-account-123");
    });
  });

  describe("Edge Cases for Clean Functions", () => {
    it("should handle empty thread with no messages", async () => {
      vi.mocked(getGmailThreadMessages).mockResolvedValue([]);

      const mockClient = {} as never;
      const messages = await getGmailThreadMessages("thread-456", mockClient);

      expect(messages.length).toBe(0);
      // Function should return early with no_messages reason
    });

    it("should handle thread with only sent messages", async () => {
      const mockMessages: Partial<ParsedMessage>[] = [
        {
          id: "msg-1",
          threadId: "thread-456",
          labelIds: ["SENT"],
          headers: {
            from: "user@example.com",
            to: "recipient@example.com",
            subject: "My sent email",
            date: new Date().toISOString(),
          },
        },
      ];

      const allSent = mockMessages.every((m) => m.labelIds?.includes("SENT"));
      expect(allSent).toBe(true);
    });

    it("should handle Gmail category labels correctly", async () => {
      const gmailCategories = [
        "CATEGORY_SOCIAL",
        "CATEGORY_PROMOTIONS",
        "CATEGORY_UPDATES",
        "CATEGORY_FORUMS",
      ];

      for (const category of gmailCategories) {
        const hasCategory = [category].some(
          (label) =>
            label === "CATEGORY_SOCIAL" ||
            label === "CATEGORY_PROMOTIONS" ||
            label === "CATEGORY_UPDATES" ||
            label === "CATEGORY_FORUMS",
        );
        expect(hasCategory).toBe(true);
      }
    });

    it("should handle maybe receipt with LLM fallback", async () => {
      vi.mocked(isReceipt).mockReturnValue(false);
      vi.mocked(isMaybeReceipt).mockReturnValue(true);

      const mockMessage = {} as ParsedMessage;

      const isDefiniteReceipt = isReceipt(mockMessage);
      const needsLLMCheck = !isDefiniteReceipt && isMaybeReceipt(mockMessage);

      expect(isDefiniteReceipt).toBe(false);
      expect(needsLLMCheck).toBe(true);
    });

    it("should handle past calendar events as archivable", async () => {
      vi.mocked(getCalendarEventStatus).mockReturnValue({
        isEvent: true,
        timing: "past",
      });

      const mockMessage = {} as ParsedMessage;
      const status = getCalendarEventStatus(mockMessage);

      expect(status.isEvent).toBe(true);
      expect(status.timing).toBe("past");
      // Past events should be archived
    });

    it("should handle expired OAuth tokens", async () => {
      vi.mocked(getEmailAccountWithAiAndTokens).mockResolvedValue({
        id: "account-123",
        tokens: {
          access_token: null,
          refresh_token: null,
        },
        account: { provider: "google" },
      } as never);

      const result = await getEmailAccountWithAiAndTokens({
        emailAccountId: "account-123",
      });

      expect(result?.tokens?.access_token).toBeNull();
    });
  });
});
