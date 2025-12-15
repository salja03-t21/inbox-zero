import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { betterAuthConfig } from "@/utils/auth";
import { SafeError } from "@/utils/error";
import { createScopedLogger } from "@/utils/logger";
import { withError } from "@/utils/middleware";
import prisma from "@/utils/prisma";

const getSsoSignInSchema = z.object({
  email: z.string().email(),
  organizationSlug: z.string(),
});
export type GetSsoSignInParams = z.infer<typeof getSsoSignInSchema>;
export type GetSsoSignInResponse = {
  redirectUrl: string;
  providerId: string;
};

const logger = createScopedLogger("api/sso/signin");

/**
 * Creates a proxied Request object with the correct public URL.
 * This fixes the issue where Next.js provides request.url as http://0.0.0.0:3000
 * instead of the public domain when running behind a reverse proxy (Traefik/Docker).
 */
function createProxiedRequest(request: NextRequest): Request {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const originalUrl = new URL(request.url);

  // If we have forwarded headers, construct the public URL
  let publicUrl: string;
  if (forwardedHost && forwardedProto) {
    publicUrl = `${forwardedProto}://${forwardedHost}${originalUrl.pathname}${originalUrl.search}`;
    logger.info("SSO: Constructed public URL from forwarded headers", {
      originalUrl: request.url,
      publicUrl,
      forwardedHost,
      forwardedProto,
    });
  } else {
    // Fallback to original URL if no forwarded headers
    publicUrl = request.url;
    logger.warn("SSO: No forwarded headers found, using original URL", {
      url: publicUrl,
    });
  }

  // Create modified headers with the correct host
  const modifiedHeaders = new Headers(request.headers);
  if (forwardedHost) {
    modifiedHeaders.set("host", forwardedHost);
  }

  // Create a new Request with the public URL
  return new Request(publicUrl, {
    method: request.method,
    headers: modifiedHeaders,
    body: request.body,
    // @ts-expect-error - Required for requests with body
    duplex: "half",
  });
}

export const GET = withError(async (request) => {
  const parsedUrl = new URL(request.url);
  const { searchParams } = parsedUrl;
  const { email, organizationSlug } = getSsoSignInSchema.parse({
    email: searchParams.get("email"),
    organizationSlug: searchParams.get("organizationSlug"),
  });

  logger.info("SSO: Sign-in request", { email, organizationSlug });

  // Find the SSO provider
  const provider = await prisma.ssoProvider.findFirst({
    where: {
      organization: {
        slug: organizationSlug,
      },
    },
    select: {
      providerId: true,
      issuer: true,
      domain: true,
    },
  });

  if (!provider) {
    logger.error("SSO: No SSO provider found", {
      email,
      organizationSlug,
    });
    throw new SafeError("No SSO provider found for this organization");
  }

  logger.info("SSO: Found SSO provider", {
    providerId: provider.providerId,
    issuer: provider.issuer,
  });

  // ============================================================================
  // FIX: Manually construct Okta authorization URL
  // We bypass Better Auth's handler because it has issues with proxied requests
  // where request.url contains 0.0.0.0:3000 instead of the public domain
  // ============================================================================

  // Get the OIDC config from the database
  const providerData = await prisma.ssoProvider.findUnique({
    where: { providerId: provider.providerId },
    select: { oidcConfig: true, issuer: true },
  });

  if (!providerData?.oidcConfig) {
    throw new SafeError("SSO provider configuration not found");
  }

  const oidcConfig = JSON.parse(providerData.oidcConfig as string);

  // Construct the public base URL from forwarded headers
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const publicBaseUrl =
    forwardedHost && forwardedProto
      ? `${forwardedProto}://${forwardedHost}`
      : process.env.BETTER_AUTH_URL || "https://iz.tiger21.com";

  // Construct the callback URL that Okta will redirect to after authentication
  // Better Auth SSO callback format: /api/auth/sso/callback/{providerId}
  const callbackURL = `${publicBaseUrl}/api/auth/sso/callback/${provider.providerId}`;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Store the state in the database for Better Auth to verify on callback
  // This is required for the SSO flow to work correctly
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  await prisma.verificationToken.create({
    data: {
      identifier: state,
      token: state,
      expires: expiresAt,
    },
  });

  logger.info("SSO: Stored verification state", { state, expiresAt });

  // Fetch the authorization endpoint from the discovery URL
  const discoveryUrl =
    oidcConfig.discoveryUrl ||
    `${providerData.issuer}/.well-known/openid-configuration`;
  const discoveryResponse = await fetch(discoveryUrl);
  const discoveryData = await discoveryResponse.json();

  // Construct the Okta authorization URL
  const authUrl = new URL(discoveryData.authorization_endpoint);
  authUrl.searchParams.set("client_id", oidcConfig.clientId);
  authUrl.searchParams.set("redirect_uri", callbackURL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);

  const redirectUrl = authUrl.toString();

  logger.info("SSO: Constructed Okta redirect URL", {
    redirectUrl,
    callbackURL,
    publicBaseUrl,
  });

  const response: GetSsoSignInResponse = {
    redirectUrl,
    providerId: provider.providerId,
  };

  return NextResponse.json(response);
});
