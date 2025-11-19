import { env } from "@/env";
import prisma from "@/utils/prisma";

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
  if (!email && !userId) return false;

  // First check database
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (user?.isAdmin) return true;
  } else if (email) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { isAdmin: true },
    });
    if (user?.isAdmin) return true;
  }

  // Fallback to env variable for bootstrapping
  if (email && env.ADMINS?.includes(email)) {
    return true;
  }

  return false;
}
