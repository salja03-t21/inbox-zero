export function isGoogleProvider(provider: string | null | undefined) {
  return provider === "google";
}

export function isMicrosoftProvider(provider: string | null | undefined) {
  return provider === "microsoft";
}

/**
 * Check if a provider is a valid email provider (Google or Microsoft).
 * SSO providers (like Okta) are NOT valid email providers - they only provide
 * authentication, not email access.
 *
 * This is critical for filtering out SSO-created EmailAccount records that
 * don't have actual email provider capabilities.
 */
export function isValidEmailProvider(
  provider: string | null | undefined,
): boolean {
  return isGoogleProvider(provider) || isMicrosoftProvider(provider);
}
