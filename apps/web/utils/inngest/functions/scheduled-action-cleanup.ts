import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { ScheduledActionStatus } from "@prisma/client";
import { sendScheduledActionExecuteEvent } from "../events/scheduled-action";

const logger = createScopedLogger("inngest/scheduled-action-cleanup");

/**
 * Event-based cleanup for stuck scheduled actions.
 *
 * This function is triggered by the "inbox-zero/cleanup.scheduled-actions" event
 * and runs every time the event is received. Each run schedules the next cleanup
 * event 5 minutes in the future, creating a self-perpetuating cleanup cycle.
 *
 * This approach works reliably with self-hosted Inngest without requiring
 * cron support or function registration polling.
 *
 * The function checks for:
 * 1. PENDING actions that are past their scheduledFor time
 * 2. Re-triggers them by sending a new execute event
 *
 * This handles cases where:
 * - Inngest was restarted and step.sleepUntil() functions were lost
 * - Functions failed to initialize properly
 * - Events were somehow missed
 */
export const scheduledActionCleanup = inngest.createFunction(
  {
    id: "scheduled-action-cleanup",
    name: "Cleanup Stuck Scheduled Actions",
  },
  { event: "inbox-zero/cleanup.scheduled-actions" },
  async ({ step }) => {
    logger.info("Starting scheduled action cleanup");

    // Find all PENDING actions that should have been executed
    const overdueActions = await step.run("find-overdue-actions", async () => {
      const actions = await prisma.scheduledAction.findMany({
        where: {
          status: ScheduledActionStatus.PENDING,
          scheduledFor: {
            lt: new Date(),
          },
        },
        orderBy: {
          scheduledFor: "asc",
        },
        take: 100, // Process in batches to avoid overwhelming the system
      });

      logger.info("Found overdue actions", {
        count: actions.length,
      });

      return actions;
    });

    if (overdueActions.length === 0) {
      logger.info("No overdue actions to process");
      return { processed: 0 };
    }

    // Re-trigger each overdue action
    const results = await step.run("retrigger-actions", async () => {
      const retriggered: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];

      for (const action of overdueActions) {
        try {
          const scheduledForDate = new Date(action.scheduledFor);
          logger.info("Re-triggering overdue action", {
            scheduledActionId: action.id,
            scheduledFor: action.scheduledFor,
            actionType: action.actionType,
            overdueBy: Date.now() - scheduledForDate.getTime(),
          });

          // Send event to execute immediately (no scheduledFor delay)
          await sendScheduledActionExecuteEvent({
            scheduledActionId: action.id,
            // Don't include scheduledFor so it executes immediately
          });

          retriggered.push(action.id);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error("Failed to re-trigger action", {
            scheduledActionId: action.id,
            error: errorMessage,
          });
          failed.push({ id: action.id, error: errorMessage });
        }
      }

      return { retriggered, failed };
    });

    logger.info("Cleanup complete", {
      total: overdueActions.length,
      retriggered: results.retriggered.length,
      failed: results.failed.length,
    });

    // Schedule the next cleanup in 5 minutes to create a self-perpetuating cycle
    await step.sendEvent("schedule-next-cleanup", {
      name: "inbox-zero/cleanup.scheduled-actions",
      data: {
        scheduledBy: "cleanup-cycle",
        timestamp: new Date().toISOString(),
      },
      // Use Inngest's built-in delay to schedule 5 minutes from now
      ts: Date.now() + 5 * 60 * 1000, // 5 minutes in milliseconds
    });

    logger.info("Scheduled next cleanup in 5 minutes");

    return {
      processed: overdueActions.length,
      retriggered: results.retriggered.length,
      failed: results.failed.length,
      failedActions: results.failed,
    };
  },
);
