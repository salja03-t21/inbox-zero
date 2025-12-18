"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useState, useEffect, Suspense, useRef } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { toastError } from "@/components/Toast";
import { Loader2 } from "lucide-react";

const ssoLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type SsoLoginBody = z.infer<typeof ssoLoginSchema>;

// Known Okta issuers that should trigger auto-login
const KNOWN_ISSUERS: Record<string, string> = {
  "https://apps.tiger21.com": "okta-tiger21-1765774132282",
};

function SSOLoginContent() {
  const searchParams = useSearchParams();
  const issuer = searchParams.get("iss");
  const autoLoginAttempted = useRef(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SsoLoginBody>({
    resolver: zodResolver(ssoLoginSchema),
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoLogin, setIsAutoLogin] = useState(false);

  // Function to trigger SSO login
  const triggerSSOLogin = useCallback(async (providerId: string) => {
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/sign-in/sso", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          callbackURL: `${window.location.origin}/`,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        toastError({
          title: "SSO Sign-in Error",
          description: responseData.error || "Failed to initiate SSO sign-in",
        });
        setIsAutoLogin(false);
        return;
      }

      // Better Auth returns {url: string, redirect: boolean}
      if (responseData.url) {
        window.location.href = responseData.url;
      } else {
        setIsAutoLogin(false);
      }
    } catch (_error) {
      toastError({
        title: "SSO Sign-in Error",
        description: "An unexpected error occurred. Please try again.",
      });
      setIsAutoLogin(false);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  // Handle IdP-initiated login (user clicks app in Okta dashboard)
  useEffect(() => {
    // Only auto-login once when coming from a known issuer
    if (issuer && KNOWN_ISSUERS[issuer] && !autoLoginAttempted.current) {
      autoLoginAttempted.current = true;
      setIsAutoLogin(true);
      triggerSSOLogin(KNOWN_ISSUERS[issuer]);
    }
  }, [issuer, triggerSSOLogin]);

  const onSubmit: SubmitHandler<SsoLoginBody> = useCallback(async () => {
    await triggerSSOLogin("okta-tiger21-1765774132282");
  }, [triggerSSOLogin]);

  // Show loading state for IdP-initiated login
  if (isAutoLogin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Signing you in via SSO...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col justify-center text-foreground">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col text-center">
          <h1 className="font-cal text-2xl text-foreground">SSO Sign In</h1>
          <p className="mt-4 text-muted-foreground">
            Sign in to your organization account
          </p>
        </div>

        <div className="mt-4">
          <div className="space-y-4">
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <Input
                type="email"
                name="email"
                label="Email"
                placeholder="your-email@tiger21.com"
                registerProps={register("email")}
                error={errors.email}
              />

              <Button type="submit" size="lg" full loading={isSubmitting}>
                Continue with SSO
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="flex h-screen flex-col items-center justify-center text-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-muted-foreground">Loading...</p>
    </div>
  );
}

export default function SSOLoginPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SSOLoginContent />
    </Suspense>
  );
}
