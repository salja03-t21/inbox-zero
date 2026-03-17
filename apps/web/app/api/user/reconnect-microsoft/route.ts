import { NextResponse } from "next/server";
import { withAuth } from "@/utils/middleware";
import { env } from "@/env";
import { SCOPES } from "@/utils/outlook/scopes";
import {
  generateOAuthState,
  oauthStateCookieOptions,
} from "@/utils/oauth/state";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";

const logger = createScopedLogger("reconnect-microsoft");

const RECONNECT_STATE_COOKIE_NAME = "microsoft_reconnect_state";

// Microsoft tenant ID for OAuth token endpoints
const MICROSOFT_TENANT_ID = env.MICROSOFT_TENANT_ID || "common";

export const GET = withAuth(async (request) => {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new SafeError("Microsoft login not enabled");
  }

  const userId = request.auth.userId;
  const url = new URL(request.url);
  const emailAccountId = url.searchParams.get("emailAccountId");

  if (!emailAccountId) {
    return NextResponse.json(
      { error: "emailAccountId is required" },
      { status: 400 },
    );
  }

  // Verify the user owns this email account and it uses Microsoft
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId, userId },
    select: {
      id: true,
      account: { select: { provider: true } },
    },
  });

  if (!emailAccount) {
    logger.warn("Email account not found or does not belong to user", {
      emailAccountId,
      userId,
    });
    return NextResponse.json(
      { error: "Email account not found" },
      { status: 404 },
    );
  }

  if (emailAccount.account.provider !== "microsoft") {
    logger.warn("Email account is not a Microsoft account", {
      emailAccountId,
      provider: emailAccount.account.provider,
    });
    return NextResponse.json(
      { error: "This endpoint is only for Microsoft accounts" },
      { status: 400 },
    );
  }

  // Generate state with emailAccountId for the callback to use
  const state = generateOAuthState({
    userId,
    emailAccountId,
    action: "reconnect",
  });

  const redirectUri = `${env.NEXT_PUBLIC_BASE_URL}/api/user/reconnect-microsoft/callback`;

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    prompt: "consent",
    state,
  });

  const authUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;

  logger.info("Redirecting user to Microsoft for reconnection", {
    emailAccountId,
    userId,
  });

  const response = NextResponse.redirect(authUrl);

  // Set state cookie for CSRF validation in the callback
  response.cookies.set(
    RECONNECT_STATE_COOKIE_NAME,
    state,
    oauthStateCookieOptions,
  );

  return response;
});
