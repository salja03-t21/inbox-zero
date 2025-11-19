import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { isAdmin as checkIsAdmin } from "@/utils/admin";

export type AdminUsersResponse = Awaited<ReturnType<typeof getAdminUsers>>;

async function getAdminUsers({ userId }: { userId: string }) {
  // Check if the requesting user is a global admin
  const userIsAdmin = await checkIsAdmin({ userId });

  if (!userIsAdmin) {
    throw new Error("Unauthorized: Global admin access required");
  }

  // Fetch all users with their email accounts and admin status
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      isAdmin: true,
      emailAccounts: {
        select: {
          id: true,
          email: true,
          enabled: true,
          _count: {
            select: {
              rules: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    isAdmin: user.isAdmin,
    emailAccounts: user.emailAccounts.map((account) => ({
      id: account.id,
      email: account.email,
      enabled: account.enabled,
      rulesCount: account._count.rules,
      hasActiveRules: account._count.rules > 0,
    })),
  }));
}

export const GET = withAuth(async (request) => {
  const userId = request.auth.userId;

  try {
    const result = await getAdminUsers({ userId });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching admin users:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      {
        status:
          error instanceof Error && error.message.includes("Unauthorized")
            ? 403
            : 500,
      },
    );
  }
});
