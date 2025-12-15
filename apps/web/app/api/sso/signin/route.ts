import { z } from "zod";
import { NextResponse } from "next/server";
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

export const GET = withError(async (request) => {
  // ============================================================================
  // DEBUG: Comprehensive request logging to trace 0.0.0.0:3000 issue
  // ============================================================================
  logger.info("=== SSO SIGNIN REQUEST START ===", {
    timestamp: new Date().toISOString(),
  });

  // Log the ENTIRE request URL and its components
  logger.info("SSO DEBUG: Request URL analysis", {
    fullUrl: request.url,
    urlContains0000: request.url.includes("0.0.0.0"),
    urlContainsLocalhost: request.url.includes("localhost"),
  });

  // Parse the URL to see its components
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(request.url);
    logger.info("SSO DEBUG: Parsed request URL", {
      protocol: parsedUrl.protocol,
      host: parsedUrl.host,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      pathname: parsedUrl.pathname,
      origin: parsedUrl.origin,
      search: parsedUrl.search,
    });
  } catch (e) {
    logger.error("SSO DEBUG: Failed to parse request URL", {
      url: request.url,
      error: e instanceof Error ? e.message : e,
    });
  }

  // Log ALL request headers (not just forwarded ones)
  const allHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    allHeaders[key] = value;
  });
  logger.info("SSO DEBUG: All request headers", { headers: allHeaders });

  // Specifically log forwarding headers
  logger.info("SSO DEBUG: Forwarding headers", {
    "x-forwarded-host": request.headers.get("x-forwarded-host"),
    "x-forwarded-proto": request.headers.get("x-forwarded-proto"),
    "x-forwarded-for": request.headers.get("x-forwarded-for"),
    "x-forwarded-port": request.headers.get("x-forwarded-port"),
    "x-real-ip": request.headers.get("x-real-ip"),
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
  });

  // Parse query parameters
  const { searchParams } = parsedUrl || new URL(request.url);
  const { email, organizationSlug } = getSsoSignInSchema.parse({
    email: searchParams.get("email"),
    organizationSlug: searchParams.get("organizationSlug"),
  });

  logger.info("SSO DEBUG: Parsed parameters", { email, organizationSlug });

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
    logger.error("SSO DEBUG: No SSO provider found", {
      email,
      organizationSlug,
    });
    throw new SafeError("No SSO provider found for this organization");
  }

  logger.info("SSO DEBUG: Found SSO provider", {
    providerId: provider.providerId,
    issuer: provider.issuer,
    domain: provider.domain,
  });

  // ============================================================================
  // DEBUG: Check Better Auth context BEFORE calling signInSSO
  // ============================================================================
  const authContext = await betterAuthConfig.$context;
  logger.info("SSO DEBUG: Better Auth context (before signInSSO)", {
    baseURL: authContext.baseURL,
    baseURLType: typeof authContext.baseURL,
    baseURLLength: authContext.baseURL?.length ?? 0,
    baseURLContains0000: authContext.baseURL?.includes("0.0.0.0") ?? false,
    optionsBaseURL: authContext.options?.baseURL,
    optionsBasePath: authContext.options?.basePath,
    trustedOrigins: authContext.trustedOrigins,
  });

  // Construct the expected callback URL for debugging
  const expectedCallbackURL = `${authContext.baseURL}/sso/callback/${provider.providerId}`;
  logger.info("SSO DEBUG: Expected callback URL", {
    expectedCallbackURL,
    callbackContains0000: expectedCallbackURL.includes("0.0.0.0"),
  });

  // ============================================================================
  // DEBUG: Log the exact parameters being passed to signInSSO
  // ============================================================================
  const signInSSOParams = {
    body: {
      providerId: provider.providerId,
      callbackURL: "/accounts",
    },
    headers: request.headers,
  };

  logger.info("SSO DEBUG: Calling signInSSO with params", {
    body: signInSSOParams.body,
    headersType: typeof signInSSOParams.headers,
    hasHeaders: !!signInSSOParams.headers,
  });

  // ============================================================================
  // Call signInSSO with comprehensive error handling
  // ============================================================================
  let ssoResponse: { url: string; redirect: boolean };
  try {
    logger.info("SSO DEBUG: About to call betterAuthConfig.api.signInSSO...");

    ssoResponse = await betterAuthConfig.api.signInSSO(signInSSOParams);

    logger.info("SSO DEBUG: signInSSO SUCCESS", {
      responseUrl: ssoResponse.url,
      responseUrlContains0000: ssoResponse.url?.includes("0.0.0.0") ?? false,
      responseRedirect: ssoResponse.redirect,
    });
  } catch (error) {
    // ============================================================================
    // DEBUG: Comprehensive error logging
    // ============================================================================
    logger.error("SSO DEBUG: signInSSO FAILED", {
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      // Re-check context at time of error
      authContextBaseURL: authContext.baseURL,
      authContextOptionsBaseURL: authContext.options?.baseURL,
      providerId: provider.providerId,
      // Check if error message contains 0.0.0.0
      errorContains0000:
        error instanceof Error
          ? error.message.includes("0.0.0.0")
          : String(error).includes("0.0.0.0"),
    });

    // If it's an "Invalid URL" error, try to extract more info
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("invalid url")
    ) {
      logger.error("SSO DEBUG: Invalid URL error detected", {
        possibleCause:
          "baseURL might be empty or malformed when constructing SSO callback URL",
        baseURLAtError: authContext.baseURL,
        suggestion:
          "Check if BETTER_AUTH_URL environment variable is set correctly",
      });
    }

    throw error;
  }

  // ============================================================================
  // DEBUG: Log the final response
  // ============================================================================
  const response: GetSsoSignInResponse = {
    redirectUrl: ssoResponse.url,
    providerId: provider.providerId,
  };

  logger.info("SSO DEBUG: Returning response", {
    redirectUrl: response.redirectUrl,
    providerId: response.providerId,
  });

  logger.info("=== SSO SIGNIN REQUEST END ===");

  return NextResponse.json(response);
});
