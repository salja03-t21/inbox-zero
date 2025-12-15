import { z } from "zod";
import { NextResponse } from "next/server";
import { env } from "@/env";
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
 * Generate a random string of specified length using URL-safe characters
 */
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
      byte % 62,
    ),
  ).join("");
}

/**
 * Generate a PKCE code verifier (43-128 characters, URL-safe)
 */
function generateCodeVerifier(): string {
  return generateRandomString(128);
}

/**
 * Generate a PKCE code challenge from a code verifier
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Sign a value using HMAC-SHA256 (matches Better Auth's signing)
 */
async function signValue(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${value}.${signatureBase64}`;
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

  // Get the OIDC config from the database
  const providerData = await prisma.ssoProvider.findUnique({
    where: { providerId: provider.providerId },
    select: { oidcConfig: true, issuer: true },
  });

  if (!providerData?.oidcConfig) {
    throw new SafeError("SSO provider configuration not found");
  }

  // Parse the OIDC config - handle both string and object types
  let oidcConfig: {
    clientId: string;
    discoveryEndpoint?: string;
    discoveryUrl?: string;
    pkce?: boolean;
    scopes?: string[];
  };

  if (typeof providerData.oidcConfig === "string") {
    try {
      oidcConfig = JSON.parse(providerData.oidcConfig);
    } catch (e) {
      logger.error("SSO: Failed to parse oidcConfig", {
        error: e instanceof Error ? e.message : String(e),
        oidcConfig: providerData.oidcConfig,
      });
      throw new SafeError("Invalid SSO provider configuration");
    }
  } else {
    oidcConfig = providerData.oidcConfig as typeof oidcConfig;
  }

  // Construct the public base URL from forwarded headers
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const publicBaseUrl =
    forwardedHost && forwardedProto
      ? `${forwardedProto}://${forwardedHost}`
      : process.env.BETTER_AUTH_URL || "https://iz.tiger21.com";

  // The callback URL where Okta will redirect after authentication
  // This must match what Better Auth expects: /api/auth/sso/callback/{providerId}
  const redirectUri = `${publicBaseUrl}/api/auth/sso/callback/${provider.providerId}`;

  // The final callback URL after successful authentication (where user ends up)
  const finalCallbackUrl = `${publicBaseUrl}/`;

  // Generate state ID (random UUID)
  const stateId = crypto.randomUUID();

  // Generate PKCE code verifier if PKCE is enabled
  const usePkce = oidcConfig.pkce !== false; // Default to true
  const codeVerifier = usePkce ? generateCodeVerifier() : "";
  const codeChallenge = usePkce
    ? await generateCodeChallenge(codeVerifier)
    : "";

  // Create the state data object that Better Auth's parseState expects
  // This matches the format in better-auth/oauth2 generateState function
  const stateData = {
    callbackURL: finalCallbackUrl,
    codeVerifier: codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    // Optional fields:
    // errorURL: undefined,
    // newUserURL: undefined,
    // link: undefined,
    // requestSignUp: undefined,
  };

  // Store the state in the verification table
  // Better Auth stores the state data as the "value" field (which maps to "token" in our schema)
  const expiresAt = new Date(stateData.expiresAt);
  await prisma.verificationToken.create({
    data: {
      identifier: stateId,
      token: JSON.stringify(stateData), // Store the full state data as JSON
      expires: expiresAt,
    },
  });

  logger.info("SSO: Stored verification state", {
    stateId,
    expiresAt,
    usePkce,
    finalCallbackUrl,
  });

  // Fetch the authorization endpoint from the discovery URL
  const discoveryUrl =
    oidcConfig.discoveryEndpoint ||
    oidcConfig.discoveryUrl ||
    `${providerData.issuer}/.well-known/openid-configuration`;

  logger.info("SSO: Fetching discovery document", { discoveryUrl });

  const discoveryResponse = await fetch(discoveryUrl);
  if (!discoveryResponse.ok) {
    logger.error("SSO: Failed to fetch discovery document", {
      status: discoveryResponse.status,
      statusText: discoveryResponse.statusText,
    });
    throw new SafeError("Failed to fetch SSO provider configuration");
  }

  const discoveryData = await discoveryResponse.json();

  // Construct the Okta authorization URL
  const authUrl = new URL(discoveryData.authorization_endpoint);
  authUrl.searchParams.set("client_id", oidcConfig.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    (
      oidcConfig.scopes || ["openid", "email", "profile", "offline_access"]
    ).join(" "),
  );
  authUrl.searchParams.set("state", stateId);

  // Add PKCE parameters if enabled
  if (usePkce && codeChallenge) {
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
  }

  const redirectUrl = authUrl.toString();

  logger.info("SSO: Constructed Okta redirect URL", {
    redirectUrl,
    redirectUri,
    publicBaseUrl,
    usePkce,
  });

  // Determine cookie name and settings based on environment
  // Better Auth uses "better-auth.state" or "__Secure-better-auth.state" in production
  const isSecure = publicBaseUrl.startsWith("https://");
  const cookieName = isSecure
    ? "__Secure-better-auth.state"
    : "better-auth.state";

  // Create the response with the state cookie
  const responseData: GetSsoSignInResponse = {
    redirectUrl,
    providerId: provider.providerId,
  };

  const jsonResponse = NextResponse.json(responseData);

  // Set the state cookie with just the stateId (unsigned)
  // Better Auth's callback will use this to look up the verification token
  // Note: We're NOT signing the cookie ourselves - Better Auth might expect unsigned state for SSO
  jsonResponse.cookies.set(cookieName, stateId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 60, // 5 minutes (matches Better Auth)
  });

  logger.info("SSO: Set state cookie (unsigned)", {
    cookieName,
    stateId,
    isSecure,
    cookieValue: stateId, // Log the actual cookie value for debugging
  });

  return jsonResponse;
});
