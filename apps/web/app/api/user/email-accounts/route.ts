import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withAuth } from "@/utils/middleware";
import { isValidEmailProvider } from "@/utils/email/provider-types";

export type GetEmailAccountsResponse = Awaited<
  ReturnType<typeof getEmailAccounts>
>;

async function getEmailAccounts({ userId }: { userId: string }) {
  const emailAccounts = await prisma.emailAccount.findMany({
    where: { userId },
    select: {
      id: true,
      email: true,
      accountId: true,
      name: true,
      image: true,
      account: {
        select: {
          provider: true,
        },
      },
      user: {
        select: {
          name: true,
          image: true,
          email: true,
          isAdmin: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  // Filter out SSO accounts - only return accounts with valid email providers (Google, Microsoft)
  // SSO providers (like Okta) create EmailAccount records but don't provide email access
  const validEmailAccounts = emailAccounts.filter((account) =>
    isValidEmailProvider(account.account?.provider),
  );

  const accountsWithNames = validEmailAccounts.map((account) => {
    // Old accounts don't have a name attached, so use the name from the user
    if (account.user.email === account.email) {
      return {
        ...account,
        name: account.name || account.user.name,
        image: account.image || account.user.image,
        isPrimary: true,
      };
    }

    return { ...account, isPrimary: false };
  });

  return { emailAccounts: accountsWithNames };
}

export const GET = withAuth(async (request) => {
  const userId = request.auth.userId;
  const result = await getEmailAccounts({ userId });
  return NextResponse.json(result);
});
