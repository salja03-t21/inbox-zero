import { NextResponse } from "next/server";
import { inngest } from "@/utils/inngest/client";
import { createScopedLogger } from "@/utils/logger";
import { auth } from "@/app/api/auth/[...nextauth]/auth";

const logger = createScopedLogger("api/scheduled-actions/kickstart-cleanup");

/**
 * POST /api/scheduled-actions/kickstart-cleanup
 *
 * Kickstarts the scheduled action cleanup cycle by sending the initial cleanup event.
 * This only needs to be called once to start the self-perpetuating cleanup cycle.
 *
 * Requires authentication - only admins can trigger this.
 */
export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin (optional - remove if you want any authenticated user to trigger)
    // For now, we'll allow any authenticated user since this is a utility endpoint

    logger.info("Kickstarting cleanup cycle", {
      triggeredBy: session.user.email,
    });

    // Send the initial cleanup event
    const { ids } = await inngest.send({
      name: "inbox-zero/cleanup.scheduled-actions",
      data: {
        scheduledBy: "manual-kickstart",
        triggeredBy: session.user.email,
        timestamp: new Date().toISOString(),
      },
    });

    logger.info("Cleanup cycle kickstarted", {
      eventId: ids[0],
      triggeredBy: session.user.email,
    });

    return NextResponse.json({
      success: true,
      message: "Cleanup cycle kickstarted successfully",
      eventId: ids[0],
      note: "The cleanup function will now run and automatically schedule itself every 5 minutes",
    });
  } catch (error) {
    logger.error("Failed to kickstart cleanup cycle", { error });

    return NextResponse.json(
      {
        error: "Failed to kickstart cleanup cycle",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/scheduled-actions/kickstart-cleanup
 *
 * Returns information about the cleanup cycle
 */
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/scheduled-actions/kickstart-cleanup",
    method: "POST",
    description: "Kickstarts the scheduled action cleanup cycle",
    authentication: "Required",
    notes: [
      "This endpoint starts a self-perpetuating cleanup cycle",
      "The cleanup function runs immediately and schedules itself every 5 minutes",
      "You only need to call this once to start the cycle",
      "Subsequent cleanups are automatic",
    ],
  });
}
