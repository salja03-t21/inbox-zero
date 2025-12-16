"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingContent } from "@/components/LoadingContent";

export function SSORedirect() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to accounts page after a short delay
    const timer = setTimeout(() => {
      router.push("/accounts");
    }, 100);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <LoadingContent loading>
      <div className="text-center">
        <p>Redirecting to account setup...</p>
      </div>
    </LoadingContent>
  );
}
