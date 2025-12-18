import { describe, it, expect } from "vitest";
import { isValidWebhookUrl } from "@/utils/security/url";

describe("Webhook URL Validation", () => {
  describe("isValidWebhookUrl", () => {
    it("should allow valid HTTPS URLs", () => {
      expect(isValidWebhookUrl("https://api.example.com/webhook")).toBe(true);
      expect(isValidWebhookUrl("https://subdomain.example.com/path")).toBe(
        true,
      );
      expect(isValidWebhookUrl("https://example.com:8443/webhook")).toBe(true);
    });

    it("should block HTTP URLs", () => {
      expect(isValidWebhookUrl("http://api.example.com/webhook")).toBe(false);
      expect(isValidWebhookUrl("http://example.com/webhook")).toBe(false);
    });

    it("should block localhost variants", () => {
      expect(isValidWebhookUrl("https://localhost/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://127.0.0.1/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://[::1]/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://::1/webhook")).toBe(false);
    });

    it("should block private IP ranges", () => {
      // RFC 1918 private networks
      expect(isValidWebhookUrl("https://10.0.0.1/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://10.255.255.255/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://192.168.1.1/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://192.168.255.255/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://172.16.0.1/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://172.31.255.255/webhook")).toBe(false);
    });

    it("should block link-local addresses", () => {
      expect(isValidWebhookUrl("https://169.254.1.1/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://169.254.255.255/webhook")).toBe(false);
    });

    it("should block internal TLDs", () => {
      expect(isValidWebhookUrl("https://api.internal/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://service.local/webhook")).toBe(false);
      expect(isValidWebhookUrl("https://app.localhost/webhook")).toBe(false);
    });

    it("should handle invalid URLs", () => {
      expect(isValidWebhookUrl("not-a-url")).toBe(false);
      expect(isValidWebhookUrl("")).toBe(false);
      expect(isValidWebhookUrl("ftp://example.com")).toBe(false);
    });

    it("should allow edge cases for valid public URLs", () => {
      expect(isValidWebhookUrl("https://192.169.1.1/webhook")).toBe(true); // Not in 192.168.x.x
      expect(isValidWebhookUrl("https://172.15.1.1/webhook")).toBe(true); // Not in 172.16-31.x.x
      expect(isValidWebhookUrl("https://172.32.1.1/webhook")).toBe(true); // Not in 172.16-31.x.x
      expect(isValidWebhookUrl("https://11.0.0.1/webhook")).toBe(true); // Not in 10.x.x.x
    });
  });
});
