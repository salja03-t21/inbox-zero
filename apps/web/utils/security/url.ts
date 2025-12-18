/**
 * Validates webhook URLs to prevent SSRF attacks.
 * Blocks: private IPs, localhost, metadata endpoints, non-HTTPS
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Require HTTPS
    if (parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return false;
    }

    // Block private IP ranges (RFC 1918)
    if (
      hostname.match(/^10\./) ||
      hostname.match(/^192\.168\./) ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
      hostname.match(/^169\.254\./)
    ) {
      // Link-local / cloud metadata
      return false;
    }

    // Block internal/local TLDs
    if (
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
