import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("health-simple");

export const dynamic = "force-dynamic";

/**
 * Simple health check endpoint for load balancer/container health checks
 * No authentication required - checks basic database connectivity
 */
export async function GET() {
  try {
    // Simple database connectivity check
    // Use a lightweight query that doesn't require specific data
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error("Health check failed - database unreachable", { error });

    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        error: "Database connection failed",
      },
      { status: 503 },
    );
  }
}
