import { NextResponse } from "next/server";
import { env } from "@/env";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { withAuth } from "@/utils/middleware";
import { isAdmin as checkIsAdmin } from "@/utils/admin";

const logger = createScopedLogger("api/admin/fix-sso-config");

// Force dynamic route - do not pre-render at build time
export const dynamic = "force-dynamic";

/**
 * Admin endpoint to fix SSO OIDC configuration.
 *
 * Better Auth SSO plugin requires the following fields in oidcConfig:
 * - issuer: string (REQUIRED) - The issuer URL
 * - clientId: string (REQUIRED) - OAuth client ID
 * - clientSecret: string (REQUIRED) - OAuth client secret
 * - discoveryEndpoint: string (REQUIRED) - OIDC discovery URL
 * - pkce: boolean (REQUIRED) - Whether to use PKCE
 * - tokenEndpointAuthentication: "client_secret_post" | "client_secret_basic" (optional)
 * - scopes: string[] (optional) - Defaults to ["openid", "email", "profile", "offline_access"]
 *
 * The config is stored as a JSON string in the database.
 *
 * SECURITY: Requires authenticated admin user.
 */
export const GET = withAuth(async (request) => {
  const userId = request.auth.userId;

  // Get user's email for admin check
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Check if the requesting user is a global admin
  const userIsAdmin = await checkIsAdmin({ userId, email: user.email });

  if (!userIsAdmin) {
    return NextResponse.json(
      { error: "Unauthorized: Global admin access required" },
      { status: 403 },
    );
  }
  const providerId = "okta-tiger21-1765774132282";
  const issuer = "https://apps.tiger21.com";

  const provider = await prisma.ssoProvider.findFirst({
    where: { providerId },
  });

  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  // Log the current config for debugging
  logger.info("Current oidcConfig (raw)", {
    oidcConfig: provider.oidcConfig,
    type: typeof provider.oidcConfig,
  });

  // Get the client secret from environment variable
  const clientSecret = env.SSO_OKTA_TIGER21_1765774132282_CLIENT_SECRET;

  if (!clientSecret) {
    return NextResponse.json(
      { error: "Client secret not found in environment variables" },
      { status: 500 },
    );
  }

  logger.info("Client secret from env", { hasValue: !!clientSecret });

  // Build the correct OIDC config matching Better Auth's expected format
  // See: @better-auth/sso OIDCConfig interface
  const correctConfig = {
    // Required fields
    issuer: issuer,
    clientId: "0oa251hvxm7RlukZO0h8",
    clientSecret: clientSecret, // Plain string, no extra escaping
    discoveryEndpoint: `${issuer}/.well-known/openid-configuration`, // NOT discoveryUrl!
    pkce: true, // Required boolean

    // Optional but recommended for Okta
    tokenEndpointAuthentication: "client_secret_basic" as const,
    scopes: ["openid", "email", "profile", "offline_access"],

    // Endpoints will be auto-discovered from discoveryEndpoint, but we can specify them
    authorizationEndpoint: `${issuer}/oauth2/v1/authorize`,
    tokenEndpoint: `${issuer}/oauth2/v1/token`,
    userInfoEndpoint: `${issuer}/oauth2/v1/userinfo`,
    jwksEndpoint: `${issuer}/oauth2/v1/keys`,
  };

  // Serialize to JSON - this should produce clean JSON without double-escaping
  const configJson = JSON.stringify(correctConfig);

  logger.info("New oidcConfig to be saved", {
    configJson,
    parsedBack: JSON.parse(configJson), // Verify it parses correctly
  });

  await prisma.ssoProvider.update({
    where: { id: provider.id },
    data: {
      oidcConfig: configJson,
    },
  });

  const updated = await prisma.ssoProvider.findFirst({
    where: { providerId },
  });

  // Verify the saved config can be parsed
  let parsedConfig = null;
  let parseError = null;
  try {
    if (updated?.oidcConfig) {
      parsedConfig = JSON.parse(updated.oidcConfig as string);
    }
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    success: true,
    old: {
      raw: "[REDACTED]",
      type: typeof provider.oidcConfig,
    },
    new: {
      raw: "[REDACTED]",
      parsed: parsedConfig
        ? { ...parsedConfig, clientSecret: "[REDACTED]" }
        : null,
      parseError,
    },
    message:
      "Updated OIDC config with correct Better Auth format (issuer, discoveryEndpoint, pkce, clientSecret)",
  });
});
