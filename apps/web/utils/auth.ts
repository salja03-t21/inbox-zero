// based on: https://github.com/vercel/platforms/blob/main/lib/auth.ts

import { sso } from "@better-auth/sso";
import { createContact as createLoopsContact } from "@inboxzero/loops";
import { createContact as createResendContact } from "@inboxzero/resend";
import type { Prisma } from "@prisma/client";
import type { Account, AuthContext, User } from "better-auth";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { cookies, headers } from "next/headers";
import { env } from "@/env";
import { trackDubSignUp } from "@/utils/dub";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import { encryptToken } from "@/utils/encryption";
import { captureException } from "@/utils/error";
import { getContactsClient as getGoogleContactsClient } from "@/utils/gmail/client";
import { SCOPES as GMAIL_SCOPES } from "@/utils/gmail/scopes";
import { createScopedLogger } from "@/utils/logger";
import { getContactsClient as getOutlookContactsClient } from "@/utils/outlook/client";
import { SCOPES as OUTLOOK_SCOPES } from "@/utils/outlook/scopes";
import { updateAccountSeats } from "@/utils/premium/server";
import prisma from "@/utils/prisma";

const logger = createScopedLogger("auth");

// ============================================================================
// DEBUG: Log ALL environment variables related to URLs at module initialization
// This helps trace where 0.0.0.0:3000 might be coming from
// ============================================================================
logger.info("=== AUTH MODULE INITIALIZATION START ===", {
  timestamp: new Date().toISOString(),
  nodeEnv: process.env.NODE_ENV,
});

logger.info("AUTH DEBUG: All URL-related environment variables", {
  // Better Auth specific
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ? "[SET]" : "[NOT SET]",
  // Base URLs
  BASE_URL: process.env.BASE_URL,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  // NextAuth (legacy)
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  // Host/Port related
  HOST: process.env.HOST,
  HOSTNAME: process.env.HOSTNAME,
  PORT: process.env.PORT,
  // Vercel/deployment
  VERCEL_URL: process.env.VERCEL_URL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  // From env.ts
  envNextPublicBaseUrl: env.NEXT_PUBLIC_BASE_URL,
});

// Helper function to check if an email domain is allowed
// Exported for testing purposes
export function isEmailDomainAllowed(
  email: string,
  allowedDomains?: string[],
): boolean {
  // Use provided domains or fall back to env config
  const domains = allowedDomains ?? env.ALLOWED_EMAIL_DOMAINS;

  // If no allowed domains are configured, allow all
  if (!domains || domains.length === 0) {
    return true;
  }

  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain) {
    return false;
  }

  return domains.some((domain) => domain.toLowerCase() === emailDomain);
}

// Determine the base URL at module load time
// Priority: BETTER_AUTH_URL > BASE_URL > NEXT_PUBLIC_BASE_URL
const resolvedBaseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.BASE_URL ||
  env.NEXT_PUBLIC_BASE_URL;

// DEBUG: Log the resolution process
logger.info("AUTH DEBUG: Base URL resolution", {
  step1_BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "(empty/undefined)",
  step2_BASE_URL: process.env.BASE_URL || "(empty/undefined)",
  step3_NEXT_PUBLIC_BASE_URL: env.NEXT_PUBLIC_BASE_URL || "(empty/undefined)",
  finalResolvedBaseURL: resolvedBaseURL || "(empty/undefined)",
  resolvedBaseURLType: typeof resolvedBaseURL,
  resolvedBaseURLLength: resolvedBaseURL?.length ?? 0,
});

// Validate that we have a valid base URL
if (!resolvedBaseURL) {
  const errorMsg =
    "CRITICAL: No base URL resolved for Better Auth! SSO and OAuth will fail.";
  logger.error(errorMsg, {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BASE_URL: process.env.BASE_URL,
    NEXT_PUBLIC_BASE_URL: env.NEXT_PUBLIC_BASE_URL,
  });
  // In production, this is a fatal configuration error
  if (process.env.NODE_ENV === "production") {
    throw new Error(errorMsg);
  }
}

// Validate the URL is parseable
let isValidUrl = false;
let urlOrigin = "";
let urlParseError = "";
try {
  const parsed = new URL(resolvedBaseURL || "");
  isValidUrl = true;
  urlOrigin = parsed.origin;
} catch (e) {
  urlParseError = e instanceof Error ? e.message : String(e);
}

// Log the resolved base URL for debugging
logger.info("AUTH DEBUG: Base URL validation", {
  resolvedBaseURL,
  isValidUrl,
  urlOrigin,
  urlParseError: urlParseError || "(none)",
  contains0000: resolvedBaseURL?.includes("0.0.0.0") ?? false,
  containsLocalhost: resolvedBaseURL?.includes("localhost") ?? false,
});

// DEBUG: Log the exact config being passed to Better Auth
logger.info("AUTH DEBUG: Creating betterAuth config", {
  baseURL: resolvedBaseURL,
  trustedOrigins: [resolvedBaseURL],
  basePath: "/api/auth",
});

export const betterAuthConfig = betterAuth({
  advanced: {
    database: {
      generateId: false,
    },
  },
  logger: {
    level: "debug", // Changed to debug for more verbose logging
    log: (level, message, ...args) => {
      // Log ALL Better Auth internal messages for debugging
      const logData = {
        args: args.length > 0 ? args : undefined,
        level,
        timestamp: new Date().toISOString(),
      };

      // Special attention to SSO, session, user, and callback-related logs
      if (
        message.toLowerCase().includes("sso") ||
        message.toLowerCase().includes("state") ||
        message.toLowerCase().includes("callback") ||
        message.toLowerCase().includes("verification") ||
        message.toLowerCase().includes("session") ||
        message.toLowerCase().includes("user") ||
        message.toLowerCase().includes("account") ||
        message.toLowerCase().includes("token")
      ) {
        logger.info(`[BetterAuth:${level}] 🔍 ${message}`, logData);
      } else {
        logger.info(`[BetterAuth:${level}] ${message}`, logData);
      }
    },
    error: (error: unknown, ...args: unknown[]) => {
      // Enhanced error logging with full details
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`[BetterAuth:ERROR] ❌ ${errorMessage}`, {
        error,
        errorStack,
        errorName: error instanceof Error ? error.name : "Unknown",
        args: args.length > 0 ? args : undefined,
        timestamp: new Date().toISOString(),
      });
    },
  },
  baseURL: resolvedBaseURL,
  trustedOrigins: [resolvedBaseURL],
  secret: env.AUTH_SECRET || env.NEXTAUTH_SECRET,
  emailAndPassword: {
    enabled: false,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  plugins: [
    nextCookies(),
    sso({
      disableImplicitSignUp: false,
      organizationProvisioning: { disabled: true },
      // Trust email verification from Okta SSO provider
      // This allows automatic account linking when email matches
      trustEmailVerified: true,
      // Add custom user provisioning to log what's happening
      provisionUser: async ({ user, userInfo, token, provider }) => {
        logger.info("[SSO] 🎯 User provisioning triggered", {
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          userInfoEmail: userInfo.email,
          userInfoName: userInfo.name,
          providerId: provider.providerId,
          providerIssuer: provider.issuer,
          hasAccessToken: !!token?.accessToken,
          hasRefreshToken: !!token?.refreshToken,
          timestamp: new Date().toISOString(),
        });
      },
    }),
  ],
  session: {
    modelName: "Session",
    fields: {
      token: "sessionToken",
      expiresAt: "expires",
    },
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24 * 3, // 1 day (every 1 day the session expiration is updated)
  },
  account: {
    modelName: "Account",
    fields: {
      accountId: "providerAccountId",
      providerId: "provider",
      refreshToken: "refresh_token",
      refreshTokenExpiresAt: "refreshTokenExpiresAt",
      accessToken: "access_token",
      accessTokenExpiresAt: "expires_at",
      idToken: "id_token",
    },
    // Enable account linking for trusted SSO providers
    accountLinking: {
      enabled: true,
      // Trust our Okta SSO provider for automatic linking
      trustedProviders: ["okta-tiger21-1765774132282"],
    },
  },
  verification: {
    modelName: "VerificationToken",
    fields: {
      value: "token",
      expiresAt: "expires",
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      scope: [...GMAIL_SCOPES],
      accessType: "offline",
      prompt: "select_account",
      disableIdTokenSignIn: true,
    },
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID || "",
      clientSecret: env.MICROSOFT_CLIENT_SECRET || "",
      scope: [...OUTLOOK_SCOPES, "offline_access"],
      tenantId: "common",
      // Only prompt for consent on first login, not every time
      prompt: "select_account",
      disableIdTokenSignIn: true,
    },
  },
  events: {
    signIn: handleSignIn,
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account: Account) => {
          await handleLinkAccount(account);
        },
      },
      update: {
        after: async (account: Account) => {
          await handleLinkAccount(account);
        },
      },
    },
  },
  onAPIError: {
    throw: true,
    onError: (error: unknown, ctx: AuthContext) => {
      // DEBUG: Enhanced error logging for Better Auth API errors
      logger.error("AUTH DEBUG: Better Auth API error", {
        error: error instanceof Error ? error.message : error,
        errorStack: error instanceof Error ? error.stack : undefined,
        contextBaseURL: ctx?.baseURL,
        contextOptionsBaseURL: ctx?.options?.baseURL,
        contextBasePath: ctx?.options?.basePath,
      });
    },
    errorURL: "/login/error",
  },
});

// DEBUG: Log after betterAuthConfig is created
logger.info("AUTH DEBUG: betterAuthConfig created successfully", {
  hasHandler: typeof betterAuthConfig.handler === "function",
  hasApi: typeof betterAuthConfig.api === "object",
  apiKeys: Object.keys(betterAuthConfig.api || {}),
});

// DEBUG: Async check of the context after initialization
betterAuthConfig.$context
  .then((ctx) => {
    logger.info("AUTH DEBUG: Better Auth context resolved", {
      baseURL: ctx.baseURL,
      optionsBaseURL: ctx.options?.baseURL,
      optionsBasePath: ctx.options?.basePath,
      trustedOrigins: ctx.trustedOrigins,
      baseURLContains0000: ctx.baseURL?.includes("0.0.0.0") ?? false,
    });
  })
  .catch((err) => {
    logger.error("AUTH DEBUG: Failed to resolve Better Auth context", {
      error: err instanceof Error ? err.message : err,
    });
  });

logger.info("=== AUTH MODULE INITIALIZATION END ===");

async function handleSignIn({
  user,
  isNewUser,
}: {
  user: User;
  isNewUser: boolean;
}) {
  logger.info("handleSignIn called", {
    userId: user.id,
    email: user.email,
    isNewUser,
  });

  // CRITICAL: Check if email domain is allowed
  // This blocks unauthorized domains from accessing the application
  if (user.email && !isEmailDomainAllowed(user.email)) {
    logger.warn("Sign-in attempt from unauthorized domain - BLOCKED", {
      email: user.email,
      domain: user.email.split("@")[1],
      isNewUser,
    });

    // Delete the unauthorized user immediately (both new and existing)
    // This ensures no unauthorized users can exist in the database
    await prisma.user
      .delete({
        where: { id: user.id },
      })
      .catch((error) => {
        logger.error("Failed to delete unauthorized user", {
          userId: user.id,
          email: user.email,
          isNewUser,
          error,
        });
      });

    throw new Error("DomainNotAllowed");
  }

  if (isNewUser && user.email) {
    const loops = async () => {
      const account = await prisma.account
        .findFirst({
          where: { userId: user.id },
          select: { provider: true },
        })
        .catch((error) => {
          logger.error("Error finding account", {
            userId: user.id,
            error,
          });
          captureException(error, undefined, user.email);
        });

      await createLoopsContact(
        user.email,
        user.name?.split(" ")?.[0],
        account?.provider,
      ).catch((error) => {
        const alreadyExists =
          error instanceof Error && error.message.includes("409");
        if (!alreadyExists) {
          logger.error("Error creating Loops contact", {
            email: user.email,
            error,
          });
          captureException(error, undefined, user.email);
        }
      });
    };

    const resend = createResendContact({ email: user.email }).catch((error) => {
      logger.error("Error creating Resend contact", {
        email: user.email,
        error,
      });
      captureException(error, undefined, user.email);
    });

    const dub = trackDubSignUp(user).catch((error) => {
      logger.error("Error tracking Dub sign up", {
        email: user.email,
        error,
      });
      captureException(error, undefined, user.email);
    });

    await Promise.all([loops(), resend, dub]);
  }

  if (isNewUser && user.email && user.id) {
    // Handle pending invite first (might connect user to existing premium)
    await handlePendingPremiumInvite({ email: user.email });

    // Then create premium if user still doesn't have one, and handle referral
    await Promise.all([
      handleReferralOnSignUp({
        userId: user.id,
        email: user.email,
      }),
      // Automatically create premium for all new users (checks if already has premium)
      createAutoPremiumForNewUser({ userId: user.id }),
    ]);
  }
}
async function handlePendingPremiumInvite({ email }: { email: string }) {
  logger.info("Handling pending premium invite", { email });

  // Check for pending invite
  const premium = await prisma.premium.findFirst({
    where: { pendingInvites: { has: email } },
    select: {
      id: true,
      pendingInvites: true,
      lemonSqueezySubscriptionItemId: true,
      stripeSubscriptionId: true,
      _count: { select: { users: true } },
    },
  });

  if (
    premium?.lemonSqueezySubscriptionItemId ||
    premium?.stripeSubscriptionId
  ) {
    // Add user to premium and remove from pending invites
    await prisma.premium.update({
      where: { id: premium.id },
      data: {
        users: { connect: { email } },
        pendingInvites: {
          set: premium.pendingInvites.filter((e: string) => e !== email),
        },
      },
    });
  }

  logger.info("Added user to premium from invite", { email });
}

/**
 * Creates a default digest schedule for a new email account.
 * Schedule: Daily at 8am EST (13:00 UTC), weekdays only.
 */
async function createDefaultDigestSchedule({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  try {
    // Check if schedule already exists
    const existingSchedule = await prisma.schedule.findUnique({
      where: { emailAccountId },
    });

    if (existingSchedule) {
      logger.info("Digest schedule already exists, skipping creation", {
        emailAccountId,
      });
      return;
    }

    // Calculate next occurrence (tomorrow at 8am EST = 13:00 UTC)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(13, 0, 0, 0); // 8am EST = 13:00 UTC

    await prisma.schedule.create({
      data: {
        emailAccountId,
        intervalDays: 1, // Daily
        timeOfDay: new Date("1970-01-01T13:00:00.000Z"), // 8am EST
        daysOfWeek: 32, // Weekdays bitmask (Monday-Friday)
        nextOccurrenceAt: tomorrow,
      },
    });

    logger.info("Successfully created default digest schedule", {
      emailAccountId,
      nextOccurrenceAt: tomorrow.toISOString(),
    });
  } catch (error) {
    logger.error("Error creating default digest schedule", {
      emailAccountId,
      error,
    });
    // Don't throw - schedule creation failure shouldn't prevent account linking
    captureException(error, {
      extra: { emailAccountId, location: "createDefaultDigestSchedule" },
    });
  }
}

async function createAutoPremiumForNewUser({ userId }: { userId: string }) {
  try {
    logger.info("Creating automatic premium for new user", { userId });

    // Check if user already has premium (could happen from pending invite)
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { premiumId: true },
    });

    if (existingUser?.premiumId) {
      logger.info("User already has premium, skipping auto-creation", {
        userId,
      });
      return;
    }

    // Create lifetime premium with generous email account access
    const premium = await prisma.premium.create({
      data: {
        lemonSqueezyRenewsAt: new Date(
          Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
        ), // 10 years
        tier: "LIFETIME",
        emailAccountsAccess: 10, // Allow up to 10 email accounts per user
        users: { connect: { id: userId } },
        admins: { connect: { id: userId } },
      },
    });

    logger.info("Successfully created automatic premium for new user", {
      userId,
      premiumId: premium.id,
    });
  } catch (error) {
    logger.error("Error creating automatic premium for new user", {
      userId,
      error,
    });
    // Don't throw error - premium creation failure shouldn't prevent sign up
    captureException(error, {
      extra: { userId, location: "createAutoPremiumForNewUser" },
    });
  }
}

export async function handleReferralOnSignUp({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  try {
    const cookieStore = await cookies();
    const referralCookie = cookieStore.get("referral_code");

    if (!referralCookie?.value) {
      logger.info("No referral code found in cookies", { email });
      return;
    }

    const referralCode = referralCookie.value;
    logger.info("Processing referral for new user", {
      email,
      referralCode,
    });

    // Import the createReferral function
    const { createReferral } = await import("@/utils/referral/referral-code");
    await createReferral(userId, referralCode);
    logger.info("Successfully created referral", {
      email,
      referralCode,
    });
  } catch (error) {
    logger.error("Error processing referral on sign up", {
      error,
      userId,
      email,
    });
    // Don't throw error - referral failure shouldn't prevent sign up
    captureException(error, {
      extra: { userId, email, location: "handleReferralOnSignUp" },
    });
  }
}

// TODO: move into email provider instead of checking the provider type
async function getProfileData(providerId: string, accessToken: string) {
  if (isGoogleProvider(providerId)) {
    const contactsClient = getGoogleContactsClient({ accessToken });
    const profileResponse = await contactsClient.people.get({
      resourceName: "people/me",
      personFields: "emailAddresses,names,photos",
    });

    return {
      email: profileResponse.data.emailAddresses
        ?.find((e) => e.metadata?.primary)
        ?.value?.toLowerCase(),
      name: profileResponse.data.names?.find((n) => n.metadata?.primary)
        ?.displayName,
      image: profileResponse.data.photos?.find((p) => p.metadata?.primary)?.url,
    };
  }

  if (isMicrosoftProvider(providerId)) {
    const client = getOutlookContactsClient({ accessToken });
    try {
      const profileResponse = await client.getUserProfile();

      // Get photo separately as it requires a different endpoint
      let photoUrl = null;
      try {
        const photo = await client.getUserPhoto();
        if (photo) {
          photoUrl = photo;
        }
      } catch (error) {
        logger.info("User has no profile photo", { error });
      }

      return {
        email:
          profileResponse.mail?.toLowerCase() ||
          profileResponse.userPrincipalName?.toLowerCase(),
        name: profileResponse.displayName,
        image: photoUrl,
      };
    } catch (error) {
      logger.error("Error fetching Microsoft profile data", { error });
      throw error;
    }
  }

  // For SSO providers, we can't fetch profile data using access token
  // The profile data should already be available in the user record
  if (providerId.includes("okta") || providerId.includes("sso")) {
    logger.info("[getProfileData] SSO provider detected, returning null", {
      providerId,
    });
    return null;
  }

  logger.warn("[getProfileData] Unknown provider type", { providerId });

  return null;
}

async function handleLinkAccount(account: Account) {
  let primaryEmail: string | null | undefined;
  let primaryName: string | null | undefined;
  let primaryPhotoUrl: string | null | undefined;

  try {
    // SSO providers (like Okta) are for AUTHENTICATION ONLY.
    // They don't provide email access (read/send), so we should NOT create
    // EmailAccount records for them. EmailAccount records are only for
    // email providers (Google/Microsoft OAuth) that provide mailbox access.
    //
    // When users log in via SSO, they:
    // 1. Get a User record (for auth identity)
    // 2. Get an Account record linked to the SSO provider (for auth tokens)
    // 3. Do NOT get an EmailAccount record (no email access)
    // 4. Must separately link a Google/Microsoft account for email access
    if (
      account.providerId.includes("okta") ||
      account.providerId.includes("sso") ||
      account.providerId.includes("saml")
    ) {
      logger.info(
        "[handleLinkAccount] SSO provider detected - skipping EmailAccount creation",
        {
          providerId: account.providerId,
          userId: account.userId,
          reason: "SSO providers are for authentication only, not email access",
        },
      );
      // Early return - do NOT create EmailAccount for SSO providers
      return;
    }

    // Only Google and Microsoft OAuth providers should create EmailAccount records
    if (
      !isGoogleProvider(account.providerId) &&
      !isMicrosoftProvider(account.providerId)
    ) {
      logger.warn(
        "[handleLinkAccount] Unknown provider type - skipping EmailAccount creation",
        {
          providerId: account.providerId,
          userId: account.userId,
        },
      );
      return;
    }

    // OAuth provider logic - fetch profile data using access token
    if (!account.accessToken) {
      logger.error(
        "[linkAccount] No access_token found in data, cannot fetch profile.",
      );
      throw new Error("Missing access token during account linking.");
    }
    const profileData = await getProfileData(
      account.providerId,
      account.accessToken,
    );

    if (!profileData?.email) {
      logger.error("[handleLinkAccount] No email found in profile data");
    }

    primaryEmail = profileData?.email;
    primaryName = profileData?.name;
    primaryPhotoUrl = profileData?.image;

    if (!primaryEmail) {
      logger.error(
        "[linkAccount] Primary email could not be determined from profile.",
      );
      throw new Error("Primary email not found for linked account.");
    }

    const user = await prisma.user.findUnique({
      where: { id: account.userId },
      select: { email: true, name: true, image: true },
    });

    if (!user?.email) {
      logger.error("[linkAccount] No user email found", {
        userId: account.userId,
      });
      return;
    }

    // --- Create/Update the corresponding EmailAccount record ---
    const emailAccountData: Prisma.EmailAccountUpsertArgs = {
      where: { email: primaryEmail },
      update: {
        userId: account.userId,
        accountId: account.id,
        name: primaryName,
        image: primaryPhotoUrl,
      },
      create: {
        email: primaryEmail,
        userId: account.userId,
        accountId: account.id,
        name: primaryName,
        image: primaryPhotoUrl,
      },
    };
    const emailAccount = await prisma.emailAccount.upsert(emailAccountData);

    // Create default digest schedule for new email accounts
    await createDefaultDigestSchedule({
      emailAccountId: emailAccount.id,
    }).catch((error) => {
      logger.error("[linkAccount] Error creating digest schedule:", {
        emailAccountId: emailAccount.id,
        error,
      });
      captureException(error, { extra: { emailAccountId: emailAccount.id } });
    });

    // Handle premium account seats
    await updateAccountSeats({ userId: account.userId }).catch((error) => {
      logger.error("[linkAccount] Error updating premium account seats:", {
        userId: account.userId,
        error,
      });
      captureException(error, { extra: { userId: account.userId } });
    });

    logger.info("[linkAccount] Successfully linked account", {
      email: user.email,
      userId: account.userId,
      accountId: account.id,
    });
  } catch (error) {
    logger.error("[linkAccount] Error during linking process:", {
      userId: account.userId,
      error,
    });
    captureException(error, {
      extra: { userId: account.userId, location: "linkAccount" },
    });
    throw error;
  }
}

export async function saveTokens({
  tokens,
  accountRefreshToken,
  providerAccountId,
  emailAccountId,
  provider,
}: {
  tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
  accountRefreshToken: string | null;
  provider: string;
} & ( // provide one of these:
  | {
      providerAccountId: string;
      emailAccountId?: never;
    }
  | {
      emailAccountId: string;
      providerAccountId?: never;
    }
)) {
  const refreshToken = tokens.refresh_token ?? accountRefreshToken;

  if (!refreshToken) {
    logger.error("Attempted to save null refresh token", { providerAccountId });
    captureException("Cannot save null refresh token", {
      extra: { providerAccountId },
    });
    return;
  }

  const data = {
    access_token: tokens.access_token,
    expires_at: tokens.expires_at ? new Date(tokens.expires_at * 1000) : null,
    refresh_token: refreshToken,
  };

  if (emailAccountId) {
    // Encrypt tokens in data directly
    // Usually we do this in prisma-extensions.ts but we need to do it here because we're updating the account via the emailAccount
    // We could also edit prisma-extensions.ts to handle this case but this is easier for now
    if (data.access_token)
      data.access_token = encryptToken(data.access_token) || undefined;
    if (data.refresh_token)
      data.refresh_token = encryptToken(data.refresh_token) || "";

    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { account: { update: data } },
    });
  } else {
    if (!providerAccountId) {
      logger.error("No providerAccountId found in database", {
        emailAccountId,
      });
      captureException("No providerAccountId found in database", {
        extra: { emailAccountId },
      });
      return;
    }

    return await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      data,
    });
  }
}

export const auth = async () =>
  betterAuthConfig.api.getSession({ headers: await headers() });
