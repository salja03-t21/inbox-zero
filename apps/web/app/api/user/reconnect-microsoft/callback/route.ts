import { NextResponse } from "next/server";
import { env } from "@/env";
import { withError } from "@/utils/middleware";
import { saveTokens } from "@/utils/auth";
import { SCOPES } from "@/utils/outlook/scopes";
import { parseOAuthState } from "@/utils/oauth/state";
import { createScopedLogger } from "@/utils/logger";
import { SafeError } from "@/utils/error";
import prisma from "@/utils/prisma";

const logger = createScopedLogger("reconnect-microsoft/callback");

const RECONNECT_STATE_COOKIE_NAME = "microsoft_reconnect_state";

// Microsoft tenant ID for OAuth token endpoints
const MICROSOFT_TENANT_ID = env.MICROSOFT_TENANT_ID || "common";

export const GET = withError(async (request) => {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new SafeError("Microsoft login not enabled");
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const receivedState = searchParams.get("state");
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const storedState = request.cookies.get(RECONNECT_STATE_COOKIE_NAME)?.value;

  // Default redirect to root settings — will be updated once we know emailAccountId
  let redirectPath = "/settings";

  // Helper to build redirect URL with query params
  const buildRedirect = (params: Record<string, string>, headers?: Headers) => {
    const redirectUrl = new URL(redirectPath, env.NEXT_PUBLIC_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      redirectUrl.searchParams.set(key, value);
    }
    if (headers) {
      return NextResponse.redirect(redirectUrl, { headers });
    }
    return NextResponse.redirect(redirectUrl);
  };

  // Handle Microsoft OAuth errors (user denied consent, etc.)
  if (errorParam) {
    logger.warn("Microsoft OAuth returned an error", {
      error: errorParam,
      errorDescription,
    });

    const response = buildRedirect({
      reconnect: "error",
      reconnect_error: errorParam,
    });
    response.cookies.delete(RECONNECT_STATE_COOKIE_NAME);
    return response;
  }

  // Validate state parameter against cookie (CSRF protection)
  if (!storedState || !receivedState || storedState !== receivedState) {
    logger.warn("Invalid state during Microsoft reconnect callback", {
      receivedState,
      hasStoredState: !!storedState,
    });

    const response = buildRedirect({
      reconnect: "error",
      reconnect_error: "invalid_state",
    });
    response.cookies.delete(RECONNECT_STATE_COOKIE_NAME);
    return response;
  }

  // Parse state to extract userId and emailAccountId
  let decodedState: {
    userId: string;
    emailAccountId: string;
    action: string;
    nonce: string;
  };
  try {
    decodedState = parseOAuthState(storedState);
  } catch (error) {
    logger.error("Failed to decode state", { error });
    const response = buildRedirect({
      reconnect: "error",
      reconnect_error: "invalid_state_format",
    });
    response.cookies.delete(RECONNECT_STATE_COOKIE_NAME);
    return response;
  }

  const { userId, emailAccountId } = decodedState;

  // Now that we know the emailAccountId, update the redirect path
  redirectPath = `/${emailAccountId}/settings`;

  if (!code) {
    logger.warn("Missing code in Microsoft reconnect callback");
    const response = buildRedirect({
      reconnect: "error",
      reconnect_error: "missing_code",
    });
    response.cookies.delete(RECONNECT_STATE_COOKIE_NAME);
    return response;
  }

  // Verify the email account exists and belongs to the user
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId, userId },
    select: {
      id: true,
      email: true,
      account: {
        select: { provider: true, refresh_token: true },
      },
    },
  });

  if (!emailAccount) {
    logger.error("Email account not found or does not belong to user", {
      emailAccountId,
      userId,
    });
    const response = buildRedirect({
      reconnect: "error",
      reconnect_error: "account_not_found",
    });
    response.cookies.delete(RECONNECT_STATE_COOKIE_NAME);
    return response;
  }

  try {
    // Exchange authorization code for tokens
    const redirectUri = `${env.NEXT_PUBLIC_BASE_URL}/api/user/reconnect-microsoft/callback`;

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: env.MICROSOFT_CLIENT_ID,
          client_secret: env.MICROSOFT_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          scope: SCOPES.join(" "),
        }),
      },
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      const errorMsg =
        tokens.error_description || "Failed to exchange code for tokens";
      logger.error("Token exchange failed during reconnect", {
        emailAccountId,
        error: tokens.error,
        errorDescription: errorMsg.substring(0, 200),
        httpStatus: tokenResponse.status,
      });
      throw new Error(errorMsg);
    }

    if (!tokens.refresh_token) {
      logger.error(
        "Microsoft did not return a refresh token - consent may not have been granted",
        { emailAccountId },
      );
      throw new Error(
        "No refresh token received. Please try again and grant all requested permissions.",
      );
    }

    // Use the existing saveTokens function which handles encryption and database update
    await saveTokens({
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
      },
      accountRefreshToken: emailAccount.account.refresh_token,
      emailAccountId,
      provider: "microsoft",
    });

    logger.info("Microsoft account reconnected successfully", {
      emailAccountId,
      userId,
      email: emailAccount.email,
      expiresInSeconds: tokens.expires_in,
    });

    const response = buildRedirect({ reconnect: "success" });
    response.cookies.delete(RECONNECT_STATE_COOKIE_NAME);
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error during Microsoft reconnect", {
      emailAccountId,
      userId,
      error: errorMessage.substring(0, 200),
    });

    const response = buildRedirect({
      reconnect: "error",
      reconnect_error: "reconnect_failed",
    });
    response.cookies.delete(RECONNECT_STATE_COOKIE_NAME);
    return response;
  }
});
