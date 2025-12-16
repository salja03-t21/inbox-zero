"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { toastError, toastSuccess } from "@/components/Toast";

const ssoLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type SsoLoginBody = z.infer<typeof ssoLoginSchema>;

export default function SSOLoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SsoLoginBody>({
    resolver: zodResolver(ssoLoginSchema),
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit: SubmitHandler<SsoLoginBody> = useCallback(async (data) => {
    setIsSubmitting(true);

    console.log("[SSO Login] Starting SSO signin flow...", {
      email: data.email,
    });

    try {
      // Use Better Auth's built-in SSO signin endpoint
      console.log("[SSO Login] Calling /api/auth/sign-in/sso...");

      const response = await fetch("/api/auth/sign-in/sso", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Use providerId directly since we support multiple domains (@tiger21.com and @tiger21chair.com)
          // but they all use the same Okta provider
          providerId: "okta-tiger21-1765774132282",
          callbackURL: `${window.location.origin}/`, // Redirect to home after successful login
        }),
      });

      console.log("[SSO Login] Response status:", response.status);

      const responseData = await response.json();
      console.log("[SSO Login] Response data:", responseData);

      if (!response.ok) {
        console.error("[SSO Login] SSO signin failed:", responseData);
        toastError({
          title: "SSO Sign-in Error",
          description: responseData.error || "Failed to initiate SSO sign-in",
        });
        return;
      }

      // Better Auth returns {url: string, redirect: boolean}
      if (responseData.url) {
        console.log("[SSO Login] Redirecting to:", responseData.url);
        toastSuccess({ description: "Redirecting to SSO provider..." });
        window.location.href = responseData.url; // Use window.location.href for external redirect
      } else {
        console.error("[SSO Login] No redirect URL in response");
      }
    } catch (error) {
      console.error("[SSO Login] Exception during SSO signin:", error);
      toastError({
        title: "SSO Sign-in Error",
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, []);

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
