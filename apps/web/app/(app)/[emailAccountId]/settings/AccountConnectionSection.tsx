"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormSection, FormSectionLeft } from "@/components/Form";
import { LoadingContent } from "@/components/LoadingContent";
import { toastSuccess, toastError } from "@/components/Toast";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";
import useSWR from "swr";
import { RefreshCwIcon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { signIn } from "@/utils/auth-client";

type AccountStatusResponse = {
  isConnected: boolean;
  expiresAt: string | null;
  provider: string;
  hasExpiringRefreshToken: boolean;
};

export function AccountConnectionSection() {
  const { emailAccount } = useAccount();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const searchParams = useSearchParams();

  const { data, isLoading, error, mutate } = useSWR<AccountStatusResponse>(
    emailAccount?.id ? `/api/user/account-status` : null,
  );

  // Show toast notifications after returning from the reconnect flow
  useEffect(() => {
    const reconnectResult = searchParams.get("reconnect");
    if (!reconnectResult) return;

    if (reconnectResult === "success") {
      toastSuccess({
        description:
          "Microsoft account reconnected successfully. Your tokens have been refreshed.",
      });
      // Refresh the account status data
      mutate();
    } else if (reconnectResult === "error") {
      const errorCode = searchParams.get("reconnect_error") || "unknown";
      const errorMessages: Record<string, string> = {
        invalid_state: "Security validation failed. Please try again.",
        invalid_state_format: "Security validation failed. Please try again.",
        missing_code:
          "Microsoft did not return an authorization code. Please try again.",
        account_not_found:
          "Email account not found. Please refresh the page and try again.",
        reconnect_failed:
          "Failed to reconnect your Microsoft account. Please try again.",
        access_denied:
          "You denied the permission request. Please try again and grant access.",
      };
      toastError({
        title: "Reconnection failed",
        description:
          errorMessages[errorCode] ||
          `An unexpected error occurred (${errorCode}). Please try again.`,
      });
    }

    // Clean up the query params from the URL without triggering a navigation
    const url = new URL(window.location.href);
    url.searchParams.delete("reconnect");
    url.searchParams.delete("reconnect_error");
    window.history.replaceState({}, "", url.toString());
  }, [searchParams, mutate]);

  if (!emailAccount) return null;

  const provider = emailAccount.account?.provider || "";
  const providerName = isGoogleProvider(provider)
    ? "Google"
    : isMicrosoftProvider(provider)
      ? "Microsoft"
      : provider;

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      if (isGoogleProvider(provider)) {
        // Google: use Better Auth's signIn.social (works for Google)
        await signIn.social({
          provider: "google",
          callbackURL: window.location.href,
        });
      } else if (isMicrosoftProvider(provider)) {
        // Microsoft: use custom reconnect flow that properly updates tokens
        // Better Auth's signIn.social does NOT update tokens for existing accounts
        window.location.href = `/api/user/reconnect-microsoft?emailAccountId=${emailAccount.id}`;
      }
    } catch (error) {
      console.error("Failed to reconnect:", error);
      setIsReconnecting(false);
    }
  };

  // Only show expiration warnings if the refresh token actually expires
  // Microsoft refresh tokens don't have expiration dates (they're valid as long as they're used)
  const shouldShowExpiration = data?.hasExpiringRefreshToken ?? false;

  const isTokenExpired =
    shouldShowExpiration && data?.expiresAt
      ? new Date(data.expiresAt) < new Date()
      : false;

  const isTokenExpiringSoon =
    shouldShowExpiration && data?.expiresAt
      ? new Date(data.expiresAt).getTime() - Date.now() <
        7 * 24 * 60 * 60 * 1000 // 7 days
      : false;

  return (
    // biome-ignore lint/correctness/useUniqueElementIds: FormSection is only rendered once per settings page
    <FormSection id="account-connection">
      <FormSectionLeft
        title="Account Connection"
        description={`Reconnect your ${providerName} account if your authentication token has expired or you need to refresh permissions.`}
      />

      <LoadingContent loading={isLoading} error={error}>
        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              {isTokenExpired ? (
                <>
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircleIcon className="h-3 w-3" />
                    Expired
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Your account token has expired
                  </span>
                </>
              ) : isTokenExpiringSoon ? (
                <>
                  <Badge variant="outline" className="gap-1 border-yellow-600">
                    <AlertCircleIcon className="h-3 w-3 text-yellow-600" />
                    Expiring Soon
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Expires{" "}
                    {data.expiresAt
                      ? new Date(data.expiresAt).toLocaleDateString()
                      : "soon"}
                  </span>
                </>
              ) : (
                <>
                  <Badge variant="outline" className="gap-1 border-green-600">
                    <CheckCircle2Icon className="h-3 w-3 text-green-600" />
                    Connected
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {shouldShowExpiration && data.expiresAt
                      ? `Expires ${new Date(data.expiresAt).toLocaleDateString()}`
                      : "Active"}
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button
                onClick={handleReconnect}
                disabled={isReconnecting}
                variant={isTokenExpired ? "default" : "outline"}
                className="w-fit"
              >
                <RefreshCwIcon
                  className={`mr-2 h-4 w-4 ${isReconnecting ? "animate-spin" : ""}`}
                />
                {isReconnecting
                  ? "Reconnecting..."
                  : isTokenExpired
                    ? "Reconnect Account"
                    : "Refresh Connection"}
              </Button>

              {isTokenExpired && (
                <p className="text-sm text-muted-foreground">
                  You need to reconnect your account to continue using Inbox
                  Zero features.
                </p>
              )}
            </div>
          </div>
        )}
      </LoadingContent>
    </FormSection>
  );
}
