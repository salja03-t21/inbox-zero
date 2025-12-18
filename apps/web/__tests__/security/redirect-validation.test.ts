import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isValidRedirectUrl,
  getSafeRedirectUrl,
} from "@/utils/security/redirect";

// Mock the env module
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_BASE_URL: "https://example.com",
  },
}));

describe("Redirect URL Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isValidRedirectUrl", () => {
    it("should allow relative paths", () => {
      expect(isValidRedirectUrl("/dashboard")).toBe(true);
      expect(isValidRedirectUrl("/settings/profile")).toBe(true);
      expect(isValidRedirectUrl("/")).toBe(true);
    });

    it("should block protocol-relative URLs", () => {
      expect(isValidRedirectUrl("//evil.com")).toBe(false);
      expect(isValidRedirectUrl("//evil.com/path")).toBe(false);
    });

    it("should block javascript: URLs", () => {
      expect(isValidRedirectUrl("/javascript:alert(1)")).toBe(false);
      expect(isValidRedirectUrl("/JAVASCRIPT:alert(1)")).toBe(false);
      expect(isValidRedirectUrl("/path?redirect=javascript:alert(1)")).toBe(
        false,
      );
    });

    it("should allow same-origin absolute URLs", () => {
      expect(isValidRedirectUrl("https://example.com/dashboard")).toBe(true);
      expect(isValidRedirectUrl("https://example.com/")).toBe(true);
    });

    it("should block external URLs", () => {
      expect(isValidRedirectUrl("https://evil.com")).toBe(false);
      expect(isValidRedirectUrl("http://example.com")).toBe(false);
      expect(isValidRedirectUrl("https://subdomain.evil.com")).toBe(false);
    });

    it("should handle invalid URLs", () => {
      expect(isValidRedirectUrl("not-a-url")).toBe(false);
      expect(isValidRedirectUrl("")).toBe(false);
      expect(isValidRedirectUrl(undefined)).toBe(false);
    });

    it("should block data: and other dangerous protocols", () => {
      expect(
        isValidRedirectUrl("data:text/html,<script>alert(1)</script>"),
      ).toBe(false);
      expect(isValidRedirectUrl("javascript:alert(1)")).toBe(false);
      expect(isValidRedirectUrl("vbscript:alert(1)")).toBe(false);
    });
  });

  describe("getSafeRedirectUrl", () => {
    const fallback = "/welcome";

    it("should return valid URLs unchanged", () => {
      expect(getSafeRedirectUrl("/dashboard", fallback)).toBe("/dashboard");
      expect(getSafeRedirectUrl("https://example.com/settings", fallback)).toBe(
        "https://example.com/settings",
      );
    });

    it("should return fallback for invalid URLs", () => {
      expect(getSafeRedirectUrl("https://evil.com", fallback)).toBe(fallback);
      expect(getSafeRedirectUrl("//evil.com", fallback)).toBe(fallback);
      expect(getSafeRedirectUrl("javascript:alert(1)", fallback)).toBe(
        fallback,
      );
      expect(getSafeRedirectUrl(undefined, fallback)).toBe(fallback);
    });
  });
});
