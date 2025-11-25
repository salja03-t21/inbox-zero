"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormSection, FormSectionLeft } from "@/components/Form";
import { LoadingContent } from "@/components/LoadingContent";
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
};

export function AccountConnectionSection() {
  const { emailAccount } = useAccount();
  const [isReconnecting, setIsReconnecting] = useState(false);

  const { data, isLoading, error } = useSWR<AccountStatusResponse>(
    emailAccount?.id ? `/api/user/account-status` : null,
  );

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
      // Trigger OAuth flow for the current provider
      if (isGoogleProvider(provider)) {
        await signIn.social({
          provider: "google",
          callbackURL: window.location.href,
        });
      } else if (isMicrosoftProvider(provider)) {
        await signIn.social({
          provider: "microsoft",
          callbackURL: window.location.href,
        });
      }
    } catch (error) {
      console.error("Failed to reconnect:", error);
      setIsReconnecting(false);
    }
  };

  const isTokenExpired = data?.expiresAt
    ? new Date(data.expiresAt) < new Date()
    : false;

  const isTokenExpiringSoon = data?.expiresAt
    ? new Date(data.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 // 7 days
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
                    {data.expiresAt
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
