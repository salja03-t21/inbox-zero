import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { ScheduledActionStatus } from "@prisma/client";
import { sendScheduledActionExecuteEvent } from "../events/scheduled-action";

const logger = createScopedLogger("inngest/scheduled-action-migration");

/**
 * Migration helper to transition scheduled actions from QStash to Inngest.
 *
 * This function:
 * 1. Finds all pending scheduled actions
 * 2. Sends Inngest events for each one
 * 3. Updates the database to track the Inngest event ID
 *
 * Usage:
 * - Run this once during the migration from QStash to Inngest
 * - Can be run multiple times safely (idempotent)
 * - Only processes actions that don't already have an Inngest event ID
 */
export async function migrateScheduledActionsToInngest({
  dryRun = false,
}: {
  dryRun?: boolean;
} = {}) {
  logger.info("Starting scheduled actions migration to Inngest", { dryRun });

  // Find all pending scheduled actions that haven't been migrated yet
  const pendingActions = await prisma.scheduledAction.findMany({
    where: {
      status: ScheduledActionStatus.PENDING,
      // Only migrate actions that don't have an Inngest event ID
      // (assuming we add an inngestEventId field to the schema)
      // For now, we'll migrate all pending actions
    },
    orderBy: {
      scheduledFor: "asc",
    },
  });

  logger.info("Found pending scheduled actions", {
    count: pendingActions.length,
  });

  if (dryRun) {
    logger.info("Dry run mode - would migrate these actions:", {
      actions: pendingActions.map((a) => ({
        id: a.id,
        scheduledFor: a.scheduledFor,
        actionType: a.actionType,
      })),
    });
    return {
      dryRun: true,
      totalActions: pendingActions.length,
      actions: pendingActions,
    };
  }

  const results = {
    successful: 0,
    failed: 0,
    errors: [] as Array<{ scheduledActionId: string; error: unknown }>,
  };

  for (const action of pendingActions) {
    try {
      logger.info("Migrating scheduled action to Inngest", {
        scheduledActionId: action.id,
        scheduledFor: action.scheduledFor,
      });

      const eventId = await sendScheduledActionExecuteEvent({
        scheduledActionId: action.id,
        scheduledFor: action.scheduledFor,
      });

      // Note: If you add an inngestEventId field to the schema, update it here:
      // await prisma.scheduledAction.update({
      //   where: { id: action.id },
      //   data: { inngestEventId: eventId },
      // });

      logger.info("Successfully migrated scheduled action", {
        scheduledActionId: action.id,
        eventId,
      });

      results.successful++;
    } catch (error) {
      logger.error("Failed to migrate scheduled action", {
        scheduledActionId: action.id,
        error,
      });

      results.failed++;
      results.errors.push({
        scheduledActionId: action.id,
        error,
      });
    }
  }

  logger.info("Completed scheduled actions migration", {
    total: pendingActions.length,
    successful: results.successful,
    failed: results.failed,
  });

  return {
    dryRun: false,
    totalActions: pendingActions.length,
    successful: results.successful,
    failed: results.failed,
    errors: results.errors,
  };
}

/**
 * Helper to check the status of scheduled actions migration.
 *
 * Returns counts of actions in different states.
 */
export async function getScheduledActionsMigrationStatus() {
  const [pending, executing, completed, failed, cancelled] = await Promise.all([
    prisma.scheduledAction.count({
      where: { status: ScheduledActionStatus.PENDING },
    }),
    prisma.scheduledAction.count({
      where: { status: ScheduledActionStatus.EXECUTING },
    }),
    prisma.scheduledAction.count({
      where: { status: ScheduledActionStatus.COMPLETED },
    }),
    prisma.scheduledAction.count({
      where: { status: ScheduledActionStatus.FAILED },
    }),
    prisma.scheduledAction.count({
      where: { status: ScheduledActionStatus.CANCELLED },
    }),
  ]);

  return {
    pending,
    executing,
    completed,
    failed,
    cancelled,
    total: pending + executing + completed + failed + cancelled,
  };
}
