import { NextResponse } from "next/server";
import { PremiumTier } from "@prisma/client";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { withAuth } from "@/utils/middleware";
import { isAdmin as checkIsAdmin } from "@/utils/admin";

const logger = createScopedLogger("api/admin/backfill-premium");

// Force dynamic route - do not pre-render at build time
export const dynamic = "force-dynamic";

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * Admin endpoint to backfill Premium records for existing users who don't have one.
 *
 * This ensures all users (including those created via SSO before auto-premium was added)
 * have lifetime premium access.
 *
 * SECURITY: Requires authenticated admin user.
 */
export const POST = withAuth(async (request) => {
  const userId = request.auth.userId;

  // Get user's email for admin check
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Check if the requesting user is a global admin
  const userIsAdmin = await checkIsAdmin({ userId, email: user.email });

  if (!userIsAdmin) {
    return NextResponse.json(
      { error: "Unauthorized: Global admin access required" },
      { status: 403 },
    );
  }

  logger.info("Starting premium backfill for users without premium");

  // Find all users without a premium record
  const usersWithoutPremium = await prisma.user.findMany({
    where: {
      premiumId: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  logger.info("Found users without premium", {
    count: usersWithoutPremium.length,
  });

  const results = {
    total: usersWithoutPremium.length,
    success: 0,
    failed: 0,
    errors: [] as { userId: string; email: string | null; error: string }[],
  };

  // Create premium for each user
  for (const userToFix of usersWithoutPremium) {
    try {
      await prisma.premium.create({
        data: {
          users: { connect: { id: userToFix.id } },
          admins: { connect: { id: userToFix.id } },
          tier: PremiumTier.LIFETIME,
          lemonSqueezyRenewsAt: new Date(Date.now() + TEN_YEARS_MS),
          emailAccountsAccess: 10,
        },
      });

      logger.info("Created premium for user", {
        userId: userToFix.id,
        email: userToFix.email,
      });

      results.success++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to create premium for user", {
        userId: userToFix.id,
        email: userToFix.email,
        error: errorMessage,
      });

      results.failed++;
      results.errors.push({
        userId: userToFix.id,
        email: userToFix.email,
        error: errorMessage,
      });
    }
  }

  logger.info("Premium backfill completed", results);

  return NextResponse.json({
    success: true,
    message: `Backfilled premium for ${results.success} users`,
    results,
  });
});

/**
 * GET endpoint to check how many users need premium backfill (dry run)
 */
export const GET = withAuth(async (request) => {
  const userId = request.auth.userId;

  // Get user's email for admin check
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Check if the requesting user is a global admin
  const userIsAdmin = await checkIsAdmin({ userId, email: user.email });

  if (!userIsAdmin) {
    return NextResponse.json(
      { error: "Unauthorized: Global admin access required" },
      { status: 403 },
    );
  }

  // Count users without premium
  const usersWithoutPremium = await prisma.user.findMany({
    where: {
      premiumId: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Also get total user count for context
  const totalUsers = await prisma.user.count();

  return NextResponse.json({
    totalUsers,
    usersWithoutPremium: usersWithoutPremium.length,
    usersNeedingBackfill: usersWithoutPremium.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
    })),
    message: `${usersWithoutPremium.length} out of ${totalUsers} users need premium backfill. POST to this endpoint to execute.`,
  });
});
