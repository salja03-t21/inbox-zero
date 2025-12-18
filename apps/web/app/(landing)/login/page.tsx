import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/app/(landing)/login/LoginForm";
import { auth } from "@/utils/auth";
import { AlertBasic } from "@/components/Alert";
import { env } from "@/env";
import { Button } from "@/components/ui/button";
import { WELCOME_PATH } from "@/utils/config";
import { CrispChatLoggedOutVisible } from "@/components/CrispChat";
import { getSafeRedirectUrl } from "@/utils/security/redirect";

export const metadata: Metadata = {
  title: "Log in | Inbox Zero",
  description: "Log in to Inbox Zero.",
  alternates: { canonical: "/login" },
};

// Force dynamic rendering so env vars are read at runtime
export const dynamic = "force-dynamic";

export default async function AuthenticationPage(props: {
  searchParams?: Promise<Record<string, string>>;
}) {
  const searchParams = await props.searchParams;
  const session = await auth();
  if (session?.user && !searchParams?.error) {
    redirect(getSafeRedirectUrl(searchParams?.next, WELCOME_PATH));
  }

  const enableGoogleAuth = false; // Disabled Google auth
  const enableMicrosoftAuth = env.ENABLE_MICROSOFT_AUTH;
  const enableSSOAuth = env.ENABLE_SSO_AUTH;

  return (
    <div className="flex h-screen flex-col justify-center text-foreground">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
        <div className="flex flex-col text-center">
          <h1 className="font-cal text-2xl text-foreground">Sign In</h1>
          <p className="mt-4 text-muted-foreground">
            Your AI personal assistant for email.
          </p>
        </div>
        <div className="mt-4">
          <Suspense>
            <LoginForm
              enableGoogleAuth={enableGoogleAuth}
              enableMicrosoftAuth={enableMicrosoftAuth}
              enableSSOAuth={enableSSOAuth}
            />
          </Suspense>
        </div>

        {searchParams?.error && <ErrorAlert error={searchParams?.error} />}

        {/* Terms of Service text hidden */}
        {/* <p className="px-8 pt-10 text-center text-sm text-muted-foreground">
          By clicking continue, you agree to our{" "}
          <Link
            href="/terms"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Privacy Policy
          </Link>
          .
        </p> */}

        <p className="px-4 pt-4 text-center text-sm text-muted-foreground">
          Inbox Zero{"'"}s use and transfer of information received from Google
          APIs to any other app will adhere to{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Google API Services User Data
          </a>{" "}
          Policy, including the Limited Use requirements.
        </p>
      </div>
    </div>
  );
}

function ErrorAlert({ error }: { error: string }) {
  if (error === "RequiresReconsent") return null;

  if (error === "DomainNotAllowed") {
    return (
      <AlertBasic
        variant="destructive"
        title="Access Restricted"
        description="Your email domain is not authorized to access this application. Please contact your administrator if you believe this is an error."
      />
    );
  }

  if (error === "OAuthAccountNotLinked") {
    return (
      <AlertBasic
        variant="destructive"
        title="Account already attached to another user"
        description={
          <>
            <span>You can merge accounts instead.</span>
            <Button asChild className="mt-2">
              <Link href="/accounts">Merge accounts</Link>
            </Button>
          </>
        }
      />
    );
  }

  return (
    <>
      <AlertBasic
        variant="destructive"
        title="Error logging in"
        description={`There was an error logging in. Please try log in again. If this error persists please contact support at ${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}
      />
      <Suspense>
        <CrispChatLoggedOutVisible />
      </Suspense>
    </>
  );
}
