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
            refreshTokenExpiresAt: true,
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

    // For OAuth, we want to check the refresh token expiration, not access token
    // Access tokens typically expire in 1 hour, but refresh tokens last much longer
    // If refreshTokenExpiresAt is null, the refresh token doesn't expire (as long as it's used regularly)
    const expiresAt =
      emailAccount.account.refreshTokenExpiresAt ??
      emailAccount.account.expires_at;
    const hasRefreshToken = !!emailAccount.account.refresh_token;
    const isConnected = hasRefreshToken;
    const hasExpiringRefreshToken =
      !!emailAccount.account.refreshTokenExpiresAt;

    return NextResponse.json({
      isConnected,
      expiresAt: expiresAt?.toISOString() || null,
      provider: emailAccount.account.provider,
      hasExpiringRefreshToken,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch account status" },
      { status: 500 },
    );
  }
});
