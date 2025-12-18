import { env } from "@/env";

/**
 * Validates that a redirect URL is safe (same-origin only).
 * Prevents open redirect attacks.
 */
export function isValidRedirectUrl(url: string | undefined): boolean {
  if (!url) return false;

  // Allow relative paths (but not protocol-relative)
  if (url.startsWith("/") && !url.startsWith("//")) {
    // Block javascript: URLs disguised as paths
    if (url.toLowerCase().includes("javascript:")) return false;
    return true;
  }

  // Check for same-origin absolute URLs
  try {
    const parsed = new URL(url);
    const baseUrl = new URL(env.NEXT_PUBLIC_BASE_URL);
    return parsed.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Returns the redirect URL if valid, otherwise returns the fallback.
 */
export function getSafeRedirectUrl(
  url: string | undefined,
  fallback: string,
): string {
  return isValidRedirectUrl(url) ? url! : fallback;
}
