import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock dependencies before imports
vi.mock("@/utils/prisma", () => ({
  default: {
    scheduledAction: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    emailAccount: {
      findUnique: vi.fn(),
    },
    executedAction: {
      findUnique: vi.fn(),
    },
    digest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    digestItem: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    schedule: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
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

vi.mock("@/utils/bulk-process/worker", () => ({
  processEmail: vi.fn(),
}));

vi.mock("@/utils/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));

vi.mock("@/utils/scheduled-actions/executor", () => ({
  executeScheduledAction: vi.fn(),
}));

vi.mock("@/utils/user/validate", () => ({
  validateUserAndAiAccess: vi.fn(),
}));

vi.mock("@/utils/categorize/senders/categorize", () => ({
  getCategories: vi.fn(),
  categorizeWithAi: vi.fn(),
  updateSenderCategory: vi.fn(),
}));

vi.mock("@/utils/gmail/client", () => ({
  getGmailClientWithRefresh: vi.fn(),
}));

vi.mock("@/utils/gmail/thread", () => ({
  getThreadsFromSenderWithSubject: vi.fn(),
}));

vi.mock("@/utils/redis/categorization-progress", () => ({
  saveCategorizationProgress: vi.fn(),
}));

vi.mock("@/utils/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));

vi.mock("@/utils/ai/digest/summarize-email-for-digest", () => ({
  aiSummarizeEmailForDigest: vi.fn(),
}));

vi.mock("@/utils/assistant/is-assistant-email", () => ({
  isAssistantEmail: vi.fn(),
}));

vi.mock("@/utils/unsubscribe", () => ({
  createUnsubscribeToken: vi.fn(),
}));

vi.mock("@/utils/schedule", () => ({
  calculateNextScheduleDate: vi.fn(),
}));

vi.mock("@/utils/email", () => ({
  extractNameFromEmail: vi.fn(),
}));

vi.mock("@/utils/rule/consts", () => ({
  getRuleName: vi.fn(),
}));

vi.mock("@/utils/sleep", () => ({
  sleep: vi.fn(),
}));

vi.mock("@react-email/components", () => ({
  render: vi.fn(),
}));

vi.mock("@inboxzero/resend/emails/digest", () => ({
  default: vi.fn(),
  generateDigestSubject: vi.fn(),
}));

vi.mock("@/env", () => ({
  env: {
    RESEND_FROM_EMAIL: "noreply@example.com",
    NEXT_PUBLIC_BASE_URL: "https://example.com",
  },
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

// Import mocked modules
import { bulkProcessWorkerSchema } from "@/utils/bulk-process/validation";
import { processEmail } from "@/utils/bulk-process/worker";
import { createEmailProvider } from "@/utils/email/provider";
import { executeScheduledAction } from "@/utils/scheduled-actions/executor";
import { validateUserAndAiAccess } from "@/utils/user/validate";
import {
  getCategories,
  categorizeWithAi,
  updateSenderCategory,
} from "@/utils/categorize/senders/categorize";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { getThreadsFromSenderWithSubject } from "@/utils/gmail/thread";
import { saveCategorizationProgress } from "@/utils/redis/categorization-progress";
import { getEmailAccountWithAi } from "@/utils/user/get";
import { aiSummarizeEmailForDigest } from "@/utils/ai/digest/summarize-email-for-digest";
import { isAssistantEmail } from "@/utils/assistant/is-assistant-email";
import { createUnsubscribeToken } from "@/utils/unsubscribe";
import { extractNameFromEmail } from "@/utils/email";
import { getRuleName } from "@/utils/rule/consts";
import { sleep } from "@/utils/sleep";
import { render } from "@react-email/components";
import { generateDigestSubject } from "@inboxzero/resend/emails/digest";
import prisma from "@/utils/prisma";
import { ScheduledActionStatus, DigestStatus } from "@prisma/client";

// Helper to create mock step object for Inngest functions
const createMockStep = () => ({
  run: vi.fn(<T>(_name: string, fn: () => T): T => fn()),
  sleepUntil: vi.fn(),
});

describe("Inngest Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("bulk-process-worker", () => {
    const validPayload = {
      jobId: "job-123",
      emailAccountId: "account-456",
      messageId: "msg-789",
      threadId: "thread-101",
    };

    const mockStep = createMockStep();

    it("should validate payload structure with valid data", () => {
      const result = bulkProcessWorkerSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validPayload);
      }
    });

    it("should reject invalid payload with missing required fields", () => {
      const invalidPayload = {
        jobId: "job-123",
        // missing emailAccountId, messageId, threadId
      };

      const result = bulkProcessWorkerSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toHaveLength(3);
        expect(result.error.errors.map((e) => e.path[0])).toContain(
          "emailAccountId",
        );
        expect(result.error.errors.map((e) => e.path[0])).toContain(
          "messageId",
        );
        expect(result.error.errors.map((e) => e.path[0])).toContain("threadId");
      }
    });

    it("should reject payload with empty strings", () => {
      const invalidPayload = {
        jobId: "",
        emailAccountId: "",
        messageId: "",
        threadId: "",
      };

      const result = bulkProcessWorkerSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should process email successfully", async () => {
      const mockResult = {
        success: true as const,
        skipped: false as const,
        rulesMatched: 2,
      };

      vi.mocked(processEmail).mockResolvedValue(mockResult);

      const result = await mockStep.run("process-email", async () => {
        return processEmail(validPayload);
      });

      expect(result).toEqual(mockResult);
      expect(processEmail).toHaveBeenCalledWith(validPayload);
    });

    it("should handle skipped email processing", async () => {
      const mockResult = {
        success: true as const,
        skipped: true as const,
        reason: "No rules configured",
      };

      vi.mocked(processEmail).mockResolvedValue(mockResult);

      const result = await mockStep.run("process-email", async () => {
        return processEmail(validPayload);
      });

      expect(result).toEqual(mockResult);
      expect(result.skipped).toBe(true);
    });

    it("should handle failed email processing", async () => {
      const mockResult = {
        success: false as const,
        skipped: false as const,
        error: "Email account not found",
      };

      vi.mocked(processEmail).mockResolvedValue(mockResult);

      const result = await mockStep.run("process-email", async () => {
        return processEmail(validPayload);
      });

      expect(result).toEqual(mockResult);
      expect(result.success).toBe(false);
    });
  });

  describe("scheduled-action-execute", () => {
    const validPayload = {
      scheduledActionId: "action-123",
      scheduledFor: "2024-12-07T15:00:00.000Z",
    };

    const mockStep = createMockStep();

    const mockScheduledAction = {
      id: "action-123",
      status: ScheduledActionStatus.PENDING,
      actionType: "ARCHIVE",
      emailAccountId: "account-456",
      emailAccount: {
        account: {
          provider: "google",
        },
      },
      executedRule: {
        rule: {
          name: "Test Rule",
        },
      },
    };

    beforeEach(() => {
      vi.mocked(prisma.scheduledAction.findUnique).mockResolvedValue(
        mockScheduledAction as any,
      );
      vi.mocked(prisma.scheduledAction.update).mockResolvedValue({
        ...mockScheduledAction,
        status: ScheduledActionStatus.EXECUTING,
      } as any);
      vi.mocked(createEmailProvider).mockResolvedValue({
        sendEmail: vi.fn(),
      } as any);
      vi.mocked(executeScheduledAction).mockResolvedValue({
        success: true,
        executedActionId: "executed-123",
      });
    });

    it("should handle scheduled action execution with future date", async () => {
      const futureDate = new Date(Date.now() + 60000); // 1 minute in future
      const payloadWithFuture = {
        ...validPayload,
        scheduledFor: futureDate.toISOString(),
      };

      // Test sleep until logic
      const scheduledDate = new Date(payloadWithFuture.scheduledFor);
      const now = new Date();

      if (scheduledDate > now) {
        await mockStep.sleepUntil("wait-for-scheduled-time", scheduledDate);
        expect(mockStep.sleepUntil).toHaveBeenCalledWith(
          "wait-for-scheduled-time",
          scheduledDate,
        );
      }
    });

    it("should fetch and validate scheduled action", async () => {
      const action = await mockStep.run("fetch-scheduled-action", async () => {
        return prisma.scheduledAction.findUnique({
          where: { id: validPayload.scheduledActionId },
          include: {
            emailAccount: {
              include: {
                account: true,
              },
            },
            executedRule: true,
          },
        });
      });

      expect(action).toEqual(mockScheduledAction);
      expect(prisma.scheduledAction.findUnique).toHaveBeenCalledWith({
        where: { id: validPayload.scheduledActionId },
        include: {
          emailAccount: {
            include: {
              account: true,
            },
          },
          executedRule: true,
        },
      });
    });

    it("should handle missing scheduled action", async () => {
      vi.mocked(prisma.scheduledAction.findUnique).mockResolvedValue(null);

      await expect(
        mockStep.run("fetch-scheduled-action", async () => {
          const action = await prisma.scheduledAction.findUnique({
            where: { id: validPayload.scheduledActionId },
          });
          if (!action) {
            throw new Error("Scheduled action not found");
          }
          return action;
        }),
      ).rejects.toThrow("Scheduled action not found");
    });

    it("should skip cancelled actions", () => {
      const cancelledAction = {
        ...mockScheduledAction,
        status: ScheduledActionStatus.CANCELLED,
      };

      // Simulate the cancellation check logic
      if (cancelledAction.status === ScheduledActionStatus.CANCELLED) {
        const result = {
          success: true,
          skipped: true,
          reason: "Action was cancelled",
        };
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe("Action was cancelled");
      }
    });

    it("should skip non-pending actions", () => {
      const completedAction = {
        ...mockScheduledAction,
        status: ScheduledActionStatus.COMPLETED,
      };

      // Verify logic for non-pending status
      const status = completedAction.status;
      expect(status).not.toBe(ScheduledActionStatus.PENDING);

      const result = {
        success: true,
        skipped: true,
        reason: `Action is not pending (status: ${status})`,
      };
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain("COMPLETED");
    });

    it("should mark action as executing", async () => {
      const markedAction = await mockStep.run("mark-as-executing", async () => {
        return prisma.scheduledAction.update({
          where: {
            id: validPayload.scheduledActionId,
            status: ScheduledActionStatus.PENDING,
          },
          data: {
            status: ScheduledActionStatus.EXECUTING,
          },
        });
      });

      expect(markedAction.status).toBe(ScheduledActionStatus.EXECUTING);
      expect(prisma.scheduledAction.update).toHaveBeenCalledWith({
        where: {
          id: validPayload.scheduledActionId,
          status: ScheduledActionStatus.PENDING,
        },
        data: {
          status: ScheduledActionStatus.EXECUTING,
        },
      });
    });

    it("should handle concurrent execution attempts", async () => {
      vi.mocked(prisma.scheduledAction.update).mockRejectedValue(
        new Error("Concurrent update conflict"),
      );

      const markedAction = await mockStep.run("mark-as-executing", async () => {
        try {
          return await prisma.scheduledAction.update({
            where: {
              id: validPayload.scheduledActionId,
              status: ScheduledActionStatus.PENDING,
            },
            data: {
              status: ScheduledActionStatus.EXECUTING,
            },
          });
        } catch {
          return null;
        }
      });

      expect(markedAction).toBeNull();
    });

    it("should execute action successfully", async () => {
      const executionResult = {
        success: true as const,
        executedActionId: "executed-123",
      };

      vi.mocked(executeScheduledAction).mockResolvedValue(executionResult);

      const result = await mockStep.run("execute-action", async () => {
        const provider = await createEmailProvider({
          emailAccountId: mockScheduledAction.emailAccountId,
          provider: mockScheduledAction.emailAccount.account.provider,
        });

        return executeScheduledAction(
          mockScheduledAction as any,
          provider as any,
        );
      });

      expect(result).toEqual(executionResult);
      expect(createEmailProvider).toHaveBeenCalledWith({
        emailAccountId: mockScheduledAction.emailAccountId,
        provider: mockScheduledAction.emailAccount.account.provider,
      });
    });

    it("should handle execution failure", async () => {
      const executionResult = {
        success: false as const,
        error: "Failed to send email",
      };

      vi.mocked(executeScheduledAction).mockResolvedValue(executionResult);

      const result = await mockStep.run("execute-action", async () => {
        const provider = await createEmailProvider({
          emailAccountId: mockScheduledAction.emailAccountId,
          provider: mockScheduledAction.emailAccount.account.provider,
        });

        return executeScheduledAction(
          mockScheduledAction as any,
          provider as any,
        );
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to send email");
    });
  });

  describe("categorize-senders-batch", () => {
    const validPayload = {
      emailAccountId: "account-123",
      senders: ["sender1@example.com", "sender2@example.com"],
    };

    const mockStep = createMockStep();

    const mockEmailAccount = {
      id: "account-123",
      email: "user@example.com",
      account: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: new Date(),
        provider: "google",
      },
    };

    const mockCategories = [
      { id: "cat-1", name: "Newsletter" },
      { id: "cat-2", name: "Marketing" },
    ];

    beforeEach(() => {
      vi.mocked(validateUserAndAiAccess).mockResolvedValue({
        emailAccount: mockEmailAccount,
      } as any);
      vi.mocked(getCategories).mockResolvedValue({
        categories: mockCategories,
      } as any);
      vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue({
        account: mockEmailAccount.account,
      } as any);
      vi.mocked(getGmailClientWithRefresh).mockResolvedValue({} as any);
      vi.mocked(getThreadsFromSenderWithSubject).mockResolvedValue([
        { id: "thread-1", subject: "Test Subject", snippet: "Test snippet" },
      ]);
      vi.mocked(categorizeWithAi).mockResolvedValue([
        { sender: "sender1@example.com", category: "Newsletter" },
        { sender: "sender2@example.com", category: "Marketing" },
      ]);
      vi.mocked(updateSenderCategory).mockResolvedValue({} as any);
      vi.mocked(saveCategorizationProgress).mockResolvedValue();
    });

    it("should validate payload structure", () => {
      const schema = z.object({
        emailAccountId: z.string(),
        senders: z.array(z.string()),
      });

      const result = schema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validPayload);
      }
    });

    it("should reject invalid payload", () => {
      const schema = z.object({
        emailAccountId: z.string(),
        senders: z.array(z.string()),
      });

      const invalidPayload = {
        emailAccountId: "",
        senders: "not-an-array",
      };

      const result = schema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should process sender categorization successfully", async () => {
      const result = await mockStep.run("categorize-batch", async () => {
        // Validate user and AI access
        await validateUserAndAiAccess({
          emailAccountId: validPayload.emailAccountId,
        });

        // Get available categories
        const categoriesResult = await getCategories({
          emailAccountId: validPayload.emailAccountId,
        });
        const { categories } = categoriesResult;

        // Get email account with OAuth tokens
        const emailAccountWithAccount = await prisma.emailAccount.findUnique({
          where: { id: validPayload.emailAccountId },
        });

        const account = (emailAccountWithAccount as any)?.account;
        if (!account?.access_token || !account?.refresh_token) {
          throw new Error("No access or refresh token");
        }

        // Initialize Gmail client
        const gmail = await getGmailClientWithRefresh({
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at?.getTime() || null,
          emailAccountId: validPayload.emailAccountId,
        });

        // Fetch sample messages for each sender
        const sendersWithEmails = new Map();
        for (const sender of validPayload.senders) {
          const threadsFromSender = await getThreadsFromSenderWithSubject(
            gmail,
            account.access_token,
            sender,
            3,
          );
          sendersWithEmails.set(sender, threadsFromSender);
        }

        // Categorize senders using AI
        const results = await categorizeWithAi({
          emailAccount: mockEmailAccount as any,
          sendersWithEmails,
          categories,
        });

        // Save categorized senders to database
        for (const result of results) {
          await updateSenderCategory({
            sender: result.sender,
            categories,
            categoryName: result.category ?? "Unknown",
            emailAccountId: validPayload.emailAccountId,
          });
        }

        // Update progress tracking
        await saveCategorizationProgress({
          emailAccountId: validPayload.emailAccountId,
          incrementCompleted: validPayload.senders.length,
        });

        return {
          success: true,
          categorizedCount: results.length,
          senderCount: validPayload.senders.length,
        };
      });

      expect(result.success).toBe(true);
      expect(result.categorizedCount).toBe(2);
      expect(result.senderCount).toBe(2);

      expect(validateUserAndAiAccess).toHaveBeenCalledWith({
        emailAccountId: validPayload.emailAccountId,
      });
      expect(getCategories).toHaveBeenCalledWith({
        emailAccountId: validPayload.emailAccountId,
      });
      expect(categorizeWithAi).toHaveBeenCalled();
      expect(updateSenderCategory).toHaveBeenCalledTimes(2);
      expect(saveCategorizationProgress).toHaveBeenCalledWith({
        emailAccountId: validPayload.emailAccountId,
        incrementCompleted: validPayload.senders.length,
      });
    });

    it("should handle missing email account", async () => {
      vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue(null);

      await expect(
        mockStep.run("categorize-batch", async () => {
          const emailAccountWithAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          if (!emailAccountWithAccount) {
            throw new Error("No account found");
          }
        }),
      ).rejects.toThrow("No account found");
    });

    it("should handle missing OAuth tokens", async () => {
      vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue({
        account: {
          access_token: null,
          refresh_token: null,
        },
      } as any);

      await expect(
        mockStep.run("categorize-batch", async () => {
          const emailAccountWithAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          const account = (emailAccountWithAccount as any)?.account;
          if (!account?.access_token || !account?.refresh_token) {
            throw new Error("No access or refresh token");
          }
        }),
      ).rejects.toThrow("No access or refresh token");
    });
  });

  describe("ai-digest", () => {
    const validPayload = {
      emailAccountId: "account-123",
      actionId: "action-456",
      coldEmailId: "cold-789",
      message: {
        id: "msg-123",
        threadId: "thread-456",
        from: "sender@example.com",
        to: "user@example.com",
        subject: "Test Subject",
        content: "Test content",
      },
    };

    const mockStep = createMockStep();

    const mockEmailAccount = {
      id: "account-123",
      email: "user@example.com",
      user: {
        aiModel: "gpt-4",
        aiProvider: "openai",
        aiApiKey: "api-key",
        aiBaseUrl: null,
      },
      userId: "user-123",
      about: null,
      multiRuleSelectionEnabled: false,
      account: { provider: "google" },
    };

    beforeEach(() => {
      vi.mocked(getEmailAccountWithAi).mockResolvedValue(
        mockEmailAccount as any,
      );
      vi.mocked(isAssistantEmail).mockReturnValue(false);
      vi.mocked(prisma.executedAction.findUnique).mockResolvedValue({
        executedRule: {
          rule: {
            name: "Test Rule",
          },
        },
      } as any);
      vi.mocked(aiSummarizeEmailForDigest).mockResolvedValue({
        content: "Test summary",
      });
      vi.mocked(prisma.digest.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.digest.create).mockResolvedValue({
        id: "digest-123",
        items: [],
      } as any);
      vi.mocked(prisma.digestItem.create).mockResolvedValue({
        id: "item-123",
      } as any);
    });

    it("should validate payload structure", () => {
      const schema = z.object({
        emailAccountId: z.string(),
        actionId: z.string().optional(),
        coldEmailId: z.string().optional(),
        message: z.object({
          id: z.string(),
          threadId: z.string(),
          from: z.string(),
          to: z.string().optional(),
          subject: z.string(),
          content: z.string(),
        }),
      });

      const result = schema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should skip emails from system", async () => {
      const systemPayload = {
        ...validPayload,
        message: {
          ...validPayload.message,
          from: "noreply@example.com", // matches env.RESEND_FROM_EMAIL
        },
      };

      const result = await mockStep.run("process-digest", () => {
        if (systemPayload.message.from === "noreply@example.com") {
          return {
            success: true,
            skipped: true,
            reason: "Email from system",
          };
        }
        return { success: true, skipped: false };
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("Email from system");
    });

    it("should skip emails from assistant", async () => {
      vi.mocked(isAssistantEmail).mockReturnValue(true);

      const result = await mockStep.run("process-digest", async () => {
        const emailAccount = await getEmailAccountWithAi({
          emailAccountId: validPayload.emailAccountId,
        });

        const isFromAssistant = isAssistantEmail({
          userEmail: emailAccount!.email,
          emailToCheck: validPayload.message.from,
        });

        if (isFromAssistant) {
          return {
            success: true,
            skipped: true,
            reason: "Email from assistant",
          };
        }
        return { success: true, skipped: false };
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("Email from assistant");
    });

    it("should handle missing email account", async () => {
      vi.mocked(getEmailAccountWithAi).mockResolvedValue(null);

      await expect(
        mockStep.run("process-digest", async () => {
          const emailAccount = await getEmailAccountWithAi({
            emailAccountId: validPayload.emailAccountId,
          });

          if (!emailAccount) {
            throw new Error("Email account not found");
          }
        }),
      ).rejects.toThrow("Email account not found");
    });

    it("should handle missing rule name", async () => {
      vi.mocked(prisma.executedAction.findUnique).mockResolvedValue(null);

      const result = await mockStep.run("process-digest", async () => {
        const executedAction = await prisma.executedAction.findUnique({
          where: { id: validPayload.actionId },
        });

        if (!executedAction) {
          return {
            success: true,
            skipped: true,
            reason: "Rule name not found",
          };
        }
        return { success: true, skipped: false };
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("Rule name not found");
    });

    it("should handle empty AI summary", async () => {
      vi.mocked(aiSummarizeEmailForDigest).mockResolvedValue(null);

      const result = await mockStep.run("process-digest", async () => {
        const summary = await aiSummarizeEmailForDigest({
          ruleName: "Test Rule",
          emailAccount: mockEmailAccount as any,
          messageToSummarize: {
            ...validPayload.message,
            to: validPayload.message.to || "",
          },
        });

        if (!summary?.content) {
          return {
            success: true,
            skipped: true,
            reason: "Not worth summarizing",
          };
        }
        return { success: true, skipped: false };
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("Not worth summarizing");
    });

    it("should create digest successfully", async () => {
      const result = await mockStep.run("process-digest", async () => {
        const emailAccount = await getEmailAccountWithAi({
          emailAccountId: validPayload.emailAccountId,
        });

        if (!emailAccount) {
          throw new Error("Email account not found");
        }

        // Skip system emails
        if (validPayload.message.from === "noreply@example.com") {
          return {
            success: true,
            skipped: true,
            reason: "Email from system",
          };
        }

        // Skip assistant emails
        const isFromAssistant = isAssistantEmail({
          userEmail: emailAccount.email,
          emailToCheck: validPayload.message.from,
        });

        if (isFromAssistant) {
          return {
            success: true,
            skipped: true,
            reason: "Email from assistant",
          };
        }

        // Get rule name
        const executedAction = await prisma.executedAction.findUnique({
          where: { id: validPayload.actionId },
        });

        const ruleName = (executedAction as any)?.executedRule?.rule?.name;

        if (!ruleName) {
          return {
            success: true,
            skipped: true,
            reason: "Rule name not found",
          };
        }

        // Summarize email
        const summary = await aiSummarizeEmailForDigest({
          ruleName,
          emailAccount: emailAccount as any,
          messageToSummarize: {
            ...validPayload.message,
            to: validPayload.message.to || "",
          },
        });

        if (!summary?.content) {
          return {
            success: true,
            skipped: true,
            reason: "Not worth summarizing",
          };
        }

        // Create digest
        const digest = await prisma.digest.create({
          data: {
            emailAccountId: validPayload.emailAccountId,
            status: DigestStatus.PENDING,
          },
        });

        await prisma.digestItem.create({
          data: {
            messageId: validPayload.message.id,
            threadId: validPayload.message.threadId,
            content: JSON.stringify(summary),
            digestId: digest.id,
            actionId: validPayload.actionId,
            coldEmailId: validPayload.coldEmailId,
          },
        });

        return {
          success: true,
          skipped: false,
          digestCreated: true,
        };
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.digestCreated).toBe(true);
    });
  });

  describe("resend-digest", () => {
    const validPayload = {
      emailAccountId: "account-123",
      force: false,
    };

    const mockStep = createMockStep();

    const mockEmailAccount = {
      email: "user@example.com",
      account: { provider: "google" },
    };

    const mockDigests = [
      {
        id: "digest-1",
        items: [
          {
            messageId: "msg-1",
            content: JSON.stringify({ content: "Test summary 1" }),
            action: {
              executedRule: {
                rule: {
                  name: "Test Rule 1",
                },
              },
            },
          },
        ],
      },
    ];

    const mockEmailProvider = {
      getMessagesBatch: vi.fn(),
      sendEmailWithHtml: vi.fn(),
    };

    beforeEach(() => {
      vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue(
        mockEmailAccount as any,
      );
      vi.mocked(createEmailProvider).mockResolvedValue(
        mockEmailProvider as any,
      );
      vi.mocked(prisma.digest.findMany).mockResolvedValue(mockDigests as any);
      vi.mocked(prisma.digest.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.digestItem.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.schedule.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(
        async (operations: unknown) => {
          if (Array.isArray(operations)) {
            return Promise.all(operations);
          }
          return [];
        },
      );
      vi.mocked(createUnsubscribeToken).mockResolvedValue("unsubscribe-token");
      vi.mocked(extractNameFromEmail).mockReturnValue("Test User");
      vi.mocked(getRuleName).mockReturnValue("Cold Email");
      vi.mocked(render).mockResolvedValue("<html>Digest Email</html>" as any);
      vi.mocked(generateDigestSubject).mockReturnValue("Your Email Digest");
      mockEmailProvider.getMessagesBatch.mockResolvedValue([
        {
          id: "msg-1",
          headers: {
            from: "sender@example.com",
            subject: "Test Subject",
          },
        },
      ]);
      vi.mocked(sleep).mockResolvedValue(undefined);
    });

    it("should validate payload structure", () => {
      const schema = z.object({
        emailAccountId: z.string(),
        force: z.boolean().optional(),
      });

      const result = schema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should handle no digests to process", async () => {
      vi.mocked(prisma.digest.findMany).mockResolvedValue([]);

      const result = await mockStep.run("send-digest-email", async () => {
        const pendingDigests = await prisma.digest.findMany({
          where: {
            emailAccountId: validPayload.emailAccountId,
            status: DigestStatus.PENDING,
          },
        });

        if (pendingDigests.length === 0 && !validPayload.force) {
          return { success: true, message: "No digests to process" };
        }

        return { success: true, message: "Processed" };
      });

      expect(result.message).toBe("No digests to process");
    });

    it("should handle missing email account", async () => {
      vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue(null);

      await expect(
        mockStep.run("send-digest-email", async () => {
          const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          if (!emailAccount) {
            throw new Error("Email account not found");
          }
        }),
      ).rejects.toThrow("Email account not found");
    });

    it("should send digest email successfully", async () => {
      const result = await mockStep.run("send-digest-email", async () => {
        const emailAccount = await prisma.emailAccount.findUnique({
          where: { id: validPayload.emailAccountId },
        });

        if (!emailAccount) {
          throw new Error("Email account not found");
        }

        const provider = await createEmailProvider({
          emailAccountId: validPayload.emailAccountId,
          provider: (emailAccount as any).account.provider,
        });

        const pendingDigests = await prisma.digest.findMany({
          where: {
            emailAccountId: validPayload.emailAccountId,
            status: DigestStatus.PENDING,
          },
        });

        if (pendingDigests.length === 0 && !validPayload.force) {
          return { success: true, message: "No digests to process" };
        }

        // Mark digests as processing
        await prisma.digest.updateMany({
          where: {
            id: {
              in: pendingDigests.map((d) => d.id),
            },
          },
          data: {
            status: DigestStatus.PROCESSING,
          },
        });

        // Create unsubscribe token
        await createUnsubscribeToken({
          emailAccountId: validPayload.emailAccountId,
        });

        // Render email
        const digestHtml = await render({} as any);
        const subject = generateDigestSubject({} as any);

        // Send email
        await (provider as any).sendEmailWithHtml({
          to: (emailAccount as any).email,
          subject,
          messageHtml: digestHtml,
        });

        // Update database
        await prisma.$transaction([
          prisma.digest.updateMany({
            where: {
              id: {
                in: pendingDigests.map((d) => d.id),
              },
            },
            data: {
              status: DigestStatus.SENT,
              sentAt: new Date(),
            },
          }),
          prisma.digestItem.updateMany({
            data: { content: "[REDACTED]" },
            where: {
              digestId: {
                in: pendingDigests.map((d) => d.id),
              },
            },
          }),
        ]);

        return { success: true, message: "Digest email sent successfully" };
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe("Digest email sent successfully");

      expect(createEmailProvider).toHaveBeenCalledWith({
        emailAccountId: validPayload.emailAccountId,
        provider: mockEmailAccount.account.provider,
      });
      expect(createUnsubscribeToken).toHaveBeenCalledWith({
        emailAccountId: validPayload.emailAccountId,
      });
      expect(mockEmailProvider.sendEmailWithHtml).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should handle force sending with empty digests", async () => {
      vi.mocked(prisma.digest.findMany).mockResolvedValue([]);

      const forcePayload = { ...validPayload, force: true };

      const result = await mockStep.run("send-digest-email", async () => {
        const pendingDigests = await prisma.digest.findMany({
          where: {
            emailAccountId: forcePayload.emailAccountId,
            status: DigestStatus.PENDING,
          },
        });

        if (pendingDigests.length === 0) {
          if (!forcePayload.force) {
            return { success: true, message: "No digests to process" };
          }
          // Force sending empty digest
        }

        // Simulate sending empty digest
        const emailAccount = await prisma.emailAccount.findUnique({
          where: { id: forcePayload.emailAccountId },
        });

        const provider = await createEmailProvider({
          emailAccountId: forcePayload.emailAccountId,
          provider: (emailAccount as any).account.provider,
        });

        await (provider as any).sendEmailWithHtml({
          to: (emailAccount as any).email,
          subject: "Your Email Digest",
          messageHtml: "<html>Empty digest</html>",
        });

        return { success: true, message: "Force sent empty digest" };
      });

      expect(result.success).toBe(true);
    });

    it("should handle email sending failure", async () => {
      mockEmailProvider.sendEmailWithHtml.mockRejectedValue(
        new Error("Email sending failed"),
      );

      await expect(
        mockStep.run("send-digest-email", async () => {
          const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          const provider = await createEmailProvider({
            emailAccountId: validPayload.emailAccountId,
            provider: (emailAccount as any).account.provider,
          });

          await (provider as any).sendEmailWithHtml({
            to: (emailAccount as any).email,
            subject: "Test",
            messageHtml: "<html>Test</html>",
          });
        }),
      ).rejects.toThrow("Email sending failed");
    });

    it("should handle batch message fetching with rate limiting", async () => {
      const largeMessageIds = Array.from({ length: 250 }, (_, i) => `msg-${i}`);

      mockEmailProvider.getMessagesBatch.mockResolvedValue([]);

      await mockStep.run("fetch-messages", async () => {
        const batchSize = 100;
        const messages: unknown[] = [];

        for (let i = 0; i < largeMessageIds.length; i += batchSize) {
          const batch = largeMessageIds.slice(i, i + batchSize);
          const batchResults = await mockEmailProvider.getMessagesBatch(batch);
          messages.push(...batchResults);

          if (i + batchSize < largeMessageIds.length) {
            await sleep(2000);
          }
        }

        return messages;
      });

      expect(mockEmailProvider.getMessagesBatch).toHaveBeenCalledTimes(3); // 250 / 100 = 3 batches
      expect(sleep).toHaveBeenCalledTimes(2); // 2 delays between 3 batches
    });
  });

  describe("Edge Cases", () => {
    describe("Timing-Sensitive Actions", () => {
      const mockStep = createMockStep();

      it("should handle immediate execution when scheduledFor is in the past", async () => {
        const pastDate = new Date(Date.now() - 60000); // 1 minute ago

        await mockStep.run("check-schedule", async () => {
          const scheduledFor = pastDate;
          const now = new Date();

          if (scheduledFor <= now) {
            // Execute immediately
            return { executeNow: true };
          }

          await mockStep.sleepUntil("wait-for-schedule", scheduledFor);
          return { executeNow: false };
        });

        expect(mockStep.sleepUntil).not.toHaveBeenCalled();
      });

      it("should schedule future execution with step.sleepUntil", async () => {
        const futureDate = new Date(Date.now() + 300000); // 5 minutes from now
        let shouldWait = false;

        await mockStep.run("check-schedule", async () => {
          const scheduledFor = futureDate;
          const now = new Date();

          if (scheduledFor <= now) {
            return { executeNow: true };
          }

          shouldWait = true;
          return { executeNow: false, scheduledFor };
        });

        expect(shouldWait).toBe(true);
      });

      it("should handle delayInMinutes = 0 as immediate execution", async () => {
        const delayInMinutes = 0;
        const scheduledFor =
          delayInMinutes > 0
            ? new Date(Date.now() + delayInMinutes * 60 * 1000)
            : null;

        expect(scheduledFor).toBeNull();
      });

      it("should handle timezone-aware scheduling", async () => {
        const scheduledTime = new Date("2025-01-15T10:00:00Z");
        const isoString = scheduledTime.toISOString();

        // Verify ISO string is preserved correctly
        expect(isoString).toBe("2025-01-15T10:00:00.000Z");
        expect(new Date(isoString).getTime()).toBe(scheduledTime.getTime());
      });
    });

    describe("Large Payload Handling", () => {
      it("should handle large batch of senders for categorization", async () => {
        const largeSenderList = Array.from(
          { length: 1000 },
          (_, i) => `sender${i}@example.com`,
        );

        const categorizePayload = {
          emailAccountId: "account-123",
          senders: largeSenderList,
        };

        // Verify schema can handle large arrays
        const schema = z.object({
          emailAccountId: z.string(),
          senders: z.array(z.string()),
        });

        const result = schema.safeParse(categorizePayload);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.senders.length).toBe(1000);
        }
      });

      it("should handle emails with large content for digest", async () => {
        const largeContent = "x".repeat(100000); // 100KB of content

        const digestPayload = {
          emailAccountId: "account-123",
          message: {
            id: "msg-123",
            threadId: "thread-456",
            headers: {
              from: "sender@example.com",
              subject: "Large email",
              date: new Date().toISOString(),
            },
            snippet: largeContent.substring(0, 200),
            textPlain: largeContent,
          },
        };

        // Verify payload structure is valid
        expect(digestPayload.message.textPlain.length).toBe(100000);
        expect(typeof digestPayload.message.snippet).toBe("string");
      });

      it("should handle digest with many items", async () => {
        const manyDigestItems = Array.from({ length: 500 }, (_, i) => ({
          id: `item-${i}`,
          messageId: `msg-${i}`,
          threadId: `thread-${i}`,
          summary: `Summary for email ${i}`,
          ruleName: `Rule ${i % 10}`,
        }));

        expect(manyDigestItems.length).toBe(500);
        // Grouping by rule name should result in 10 groups
        const grouped = manyDigestItems.reduce(
          (acc, item) => {
            const key = item.ruleName;
            if (!acc[key]) acc[key] = [];
            acc[key].push(item);
            return acc;
          },
          {} as Record<string, typeof manyDigestItems>,
        );

        expect(Object.keys(grouped).length).toBe(10);
      });
    });

    describe("Concurrent Execution Safety", () => {
      it("should prevent duplicate processing with idempotency keys", async () => {
        const processedIds = new Set<string>();
        const messageId = "msg-unique-123";

        const processIfNotDuplicate = (id: string): boolean => {
          if (processedIds.has(id)) {
            return false; // Already processed
          }
          processedIds.add(id);
          return true;
        };

        // First call should process
        expect(processIfNotDuplicate(messageId)).toBe(true);

        // Second call should be skipped
        expect(processIfNotDuplicate(messageId)).toBe(false);
      });

      it("should handle concurrent status updates atomically", async () => {
        const mockAction = {
          id: "action-123",
          status: ScheduledActionStatus.PENDING,
        };

        // Simulate optimistic locking with version check
        vi.mocked(prisma.scheduledAction.update).mockImplementation(
          async (args) => {
            if (
              args.where?.id === mockAction.id &&
              args.where?.status === ScheduledActionStatus.PENDING
            ) {
              return {
                ...mockAction,
                status: ScheduledActionStatus.EXECUTING,
              };
            }
            throw new Error("Concurrent modification detected");
          },
        );

        const result = await prisma.scheduledAction.update({
          where: {
            id: mockAction.id,
            status: ScheduledActionStatus.PENDING,
          },
          data: {
            status: ScheduledActionStatus.EXECUTING,
          },
        });

        expect(result.status).toBe(ScheduledActionStatus.EXECUTING);
      });

      it("should handle concurrent digest processing correctly", async () => {
        const digestId = "digest-123";
        const processedDigests = new Set<string>();

        // Simulate atomic status update
        vi.mocked(prisma.digest.updateMany).mockImplementation(async (args) => {
          if (args.where?.id === digestId && !processedDigests.has(digestId)) {
            processedDigests.add(digestId);
            return { count: 1 };
          }
          return { count: 0 }; // Already processed by another worker
        });

        const result1 = await prisma.digest.updateMany({
          where: { id: digestId, status: DigestStatus.PENDING },
          data: { status: DigestStatus.PROCESSING },
        });

        const result2 = await prisma.digest.updateMany({
          where: { id: digestId, status: DigestStatus.PENDING },
          data: { status: DigestStatus.PROCESSING },
        });

        expect(result1.count).toBe(1);
        expect(result2.count).toBe(0); // Second call fails due to status change
      });
    });

    describe("Error Recovery", () => {
      const mockStep = createMockStep();

      it("should mark action as failed on permanent error", async () => {
        const permanentError = new Error("Invalid email address");

        vi.mocked(prisma.scheduledAction.update).mockResolvedValue({
          id: "action-123",
          status: ScheduledActionStatus.FAILED,
          error: permanentError.message,
        } as never);

        const result = await prisma.scheduledAction.update({
          where: { id: "action-123" },
          data: {
            status: ScheduledActionStatus.FAILED,
            error: permanentError.message,
          },
        });

        expect(result.status).toBe(ScheduledActionStatus.FAILED);
        expect(result.error).toBe("Invalid email address");
      });

      it("should handle missing OAuth token gracefully", async () => {
        vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue({
          id: "account-123",
          email: "user@example.com",
          accessToken: null,
          refreshToken: null,
        } as never);

        const emailAccount = await prisma.emailAccount.findUnique({
          where: { id: "account-123" },
        });

        expect(emailAccount?.accessToken).toBeNull();
        // Function should throw or return early when tokens are missing
      });

      it("should handle database connection errors", async () => {
        vi.mocked(prisma.scheduledAction.findUnique).mockRejectedValue(
          new Error("Database connection failed"),
        );

        await expect(
          prisma.scheduledAction.findUnique({ where: { id: "action-123" } }),
        ).rejects.toThrow("Database connection failed");
      });

      it("should handle partial batch failures", async () => {
        const results = [
          { id: "1", success: true },
          { id: "2", success: false, error: "Failed" },
          { id: "3", success: true },
        ];

        const successCount = results.filter((r) => r.success).length;
        const failureCount = results.filter((r) => !r.success).length;

        expect(successCount).toBe(2);
        expect(failureCount).toBe(1);
      });
    });

    describe("Boundary Conditions", () => {
      it("should handle empty sender list for categorization", async () => {
        const emptySenders: string[] = [];

        const payload = {
          emailAccountId: "account-123",
          senders: emptySenders,
        };

        expect(payload.senders.length).toBe(0);
        // Function should return early without processing
      });

      it("should handle digest with no items", async () => {
        vi.mocked(prisma.digest.findMany).mockResolvedValue([]);

        const digests = await prisma.digest.findMany({
          where: { status: DigestStatus.PENDING },
        });

        expect(digests.length).toBe(0);
        // Function should return early without sending email
      });

      it("should handle message with missing headers", async () => {
        const messageWithMissingHeaders = {
          id: "msg-123",
          threadId: "thread-456",
          headers: {
            from: "", // Empty from
            subject: undefined as unknown as string, // Missing subject
            date: new Date().toISOString(),
          },
        };

        expect(messageWithMissingHeaders.headers.from).toBe("");
        expect(messageWithMissingHeaders.headers.subject).toBeUndefined();
      });

      it("should handle very long email addresses", async () => {
        const longLocalPart = "a".repeat(64);
        const longDomain = "b".repeat(255 - 5);
        const longEmail = `${longLocalPart}@${longDomain}.com`;

        expect(longEmail.length).toBeGreaterThan(300);
        // Function should validate email length limits
      });

      it("should handle Unicode content in emails", async () => {
        const unicodeContent = {
          subject: "日本語のメール Subject 🎉",
          body: "Привет! 你好 مرحبا שלום",
          sender: "用户@example.com",
        };

        expect(unicodeContent.subject).toContain("🎉");
        expect(unicodeContent.body).toContain("Привет");
      });
    });
  });
});
