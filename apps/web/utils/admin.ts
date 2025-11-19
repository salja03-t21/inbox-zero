import { env } from "@/env";
import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("admin");

/**
 * Check if a user is an admin.
 * First checks the database, then falls back to the ADMINS env variable.
 * This allows for migration from env-based to database-based admin management.
 */
export async function isAdmin({
  email,
  userId,
}: {
  email?: string | null;
  userId?: string;
}): Promise<boolean> {
  if (!email && !userId) {
    logger.info("isAdmin check failed: no email or userId provided");
    return false;
  }

  // First check database
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, email: true },
    });
    logger.info("Database admin check", {
      userId,
      userEmail: user?.email,
      isAdmin: user?.isAdmin,
    });
    if (user?.isAdmin) return true;
  } else if (email) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { isAdmin: true },
    });
    logger.info("Database admin check by email", {
      email,
      isAdmin: user?.isAdmin,
    });
    if (user?.isAdmin) return true;
  }

  // Fallback to env variable for bootstrapping
  logger.info("Env admin check", {
    email,
    envAdmins: env.ADMINS,
    includes: env.ADMINS?.includes(email || ""),
  });
  if (email && env.ADMINS?.includes(email)) {
    logger.info("User is admin via ADMINS env variable", { email });
    return true;
  }

  logger.info("isAdmin check failed", { email, userId });
  return false;
}
