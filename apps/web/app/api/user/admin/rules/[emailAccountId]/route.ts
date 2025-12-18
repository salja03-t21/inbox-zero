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
  // Get the target email account with its organization
  const targetEmailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    include: {
      members: true,
    },
  });

  if (!targetEmailAccount) {
    throw new Error("Email account not found");
  }

  // Check if the requesting user is an admin of the organization that owns this email account
  const userMembership = targetEmailAccount.members.find(
    (member) => member.userId === userId,
  );

  if (!userMembership || !isOrganizationAdmin([userMembership])) {
    throw new Error("Unauthorized: You must be an admin of this organization");
  }

  // Fetch rules for the verified email account
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
