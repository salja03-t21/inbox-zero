"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Button as UIButton } from "@/components/ui/button";
import { SectionDescription } from "@/components/Typography";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { signIn } from "@/utils/auth-client";
import { WELCOME_PATH } from "@/utils/config";

export function LoginForm({
  enableGoogleAuth = true,
  enableMicrosoftAuth = true,
  enableSSOAuth = true,
}: {
  enableGoogleAuth?: boolean;
  enableMicrosoftAuth?: boolean;
  enableSSOAuth?: boolean;
}) {
  const searchParams = useSearchParams();
  const next = searchParams?.get("next");
  const error = searchParams?.get("error");

  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingMicrosoft, setLoadingMicrosoft] = useState(false);

  // If no auth methods are enabled, show an error
  if (!enableGoogleAuth && !enableMicrosoftAuth && !enableSSOAuth) {
    return (
      <div className="px-4 text-center text-sm text-red-600 sm:px-16">
        No authentication methods are currently enabled. Please contact your
        administrator.
      </div>
    );
  }

  const handleGoogleSignIn = async () => {
    setLoadingGoogle(true);
    await signIn.social({
      provider: "google",
      errorCallbackURL: "/login/error",
      callbackURL: next && next.length > 0 ? next : WELCOME_PATH,
      ...(error === "RequiresReconsent" ? { consent: true } : {}),
    });
    setLoadingGoogle(false);
  };

  const handleMicrosoftSignIn = async () => {
    setLoadingMicrosoft(true);
    await signIn.social({
      provider: "microsoft",
      errorCallbackURL: "/login/error",
      callbackURL: next && next.length > 0 ? next : WELCOME_PATH,
      ...(error === "RequiresReconsent" ? { consent: true } : {}),
    });
    setLoadingMicrosoft(false);
  };

  return (
    <div className="flex flex-col justify-center gap-2 px-4 sm:px-16">
      {enableGoogleAuth && (
        <Dialog>
          <DialogTrigger asChild>
            <Button size="2xl">
              <span className="flex items-center justify-center">
                <Image
                  src="/images/google.svg"
                  alt=""
                  width={24}
                  height={24}
                  unoptimized
                />
                <span className="ml-2">Sign in with Google</span>
              </span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sign in</DialogTitle>
            </DialogHeader>
            <SectionDescription>
              Inbox Zero{"'"}s use and transfer of information received from
              Google APIs to any other app will adhere to{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="underline underline-offset-4 hover:text-gray-900"
              >
                Google API Services User Data
              </a>{" "}
              Policy, including the Limited Use requirements.
            </SectionDescription>
            <div>
              <Button loading={loadingGoogle} onClick={handleGoogleSignIn}>
                I agree
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {enableMicrosoftAuth && (
        <Button
          size="2xl"
          loading={loadingMicrosoft}
          onClick={handleMicrosoftSignIn}
        >
          <span className="flex items-center justify-center">
            <Image
              src="/images/microsoft.svg"
              alt=""
              width={24}
              height={24}
              unoptimized
            />
            <span className="ml-2">Sign in with Microsoft</span>
          </span>
        </Button>
      )}

      {enableSSOAuth && (
        <UIButton
          variant="ghost"
          size="lg"
          className="w-full hover:scale-105 transition-transform"
          asChild
        >
          <Link href="/login/sso">Sign in with SSO</Link>
        </UIButton>
      )}
    </div>
  );
}
