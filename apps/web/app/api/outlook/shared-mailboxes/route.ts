import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import prisma from "@/utils/prisma";

export const GET = withEmailAccount(async (req) => {
  const { emailAccountId } = req.auth;

  // Fetch the email account with tokens
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    include: {
      account: {
        select: {
          access_token: true,
        },
      },
    },
  });

  if (!emailAccount) {
    return NextResponse.json(
      { error: "Email account not found" },
      { status: 404 },
    );
  }
  // NOTE: Microsoft Graph API does not provide a direct endpoint to list shared mailboxes
  // that a user has delegated access to. Users must manually enter the shared mailbox email.
  // This is a known limitation of the MS Graph API.
  // See: https://github.com/microsoftgraph/msgraph-sdk-dotnet/issues/1634

  return NextResponse.json({ mailboxes: [] });
  // To implement automatic discovery, you would need:
  // 1. Exchange Online PowerShell access (more permissions)
  // 2. User to grant additional permissions in Azure
  // 3. Or: Use "Get-Mailbox -RecipientTypeDetails SharedMailbox" via Exchange
});

export type SharedMailboxesResponse = {
  mailboxes: Array<{
    email: string;
    displayName: string;
  }>;
};
