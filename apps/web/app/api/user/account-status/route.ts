import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";

export const GET = withAuth(async (req) => {
  const { userId } = req.auth;

  try {
    // Get the primary email account for this user
    const emailAccount = await prisma.emailAccount.findFirst({
      where: {
        userId,
        isSharedMailbox: false,
      },
      include: {
        account: {
          select: {
            expires_at: true,
            provider: true,
            refresh_token: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc", // Get the first/primary account
      },
    });

    if (!emailAccount || !emailAccount.account) {
      return NextResponse.json({ error: "No account found" }, { status: 404 });
    }

    const expiresAt = emailAccount.account.expires_at;
    const hasRefreshToken = !!emailAccount.account.refresh_token;
    const isConnected = hasRefreshToken;

    return NextResponse.json({
      isConnected,
      expiresAt: expiresAt?.toISOString() || null,
      provider: emailAccount.account.provider,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch account status" },
      { status: 500 },
    );
  }
});
