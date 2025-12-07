import { inngest } from "../client";
import { createScopedLogger } from "@/utils/logger";
import type { ScheduledActionExecutePayload } from "../functions/scheduled-action-execute";

const logger = createScopedLogger("inngest/events/scheduled-action");

/**
 * Send an event to execute a scheduled action.
 *
 * This replaces the QStash scheduling logic. Instead of scheduling a webhook call,
 * we send an Inngest event that will be processed by the scheduled-action-execute function.
 *
 * @param scheduledActionId - The ID of the scheduled action to execute
 * @param scheduledFor - When the action should execute (ISO date string)
 * @returns The event ID from Inngest
 */
export async function sendScheduledActionExecuteEvent({
  scheduledActionId,
  scheduledFor,
}: {
  scheduledActionId: string;
  scheduledFor: Date;
}): Promise<string> {
  try {
    const payload: ScheduledActionExecutePayload = {
      scheduledActionId,
      scheduledFor: scheduledFor.toISOString(),
    };

    logger.info("Sending scheduled action execute event", {
      scheduledActionId,
      scheduledFor: payload.scheduledFor,
    });

    const { ids } = await inngest.send({
      name: "inbox-zero/scheduled-action.execute",
      data: payload,
    });

    const eventId = ids[0];

    logger.info("Successfully sent scheduled action execute event", {
      scheduledActionId,
      eventId,
      scheduledFor: payload.scheduledFor,
    });

    return eventId;
  } catch (error) {
    logger.error("Failed to send scheduled action execute event", {
      scheduledActionId,
      scheduledFor,
      error,
    });
    throw error;
  }
}

/**
 * Cancel a scheduled action event.
 *
 * Note: Inngest doesn't support cancelling events once they're sent.
 * Instead, the scheduled-action-execute function checks the action's status
 * before executing and skips if it's been cancelled.
 *
 * This function is kept for API compatibility but doesn't need to do anything
 * beyond updating the database status (which is handled by the caller).
 */
export async function cancelScheduledActionEvent({
  scheduledActionId,
}: {
  scheduledActionId: string;
}): Promise<void> {
  logger.info("Scheduled action marked for cancellation", {
    scheduledActionId,
    note: "Inngest function will skip execution when it checks status",
  });

  // No-op: The database status update is handled by the caller.
  // The Inngest function will check the status and skip if cancelled.
}
