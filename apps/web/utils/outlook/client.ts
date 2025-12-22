import { Client } from "@microsoft/microsoft-graph-client";
import type { User } from "@microsoft/microsoft-graph-types";
import { saveTokens } from "@/utils/auth";
import { env } from "@/env";
import { createScopedLogger } from "@/utils/logger";
import { SCOPES } from "@/utils/outlook/scopes";
import { SafeError } from "@/utils/error";

const logger = createScopedLogger("outlook/client");

// Microsoft tenant ID for OAuth token endpoints
// - For single-tenant apps (e.g., TIGER21): use the specific tenant ID
// - For multi-tenant apps: use "common" to support any Microsoft account
// Set via MICROSOFT_TENANT_ID env var, defaults to "common" for flexibility
const MICROSOFT_TENANT_ID = env.MICROSOFT_TENANT_ID || "common";

type AuthOptions = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  expiresAt?: number | null;
};

// Wrapper class to hold both the Microsoft Graph client and its access token
export class OutlookClient {
  private readonly client: Client;
  private readonly accessToken: string;
  private readonly sharedMailboxEmail: string | null;
  private folderIdCache: Record<string, string> | null = null;

  constructor(accessToken: string, sharedMailboxEmail?: string | null) {
    this.accessToken = accessToken;
    this.sharedMailboxEmail = sharedMailboxEmail || null;
    this.client = Client.init({
      authProvider: (done) => {
        done(null, this.accessToken);
      },
      defaultVersion: "v1.0",
      // Use immutable IDs to ensure message IDs remain stable
      // https://learn.microsoft.com/en-us/graph/outlook-immutable-id
      fetchOptions: {
        headers: {
          Prefer: 'IdType="ImmutableId"',
        },
      },
    });
  }

  getClient(): Client {
    return this.client;
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  getFolderIdCache(): Record<string, string> | null {
    return this.folderIdCache;
  }

  setFolderIdCache(cache: Record<string, string>): void {
    this.folderIdCache = cache;
  }

  /**
   * Get the base URL for Microsoft Graph API calls.
   * For shared mailboxes, use /users/{email} instead of /me
   */
  getBaseUrl(): string {
    return this.sharedMailboxEmail
      ? `/users/${encodeURIComponent(this.sharedMailboxEmail)}`
      : "/me";
  }

  // Helper methods for common operations
  async getUserProfile(): Promise<User> {
    return await this.client
      .api(this.getBaseUrl())
      .select("id,displayName,mail,userPrincipalName")
      .get();
  }

  async getUserPhoto(): Promise<string | null> {
    try {
      const photoResponse = await this.client
        .api(`${this.getBaseUrl()}/photo/$value`)
        .get();

      if (photoResponse) {
        const arrayBuffer = await photoResponse.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return `data:image/jpeg;base64,${base64}`;
      }
      return null;
    } catch {
      logger.warn("Error getting user photo");
      return null;
    }
  }
}

// Helper to create OutlookClient instance
const createOutlookClient = (
  accessToken: string,
  sharedMailboxEmail?: string | null,
) => {
  return new OutlookClient(accessToken, sharedMailboxEmail);
};

export const getContactsClient = ({ accessToken }: AuthOptions) => {
  if (!accessToken) throw new SafeError("No access token provided");
  return createOutlookClient(accessToken);
};

// Similar to Gmail's getGmailClientWithRefresh
export const getOutlookClientWithRefresh = async ({
  accessToken,
  refreshToken,
  expiresAt,
  emailAccountId,
  sharedMailboxEmail,
}: {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  sharedMailboxEmail?: string | null;
}): Promise<OutlookClient> => {
  if (!refreshToken) throw new SafeError("No refresh token");

  // Check if token needs refresh
  // expiresAt is stored in seconds (Unix timestamp), Date.now() returns milliseconds
  const expiryDate = expiresAt ? expiresAt * 1000 : null;
  if (accessToken && expiryDate && expiryDate > Date.now()) {
    return createOutlookClient(accessToken, sharedMailboxEmail);
  }

  // Refresh token
  try {
    if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
      throw new Error("Microsoft login not enabled - missing credentials");
    }

    // Use tenant-specific endpoint instead of /common for single-tenant app
    const response = await fetch(
      `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: env.MICROSOFT_CLIENT_ID,
          client_secret: env.MICROSOFT_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
          scope: SCOPES.join(" "),
        }),
      },
    );

    const tokens = await response.json();

    if (!response.ok) {
      throw new Error(tokens.error_description || "Failed to refresh token");
    }

    // Save new tokens
    await saveTokens({
      tokens: {
        access_token: tokens.access_token,
        expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
      },
      accountRefreshToken: refreshToken,
      emailAccountId,
      provider: "microsoft",
    });

    return createOutlookClient(tokens.access_token, sharedMailboxEmail);
  } catch (error) {
    const isInvalidGrantError =
      error instanceof Error &&
      (error.message.includes("invalid_grant") ||
        error.message.includes("AADSTS50173"));

    if (isInvalidGrantError) {
      logger.warn("Error refreshing Outlook access token", { error });
    }

    throw error;
  }
};

export const getAccessTokenFromClient = (client: OutlookClient): string => {
  return client.getAccessToken();
};

// Helper function to get the OAuth2 URL for linking accounts
export function getLinkingOAuth2Url() {
  if (!env.MICROSOFT_CLIENT_ID) {
    throw new Error("Microsoft login not enabled - missing client ID");
  }

  // Use tenant-specific endpoint instead of /common for single-tenant app
  const baseUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`;
  const redirectUri = `${env.NEXT_PUBLIC_BASE_URL}/api/outlook/linking/callback`;

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    prompt: "select_account",
  });

  const finalUrl = `${baseUrl}?${params.toString()}`;

  return finalUrl;
}

// Helper types for common Microsoft Graph operations
export type { Client as GraphClient };
