"use client";

import { useState } from "react";
import { signIn } from "@/utils/auth-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toastError } from "@/components/Toast";
import Image from "next/image";
import type { GetAuthLinkUrlResponse } from "@/app/api/google/linking/auth-url/route";
import type { GetOutlookAuthLinkUrlResponse } from "@/app/api/outlook/linking/auth-url/route";
import { SCOPES as GMAIL_SCOPES } from "@/utils/gmail/scopes";

export function AddAccount() {
  const _handleConnectGoogle = async () => {
    await signIn.social({
      provider: "google",
      callbackURL: "/accounts",
      scopes: [...GMAIL_SCOPES],
    });
  };

  const _handleMergeGoogle = async () => {
    const response = await fetch("/api/google/linking/auth-url", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data: GetAuthLinkUrlResponse = await response.json();

    window.location.href = data.url;
  };

  const handleConnectMicrosoft = async () => {
    // Use auto action - backend will check if account exists to merge or create new
    const response = await fetch(`/api/outlook/linking/auth-url?action=auto`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      toastError({
        title: "Error initiating Microsoft link",
        description: "Please try again or contact support",
      });
      return;
    }

    const data: GetOutlookAuthLinkUrlResponse = await response.json();

    window.location.href = data.url;
  };

  return (
    <Card className="flex items-center justify-center">
      <CardContent className="flex flex-col items-center gap-4 p-6">
        {/* Google account adding disabled */}
        {/* <AddEmailAccount
          name="Google"
          image="/images/google.svg"
          handleConnect={handleConnectGoogle}
        /> */}
        <AddEmailAccount
          name="Microsoft"
          image="/images/microsoft.svg"
          handleConnect={handleConnectMicrosoft}
        />
      </CardContent>
    </Card>
  );
}

function AddEmailAccount({
  name,
  image,
  handleConnect,
}: {
  name: "Google" | "Microsoft";
  image: string;
  handleConnect: () => Promise<void>;
}) {
  const [isConnecting, setIsConnecting] = useState(false);

  const onConnect = async () => {
    setIsConnecting(true);
    try {
      await handleConnect();
    } catch (error) {
      console.error(`Error initiating ${name} link:`, error);
      toastError({
        title: `Error initiating ${name} link`,
        description: "Please try again or contact support",
      });
    }
    setIsConnecting(false);
  };

  return (
    <Button
      disabled={isConnecting}
      variant="outline"
      className="mt-auto w-full"
      onClick={onConnect}
    >
      <Image src={image} alt="" width={24} height={24} unoptimized />
      <span className="ml-2">
        {isConnecting ? "Connecting..." : `Add ${name} Account`}
      </span>
    </Button>
  );
}
