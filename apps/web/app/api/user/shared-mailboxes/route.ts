import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { z } from "zod";

const querySchema = z.object({
  emailAccountId: z.string().optional(),
});

export const GET = withAuth(async (req) => {
  const { userId } = req.auth;
  const searchParams = req.nextUrl.searchParams;

  try {
    const { emailAccountId } = querySchema.parse({
      emailAccountId: searchParams.get("emailAccountId"),
    });

    // Build query to fetch shared mailboxes
    const whereClause: any = {
      userId,
      isSharedMailbox: true,
    };

    // If emailAccountId provided, only show shared mailboxes for that account
    if (emailAccountId) {
      const primaryAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: { accountId: true },
      });

      if (primaryAccount) {
        whereClause.accountId = primaryAccount.accountId;
      }
    }

    const sharedMailboxes = await prisma.emailAccount.findMany({
      where: whereClause,
      select: {
        id: true,
        email: true,
        name: true,
        sharedMailboxOwner: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ sharedMailboxes });
  } catch (error) {
    console.error("Error fetching shared mailboxes:", error);
    return NextResponse.json(
      { error: "Failed to fetch shared mailboxes" },
      { status: 500 },
    );
  }
});
