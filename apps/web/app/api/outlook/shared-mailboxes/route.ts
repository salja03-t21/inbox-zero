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
      { status: 404 }
    );
  }
  try {
    // Fetch mailboxes the user has access to
    // This queries for all users where the current user has delegated access
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/people?$filter=personType/subclass eq 'OrganizationUser'&$select=emailAddresses,displayName&$top=50",
      {
        headers: {
          Authorization: `Bearer ${emailAccount.account.access_token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch shared mailboxes: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Filter to only include mailboxes with valid email addresses
    const mailboxes = data.value
      .filter((person: any) => person.emailAddresses && person.emailAddresses.length > 0)
      .map((person: any) => ({
        email: person.emailAddresses[0].address,
        displayName: person.displayName,
      }));

    return NextResponse.json({ mailboxes });
  } catch (error) {
    console.error("Error fetching shared mailboxes:", error);
    return NextResponse.json(
      { error: "Failed to fetch shared mailboxes" },
      { status: 500 }
    );
  }
});

export type SharedMailboxesResponse = {
  mailboxes: Array<{
    email: string;
    displayName: string;
  }>;
};
