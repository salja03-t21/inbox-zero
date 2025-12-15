"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Header } from "@/app/(landing)/home/Header";
import { ErrorPage } from "@/components/ErrorPage";
import { useUser } from "@/hooks/useUser";
import { LoadingContent } from "@/components/LoadingContent";
import { Loading } from "@/components/Loading";
import { WELCOME_PATH } from "@/utils/config";

export default function LogInErrorPage() {
  const { data, isLoading, error } = useUser();
  const router = useRouter();

  // For some reason users are being sent to this page when logged in
  // This will redirect them out of this page to the app
  useEffect(() => {
    if (data?.id) {
      router.push(WELCOME_PATH);
    }
  }, [data, router]);

  if (isLoading) return <Loading />;
  // will redirect to welcome if user is logged in
  if (data?.id) return <Loading />;

  return (
    <div className="bg-white">
      <Header />
      <main className="isolate">
        <LoadingContent loading={isLoading} error={error}>
          <ErrorPage
            title="Error Logging In"
            description="Please try again. If this error persists, please email Support at itsupport@tiger21.com."
            button={
              <Button asChild>
                <Link href="/login">Log In</Link>
              </Button>
            }
          />
        </LoadingContent>
      </main>
    </div>
  );
}
