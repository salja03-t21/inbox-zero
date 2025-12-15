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
  // FIX: Call Better Auth's handler with a proxied request
  // This ensures Better Auth receives the correct public URL instead of 0.0.0.0:3000
  // ============================================================================

  // Create a proxied request with the correct public URL
  const proxiedRequest = createProxiedRequest(request);

  // Construct the Better Auth SSO sign-in URL
  const authUrl = new URL(proxiedRequest.url);
  authUrl.pathname = "/api/auth/sign-in/sso";

  // Create request body with SSO parameters
  const requestBody = JSON.stringify({
    providerId: provider.providerId,
    callbackURL: "/accounts",
  });

  // Create headers with content-type
  const authHeaders = new Headers(proxiedRequest.headers);
  authHeaders.set("content-type", "application/json");

  // Create the request to Better Auth
  const authRequest = new Request(authUrl.toString(), {
    method: "POST",
    headers: authHeaders,
    body: requestBody,
    // @ts-expect-error - Required for POST requests
    duplex: "half",
  });

  logger.info("SSO: Calling Better Auth handler", {
    authUrl: authUrl.toString(),
    host: authRequest.headers.get("host"),
    body: requestBody,
  });

  // Call Better Auth's handler directly
  const authResponse = await betterAuthConfig.handler(authRequest);

  // Extract the redirect URL from Better Auth's response
  if (authResponse.status === 302 || authResponse.status === 301) {
    const redirectUrl = authResponse.headers.get("location");
    if (redirectUrl) {
      logger.info("SSO: Better Auth returned redirect", { redirectUrl });

      const response: GetSsoSignInResponse = {
        redirectUrl,
        providerId: provider.providerId,
      };

      return NextResponse.json(response);
    }
  }

  // If we get here, something went wrong
  logger.error("SSO: Unexpected response from Better Auth", {
    status: authResponse.status,
    statusText: authResponse.statusText,
  });

  throw new SafeError("Failed to initiate SSO sign-in");
});
