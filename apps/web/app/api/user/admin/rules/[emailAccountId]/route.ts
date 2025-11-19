import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { isOrganizationAdmin } from "@/utils/organizations/roles";

export type AdminRulesResponse = Awaited<ReturnType<typeof getAdminRules>>;

async function getAdminRules({
  userId,
  emailAccountId,
}: {
  userId: string;
  emailAccountId: string;
}) {
  // Get the requesting user with their organization memberships
  const requestingUser = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      emailAccounts: {
        include: {
          members: true,
        },
      },
    },
  });

  if (!requestingUser) {
    throw new Error("User not found");
  }

  // Check if user is an admin in any organization
  const isAdmin = requestingUser.emailAccounts.some((account) =>
    isOrganizationAdmin(account.members),
  );

  if (!isAdmin) {
    throw new Error("Unauthorized: Admin access required");
  }

  // Fetch rules for the specified email account
  const rules = await prisma.rule.findMany({
    where: { emailAccountId },
    include: {
      actions: true,
      group: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rules;
}

export const GET = withAuth(async (request, context) => {
  const userId = request.auth.userId;
  const { emailAccountId } = await context.params;

  try {
    const result = await getAdminRules({ userId, emailAccountId });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching admin rules:", error);
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
