import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { ScheduledActionStatus } from "@prisma/client";
import { createEmailProvider } from "@/utils/email/provider";
import { executeScheduledAction } from "@/utils/scheduled-actions/executor";

const logger = createScopedLogger("inngest/scheduled-action-execute");

/**
 * Event payload for scheduled action execution
 */
export interface ScheduledActionExecutePayload {
  scheduledActionId: string;
  scheduledFor?: string; // ISO date string - when the action should execute
}

/**
 * Inngest function to execute scheduled actions with delayed execution support.
 *
 * This replaces the QStash webhook endpoint at /api/scheduled-actions/execute.
 *
 * Key features:
 * - Uses step.sleepUntil() for delayed execution (replaces QStash scheduling)
 * - Validates action status before execution (handles cancellations)
 * - Marks action as executing to prevent duplicate processing
 * - Executes the action using existing executor logic
 * - Handles errors gracefully with retries
 *
 * Flow:
 * 1. Receive event with scheduledActionId and optional scheduledFor timestamp
 * 2. If scheduledFor is in the future, sleep until that time
 * 3. Fetch the scheduled action from database
 * 4. Validate it's still pending (not cancelled/completed)
 * 5. Mark as executing (prevents duplicate processing)
 * 6. Create email provider and execute the action
 * 7. Return success/failure result
 */
export const scheduledActionExecute = inngest.createFunction(
  {
    id: "scheduled-action-execute",
    name: "Execute Scheduled Action",
    retries: 3,
  },
  { event: "inbox-zero/scheduled-action.execute" },
  async ({ event, step }) => {
    const { scheduledActionId, scheduledFor } =
      event.data as ScheduledActionExecutePayload;

    logger.info("Processing scheduled action", {
      scheduledActionId,
      scheduledFor,
    });

    // Step 1: Wait until scheduled time if in the future
    if (scheduledFor) {
      const scheduledDate = new Date(scheduledFor);
      const now = new Date();

      if (scheduledDate > now) {
        logger.info("Sleeping until scheduled time", {
          scheduledActionId,
          scheduledFor,
          delayMs: scheduledDate.getTime() - now.getTime(),
        });

        await step.sleepUntil("wait-for-scheduled-time", scheduledDate);

        logger.info("Woke up at scheduled time", {
          scheduledActionId,
          scheduledFor,
        });
      }
    }

    // Step 2: Fetch and validate the scheduled action
    const scheduledAction = await step.run(
      "fetch-scheduled-action",
      async () => {
        const action = await prisma.scheduledAction.findUnique({
          where: { id: scheduledActionId },
          include: {
            emailAccount: {
              include: {
                account: true,
              },
            },
            executedRule: true,
          },
        });

        if (!action) {
          // Action may have been deleted or completed by another process
          // Return null to indicate it should be skipped (not an error)
          logger.info("Scheduled action not found, may have been deleted", {
            scheduledActionId,
          });
          return null;
        }

        logger.info("Fetched scheduled action", {
          scheduledActionId,
          status: action.status,
          actionType: action.actionType,
        });

        return action;
      },
    );

    // Step 3: Handle action not found (deleted or completed by another process)
    if (!scheduledAction) {
      return {
        success: true,
        skipped: true,
        reason: "Action not found (may have been deleted)",
      };
    }

    // Step 4: Check if action is still pending
    if (scheduledAction.status === ScheduledActionStatus.CANCELLED) {
      logger.info("Scheduled action was cancelled, skipping execution", {
        scheduledActionId,
      });
      return {
        success: true,
        skipped: true,
        reason: "Action was cancelled",
      };
    }

    if (scheduledAction.status !== ScheduledActionStatus.PENDING) {
      logger.warn("Scheduled action is not in pending status", {
        scheduledActionId,
        status: scheduledAction.status,
      });
      return {
        success: true,
        skipped: true,
        reason: `Action is not pending (status: ${scheduledAction.status})`,
      };
    }

    // Step 5: Mark as executing to prevent duplicate processing
    const markedAction = await step.run("mark-as-executing", async () => {
      try {
        const updated = await prisma.scheduledAction.update({
          where: {
            id: scheduledActionId,
            status: ScheduledActionStatus.PENDING,
          },
          data: {
            status: ScheduledActionStatus.EXECUTING,
          },
        });
        return updated;
      } catch (error) {
        // If update fails, the action might already be executing, completed, or cancelled
        logger.warn("Failed to mark action as executing", {
          scheduledActionId,
          error,
        });
        return null;
      }
    });

    if (!markedAction) {
      logger.warn("Action already being processed or completed", {
        scheduledActionId,
      });
      return {
        success: true,
        skipped: true,
        reason: "Action already being processed",
      };
    }

    // Step 6: Execute the action
    // Note: We re-fetch the action here to get proper Date types (step.run serializes Dates to strings)
    const result = await step.run("execute-action", async () => {
      // Re-fetch the action with fresh Date types for executeScheduledAction
      const freshAction = await prisma.scheduledAction.findUnique({
        where: { id: scheduledActionId },
        include: {
          emailAccount: {
            include: {
              account: true,
            },
          },
          executedRule: true,
        },
      });

      if (!freshAction) {
        throw new Error("Scheduled action not found during execution");
      }

      logger.info("Creating email provider and executing action", {
        scheduledActionId,
        emailAccountId: freshAction.emailAccountId,
        provider: freshAction.emailAccount.account.provider,
      });

      const provider = await createEmailProvider({
        emailAccountId: freshAction.emailAccountId,
        provider: freshAction.emailAccount.account.provider,
      });

      const executionResult = await executeScheduledAction(
        freshAction,
        provider,
      );

      if (executionResult.success) {
        logger.info("Successfully executed scheduled action", {
          scheduledActionId,
          executedActionId:
            "executedActionId" in executionResult
              ? executionResult.executedActionId
              : undefined,
        });
      } else {
        logger.error("Failed to execute scheduled action", {
          scheduledActionId,
          error: "error" in executionResult ? executionResult.error : undefined,
        });
      }

      return executionResult;
    });

    return {
      success: result.success,
      executedActionId:
        result.success && "executedActionId" in result
          ? result.executedActionId
          : undefined,
      error: !result.success && "error" in result ? result.error : undefined,
    };
  },
);
