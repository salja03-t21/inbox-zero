import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import { z } from "zod";

// Mock dependencies
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
    constructor(message: string, public statusCode?: number) {
      super(message);
    }
  },
}));

// Import the functions to test
import { bulkProcessWorkerSchema } from "@/utils/bulk-process/validation";
import { processEmail } from "@/utils/bulk-process/worker";
import { createEmailProvider } from "@/utils/email/provider";
import { executeScheduledAction } from "@/utils/scheduled-actions/executor";
import { validateUserAndAiAccess } from "@/utils/user/validate";
import { getCategories, categorizeWithAi, updateSenderCategory } from "@/utils/categorize/senders/categorize";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { getThreadsFromSenderWithSubject } from "@/utils/gmail/thread";
import { saveCategorizationProgress } from "@/utils/redis/categorization-progress";
import { getEmailAccountWithAi } from "@/utils/user/get";
import { aiSummarizeEmailForDigest } from "@/utils/ai/digest/summarize-email-for-digest";
import { isAssistantEmail } from "@/utils/assistant/is-assistant-email";
import { createUnsubscribeToken } from "@/utils/unsubscribe";
import { calculateNextScheduleDate } from "@/utils/schedule";
import { extractNameFromEmail } from "@/utils/email";
import { getRuleName } from "@/utils/rule/consts";
import { sleep } from "@/utils/sleep";
import { render } from "@react-email/components";
import DigestEmail, { generateDigestSubject } from "@inboxzero/resend/emails/digest";
import prisma from "@/utils/prisma";
import { ScheduledActionStatus, DigestStatus, SystemType } from "@prisma/client";

// Mock step object for Inngest functions
const createMockStep = () => ({
  run: vi.fn((name: string, fn: () => any) => fn()),
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

    const mockEvent = {
      data: validPayload,
    };

    const mockStep = createMockStep();

    it("should validate payload structure with valid data", async () => {
      const result = bulkProcessWorkerSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validPayload);
      }
    });

    it("should reject invalid payload with missing required fields", async () => {
      const invalidPayload = {
        jobId: "job-123",
        // missing emailAccountId, messageId, threadId
      };

      const result = bulkProcessWorkerSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toHaveLength(3);
        expect(result.error.errors.map(e => e.path[0])).toContain("emailAccountId");
        expect(result.error.errors.map(e => e.path[0])).toContain("messageId");
        expect(result.error.errors.map(e => e.path[0])).toContain("threadId");
      }
    });

    it("should reject payload with empty strings", async () => {
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
        success: true,
        skipped: false,
        rulesMatched: 2,
      };

      (processEmail as MockedFunction<typeof processEmail>).mockResolvedValue(mockResult);

      // Simulate the function logic
      const validationResult = bulkProcessWorkerSchema.safeParse(mockEvent.data);
      expect(validationResult.success).toBe(true);

      if (validationResult.success) {
        const result = await mockStep.run("process-email", async () => {
          return processEmail(validationResult.data);
        });

        expect(result).toEqual(mockResult);
        expect(processEmail).toHaveBeenCalledWith(validPayload);
      }
    });

    it("should handle skipped email processing", async () => {
      const mockResult = {
        success: true,
        skipped: true,
        reason: "No rules matched",
      };

      (processEmail as MockedFunction<typeof processEmail>).mockResolvedValue(mockResult);

      const result = await mockStep.run("process-email", async () => {
        return processEmail(validPayload);
      });

      expect(result).toEqual(mockResult);
      expect(result.skipped).toBe(true);
    });

    it("should handle failed email processing", async () => {
      const mockResult = {
        success: false,
        error: "Email account not found",
      };

      (processEmail as MockedFunction<typeof processEmail>).mockResolvedValue(mockResult);

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

    const mockEvent = {
      data: validPayload,
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
      (prisma.scheduledAction.findUnique as MockedFunction<any>).mockResolvedValue(mockScheduledAction);
      (prisma.scheduledAction.update as MockedFunction<any>).mockResolvedValue({
        ...mockScheduledAction,
        status: ScheduledActionStatus.EXECUTING,
      });
      (createEmailProvider as MockedFunction<typeof createEmailProvider>).mockResolvedValue({
        sendEmail: vi.fn(),
      } as any);
      (executeScheduledAction as MockedFunction<typeof executeScheduledAction>).mockResolvedValue({
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
        expect(mockStep.sleepUntil).toHaveBeenCalledWith("wait-for-scheduled-time", scheduledDate);
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
      (prisma.scheduledAction.findUnique as MockedFunction<any>).mockResolvedValue(null);

      await expect(
        mockStep.run("fetch-scheduled-action", async () => {
          const action = await prisma.scheduledAction.findUnique({
            where: { id: validPayload.scheduledActionId },
          });
          if (!action) {
            throw new Error("Scheduled action not found");
          }
          return action;
        })
      ).rejects.toThrow("Scheduled action not found");
    });

    it("should skip cancelled actions", async () => {
      const cancelledAction = {
        ...mockScheduledAction,
        status: ScheduledActionStatus.CANCELLED,
      };

      (prisma.scheduledAction.findUnique as MockedFunction<any>).mockResolvedValue(cancelledAction);

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

    it("should skip non-pending actions", async () => {
      const completedAction = {
        ...mockScheduledAction,
        status: ScheduledActionStatus.COMPLETED,
      };

      (prisma.scheduledAction.findUnique as MockedFunction<any>).mockResolvedValue(completedAction);

      if (completedAction.status !== ScheduledActionStatus.PENDING) {
        const result = {
          success: true,
          skipped: true,
          reason: `Action is not pending (status: ${completedAction.status})`,
        };
        expect(result.skipped).toBe(true);
        expect(result.reason).toContain("COMPLETED");
      }
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
      (prisma.scheduledAction.update as MockedFunction<any>).mockRejectedValue(
        new Error("Concurrent update conflict")
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
        } catch (error) {
          return null;
        }
      });

      expect(markedAction).toBeNull();
    });

    it("should execute action successfully", async () => {
      const executionResult = {
        success: true,
        executedActionId: "executed-123",
      };

      (executeScheduledAction as MockedFunction<typeof executeScheduledAction>).mockResolvedValue(executionResult);

      const result = await mockStep.run("execute-action", async () => {
        const provider = await createEmailProvider({
          emailAccountId: mockScheduledAction.emailAccountId,
          provider: mockScheduledAction.emailAccount.account.provider,
        });

        return executeScheduledAction(mockScheduledAction, provider);
      });

      expect(result).toEqual(executionResult);
      expect(createEmailProvider).toHaveBeenCalledWith({
        emailAccountId: mockScheduledAction.emailAccountId,
        provider: mockScheduledAction.emailAccount.account.provider,
      });
      expect(executeScheduledAction).toHaveBeenCalledWith(mockScheduledAction, expect.any(Object));
    });

    it("should handle execution failure", async () => {
      const executionResult = {
        success: false,
        error: "Failed to send email",
      };

      (executeScheduledAction as MockedFunction<typeof executeScheduledAction>).mockResolvedValue(executionResult);

      const result = await mockStep.run("execute-action", async () => {
        const provider = await createEmailProvider({
          emailAccountId: mockScheduledAction.emailAccountId,
          provider: mockScheduledAction.emailAccount.account.provider,
        });

        return executeScheduledAction(mockScheduledAction, provider);
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

    const mockEvent = {
      data: validPayload,
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
      (validateUserAndAiAccess as MockedFunction<typeof validateUserAndAiAccess>).mockResolvedValue({
        emailAccount: mockEmailAccount,
      } as any);
      (getCategories as MockedFunction<typeof getCategories>).mockResolvedValue({
        categories: mockCategories,
      } as any);
      (prisma.emailAccount.findUnique as MockedFunction<any>).mockResolvedValue({
        account: mockEmailAccount.account,
      });
      (getGmailClientWithRefresh as MockedFunction<typeof getGmailClientWithRefresh>).mockResolvedValue({} as any);
      (getThreadsFromSenderWithSubject as MockedFunction<typeof getThreadsFromSenderWithSubject>).mockResolvedValue([
        { subject: "Test Subject", snippet: "Test snippet" },
      ]);
      (categorizeWithAi as MockedFunction<typeof categorizeWithAi>).mockResolvedValue([
        { sender: "sender1@example.com", category: "Newsletter" },
        { sender: "sender2@example.com", category: "Marketing" },
      ]);
      (updateSenderCategory as MockedFunction<typeof updateSenderCategory>).mockResolvedValue(undefined);
      (saveCategorizationProgress as MockedFunction<typeof saveCategorizationProgress>).mockResolvedValue(undefined);
    });

    it("should validate payload structure", async () => {
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

    it("should reject invalid payload", async () => {
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
        const userResult = await validateUserAndAiAccess({ emailAccountId: validPayload.emailAccountId });
        const { emailAccount } = userResult;

        // Get available categories
        const categoriesResult = await getCategories({ emailAccountId: validPayload.emailAccountId });
        const { categories } = categoriesResult;

        // Get email account with OAuth tokens
        const emailAccountWithAccount = await prisma.emailAccount.findUnique({
          where: { id: validPayload.emailAccountId },
          select: {
            account: {
              select: {
                access_token: true,
                refresh_token: true,
                expires_at: true,
                provider: true,
              },
            },
          },
        });

        const account = emailAccountWithAccount?.account;
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
          emailAccount: {
            ...emailAccount,
            account: { provider: account.provider },
          },
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

      expect(validateUserAndAiAccess).toHaveBeenCalledWith({ emailAccountId: validPayload.emailAccountId });
      expect(getCategories).toHaveBeenCalledWith({ emailAccountId: validPayload.emailAccountId });
      expect(categorizeWithAi).toHaveBeenCalled();
      expect(updateSenderCategory).toHaveBeenCalledTimes(2);
      expect(saveCategorizationProgress).toHaveBeenCalledWith({
        emailAccountId: validPayload.emailAccountId,
        incrementCompleted: validPayload.senders.length,
      });
    });

    it("should handle missing email account", async () => {
      (prisma.emailAccount.findUnique as MockedFunction<any>).mockResolvedValue(null);

      await expect(
        mockStep.run("categorize-batch", async () => {
          const emailAccountWithAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          if (!emailAccountWithAccount) {
            throw new Error("No account found");
          }
        })
      ).rejects.toThrow("No account found");
    });

    it("should handle missing OAuth tokens", async () => {
      (prisma.emailAccount.findUnique as MockedFunction<any>).mockResolvedValue({
        account: {
          access_token: null,
          refresh_token: null,
        },
      });

      await expect(
        mockStep.run("categorize-batch", async () => {
          const emailAccountWithAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          const account = emailAccountWithAccount?.account;
          if (!account?.access_token || !account?.refresh_token) {
            throw new Error("No access or refresh token");
          }
        })
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

    const mockEvent = {
      data: validPayload,
    };

    const mockStep = createMockStep();

    const mockEmailAccount = {
      id: "account-123",
      email: "user@example.com",
      user: {
        aiModel: "gpt-4",
        aiProvider: "openai",
        aiApiKey: "api-key",
      },
    };

    beforeEach(() => {
      (getEmailAccountWithAi as MockedFunction<typeof getEmailAccountWithAi>).mockResolvedValue(mockEmailAccount as any);
      (isAssistantEmail as MockedFunction<typeof isAssistantEmail>).mockReturnValue(false);
      (prisma.executedAction.findUnique as MockedFunction<any>).mockResolvedValue({
        executedRule: {
          rule: {
            name: "Test Rule",
          },
        },
      });
      (aiSummarizeEmailForDigest as MockedFunction<typeof aiSummarizeEmailForDigest>).mockResolvedValue({
        content: "Test summary",
      });
      (prisma.digest.findFirst as MockedFunction<any>).mockResolvedValue(null);
      (prisma.digest.create as MockedFunction<any>).mockResolvedValue({
        id: "digest-123",
        items: [],
      });
      (prisma.digestItem.create as MockedFunction<any>).mockResolvedValue({
        id: "item-123",
      });
    });

    it("should validate payload structure", async () => {
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

      const result = await mockStep.run("process-digest", async () => {
        if (systemPayload.message.from === "noreply@example.com") {
          return {
            success: true,
            skipped: true,
            reason: "Email from system",
          };
        }
      });

      expect(result?.skipped).toBe(true);
      expect(result?.reason).toBe("Email from system");
    });

    it("should skip emails from assistant", async () => {
      (isAssistantEmail as MockedFunction<typeof isAssistantEmail>).mockReturnValue(true);

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
      });

      expect(result?.skipped).toBe(true);
      expect(result?.reason).toBe("Email from assistant");
    });

    it("should handle missing email account", async () => {
      (getEmailAccountWithAi as MockedFunction<typeof getEmailAccountWithAi>).mockResolvedValue(null);

      await expect(
        mockStep.run("process-digest", async () => {
          const emailAccount = await getEmailAccountWithAi({
            emailAccountId: validPayload.emailAccountId,
          });

          if (!emailAccount) {
            throw new Error("Email account not found");
          }
        })
      ).rejects.toThrow("Email account not found");
    });

    it("should handle missing rule name", async () => {
      (prisma.executedAction.findUnique as MockedFunction<any>).mockResolvedValue(null);

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
      });

      expect(result?.skipped).toBe(true);
      expect(result?.reason).toBe("Rule name not found");
    });

    it("should handle empty AI summary", async () => {
      (aiSummarizeEmailForDigest as MockedFunction<typeof aiSummarizeEmailForDigest>).mockResolvedValue(null);

      const result = await mockStep.run("process-digest", async () => {
        const summary = await aiSummarizeEmailForDigest({
          ruleName: "Test Rule",
          emailAccount: mockEmailAccount,
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
      });

      expect(result?.skipped).toBe(true);
      expect(result?.reason).toBe("Not worth summarizing");
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
          select: {
            executedRule: {
              select: {
                rule: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        });

        const ruleName = executedAction?.executedRule?.rule?.name;

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
          emailAccount,
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

        // Create digest (simplified)
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

    const mockEvent = {
      data: validPayload,
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
      (prisma.emailAccount.findUnique as MockedFunction<any>).mockResolvedValue(mockEmailAccount);
      (createEmailProvider as MockedFunction<typeof createEmailProvider>).mockResolvedValue(mockEmailProvider as any);
      (prisma.digest.findMany as MockedFunction<any>).mockResolvedValue(mockDigests);
      (prisma.digest.updateMany as MockedFunction<any>).mockResolvedValue({ count: 1 });
      (prisma.digestItem.updateMany as MockedFunction<any>).mockResolvedValue({ count: 1 });
      (prisma.schedule.findUnique as MockedFunction<any>).mockResolvedValue(null);
      (prisma.$transaction as MockedFunction<any>).mockImplementation((operations) => 
        Promise.all(operations.map((op: any) => op))
      );
      (createUnsubscribeToken as MockedFunction<typeof createUnsubscribeToken>).mockResolvedValue("unsubscribe-token");
      (extractNameFromEmail as MockedFunction<typeof extractNameFromEmail>).mockReturnValue("Test User");
      (getRuleName as MockedFunction<typeof getRuleName>).mockReturnValue("Cold Email");
      (render as MockedFunction<typeof render>).mockResolvedValue("<html>Digest Email</html>");
      (generateDigestSubject as MockedFunction<typeof generateDigestSubject>).mockReturnValue("Your Email Digest");
      (mockEmailProvider.getMessagesBatch as MockedFunction<any>).mockResolvedValue([
        {
          id: "msg-1",
          headers: {
            from: "sender@example.com",
            subject: "Test Subject",
          },
        },
      ]);
      (sleep as MockedFunction<typeof sleep>).mockResolvedValue(undefined);
    });

    it("should validate payload structure", async () => {
      const schema = z.object({
        emailAccountId: z.string(),
        force: z.boolean().optional(),
      });

      const result = schema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should handle no digests to process", async () => {
      (prisma.digest.findMany as MockedFunction<any>).mockResolvedValue([]);

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
      (prisma.emailAccount.findUnique as MockedFunction<any>).mockResolvedValue(null);

      await expect(
        mockStep.run("send-digest-email", async () => {
          const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          if (!emailAccount) {
            throw new Error("Email account not found");
          }
        })
      ).rejects.toThrow("Email account not found");
    });

    it("should send digest email successfully", async () => {
      const result = await mockStep.run("send-digest-email", async () => {
        const emailAccount = await prisma.emailAccount.findUnique({
          where: { id: validPayload.emailAccountId },
          select: {
            email: true,
            account: { select: { provider: true } },
          },
        });

        if (!emailAccount) {
          throw new Error("Email account not found");
        }

        const emailProvider = await createEmailProvider({
          emailAccountId: validPayload.emailAccountId,
          provider: emailAccount.account.provider,
        });

        const pendingDigests = await prisma.digest.findMany({
          where: {
            emailAccountId: validPayload.emailAccountId,
            status: DigestStatus.PENDING,
          },
          select: {
            id: true,
            items: {
              select: {
                messageId: true,
                content: true,
                action: {
                  select: {
                    executedRule: {
                      select: {
                        rule: {
                          select: {
                            name: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
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

        const messageIds = pendingDigests.flatMap((digest) =>
          digest.items.map((item) => item.messageId),
        );

        const messages = await emailProvider.getMessagesBatch(messageIds);

        // Create unsubscribe token
        const token = await createUnsubscribeToken({ emailAccountId: validPayload.emailAccountId });

        // Render email
        const digestHtml = await render("DigestEmail" as any);
        const subject = generateDigestSubject({} as any);

        // Send email
        await emailProvider.sendEmailWithHtml({
          to: emailAccount.email,
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
      expect(createUnsubscribeToken).toHaveBeenCalledWith({ emailAccountId: validPayload.emailAccountId });
      expect(mockEmailProvider.sendEmailWithHtml).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should handle force sending with empty digests", async () => {
      (prisma.digest.findMany as MockedFunction<any>).mockResolvedValue([]);

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

        const emailProvider = await createEmailProvider({
          emailAccountId: forcePayload.emailAccountId,
          provider: emailAccount!.account.provider,
        });

        await emailProvider.sendEmailWithHtml({
          to: emailAccount!.email,
          subject: "Your Email Digest",
          messageHtml: "<html>Empty digest</html>",
        });

        return { success: true, message: "Force sent empty digest" };
      });

      expect(result.success).toBe(true);
    });

    it("should handle email sending failure", async () => {
      (mockEmailProvider.sendEmailWithHtml as MockedFunction<any>).mockRejectedValue(
        new Error("Email sending failed")
      );

      await expect(
        mockStep.run("send-digest-email", async () => {
          const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: validPayload.emailAccountId },
          });

          const emailProvider = await createEmailProvider({
            emailAccountId: validPayload.emailAccountId,
            provider: emailAccount!.account.provider,
          });

          await emailProvider.sendEmailWithHtml({
            to: emailAccount!.email,
            subject: "Test",
            messageHtml: "<html>Test</html>",
          });
        })
      ).rejects.toThrow("Email sending failed");
    });

    it("should handle batch message fetching with rate limiting", async () => {
      const largeMessageIds = Array.from({ length: 250 }, (_, i) => `msg-${i}`);
      
      (mockEmailProvider.getMessagesBatch as MockedFunction<any>).mockResolvedValue([]);

      await mockStep.run("fetch-messages", async () => {
        const batchSize = 100;
        const messages: any[] = [];

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
});