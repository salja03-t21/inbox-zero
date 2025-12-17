import { describe, it, expect, vi } from "vitest";

// Mock environment and dependencies before importing modules
vi.mock("@/env", () => ({
  env: {
    ALLOWED_EMAIL_DOMAINS: undefined,
    EMAIL_ENCRYPT_SECRET: "test-secret",
    EMAIL_ENCRYPT_SALT: "test-salt",
  },
}));

// Mock logger to avoid console output during tests
vi.mock("@/utils/logger", () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock prisma
vi.mock("@/utils/prisma", () => ({
  default: {},
}));

// Mock better-auth to avoid complex initialization
vi.mock("better-auth", () => ({
  betterAuth: () => ({
    $context: Promise.resolve({
      baseURL: "http://localhost:3000",
      options: { baseURL: "http://localhost:3000", basePath: "/api/auth" },
      trustedOrigins: [],
    }),
    api: {},
  }),
}));

// Mock better-auth plugins
vi.mock("@better-auth/sso", () => ({
  sso: () => ({}),
}));

// Mock next-js better-auth plugin
vi.mock("better-auth/next-js", () => ({
  nextCookies: () => ({}),
}));

import { isEmailDomainAllowed } from "@/utils/auth";

describe("Access Control - Domain Validation", () => {
  describe("isEmailDomainAllowed", () => {
    describe("when no allowed domains are configured", () => {
      it("should allow all domains", () => {
        expect(isEmailDomainAllowed("user@example.com", [])).toBe(true);
        expect(isEmailDomainAllowed("admin@company.org", [])).toBe(true);
        expect(isEmailDomainAllowed("test@test.net", [])).toBe(true);
      });

      it("should allow all domains when undefined", () => {
        expect(isEmailDomainAllowed("user@example.com", undefined)).toBe(true);
      });
    });

    describe("when allowed domains are configured", () => {
      const allowedDomains = ["company.com", "partner.org"];

      it("should allow emails from allowed domains", () => {
        expect(isEmailDomainAllowed("user@company.com", allowedDomains)).toBe(
          true,
        );
        expect(isEmailDomainAllowed("admin@partner.org", allowedDomains)).toBe(
          true,
        );
      });

      it("should reject emails from non-allowed domains", () => {
        expect(isEmailDomainAllowed("user@external.com", allowedDomains)).toBe(
          false,
        );
        expect(
          isEmailDomainAllowed("hacker@malicious.net", allowedDomains),
        ).toBe(false);
      });

      it("should be case-insensitive for email domain", () => {
        expect(isEmailDomainAllowed("User@COMPANY.COM", allowedDomains)).toBe(
          true,
        );
        expect(isEmailDomainAllowed("Admin@PARTNER.ORG", allowedDomains)).toBe(
          true,
        );
        expect(isEmailDomainAllowed("test@External.COM", allowedDomains)).toBe(
          false,
        );
      });

      it("should be case-insensitive for allowed domains configuration", () => {
        const mixedCaseDomains = ["Company.COM", "Partner.ORG"];
        expect(isEmailDomainAllowed("user@company.com", mixedCaseDomains)).toBe(
          true,
        );
        expect(
          isEmailDomainAllowed("admin@PARTNER.org", mixedCaseDomains),
        ).toBe(true);
      });

      it("should not allow subdomain matches", () => {
        expect(
          isEmailDomainAllowed("user@sub.company.com", allowedDomains),
        ).toBe(false);
        expect(
          isEmailDomainAllowed("admin@mail.partner.org", allowedDomains),
        ).toBe(false);
      });

      it("should not allow partial domain matches", () => {
        expect(isEmailDomainAllowed("user@mycompany.com", allowedDomains)).toBe(
          false,
        );
        expect(
          isEmailDomainAllowed("user@company.com.au", allowedDomains),
        ).toBe(false);
      });
    });

    describe("edge cases", () => {
      const allowedDomains = ["company.com"];

      it("should reject emails without @ symbol", () => {
        expect(isEmailDomainAllowed("notanemail", allowedDomains)).toBe(false);
      });

      it("should reject emails without domain", () => {
        expect(isEmailDomainAllowed("user@", allowedDomains)).toBe(false);
      });

      it("should reject empty email", () => {
        expect(isEmailDomainAllowed("", allowedDomains)).toBe(false);
      });

      it("should handle multiple @ symbols (take second part after split)", () => {
        // email.split("@")[1] gets the second part (index 1), not the last
        // For "user@test@company.com" -> ["user", "test", "company.com"] -> [1] = "test"
        // "test" is not in allowedDomains, so this returns false
        expect(
          isEmailDomainAllowed("user@test@company.com", allowedDomains),
        ).toBe(false);
      });

      it("should handle email with + in local part", () => {
        expect(
          isEmailDomainAllowed("user+test@company.com", allowedDomains),
        ).toBe(true);
      });

      it("should handle email with dots in local part", () => {
        expect(
          isEmailDomainAllowed("first.last@company.com", allowedDomains),
        ).toBe(true);
      });
    });

    describe("multiple allowed domains", () => {
      const allowedDomains = [
        "company.com",
        "partner.org",
        "subsidiary.net",
        "vendor.co.uk",
      ];

      it("should allow any of the configured domains", () => {
        expect(isEmailDomainAllowed("user@company.com", allowedDomains)).toBe(
          true,
        );
        expect(isEmailDomainAllowed("admin@partner.org", allowedDomains)).toBe(
          true,
        );
        expect(
          isEmailDomainAllowed("staff@subsidiary.net", allowedDomains),
        ).toBe(true);
        expect(isEmailDomainAllowed("sales@vendor.co.uk", allowedDomains)).toBe(
          true,
        );
      });

      it("should reject domains not in the list", () => {
        expect(isEmailDomainAllowed("user@other.com", allowedDomains)).toBe(
          false,
        );
        expect(isEmailDomainAllowed("admin@external.org", allowedDomains)).toBe(
          false,
        );
      });
    });

    describe("single allowed domain", () => {
      const allowedDomains = ["company.com"];

      it("should only allow the single configured domain", () => {
        expect(isEmailDomainAllowed("user@company.com", allowedDomains)).toBe(
          true,
        );
        expect(isEmailDomainAllowed("admin@company.com", allowedDomains)).toBe(
          true,
        );
      });

      it("should reject all other domains", () => {
        expect(isEmailDomainAllowed("user@other.com", allowedDomains)).toBe(
          false,
        );
        expect(isEmailDomainAllowed("user@partner.org", allowedDomains)).toBe(
          false,
        );
        expect(isEmailDomainAllowed("user@company.org", allowedDomains)).toBe(
          false,
        );
      });
    });

    describe("whitespace handling", () => {
      it("should handle trimmed domains in config", () => {
        const domainsWithSpaces = ["company.com ", " partner.org"];
        // Note: The actual implementation should trim domains when parsed from env
        // This test documents current behavior
        expect(
          isEmailDomainAllowed("user@company.com", domainsWithSpaces),
        ).toBe(false); // Will fail due to space
        expect(
          isEmailDomainAllowed("user@partner.org", domainsWithSpaces),
        ).toBe(false); // Will fail due to space
      });

      it("should handle email with whitespace (current behavior)", () => {
        const allowedDomains = ["company.com"];
        // Normal email works as expected
        expect(isEmailDomainAllowed("user@company.com", allowedDomains)).toBe(
          true,
        );
        // Note: The current implementation doesn't trim whitespace from emails.
        // It only validates the domain part (after @), so leading/trailing spaces
        // in the local part don't affect domain matching.
        // Trailing space after domain DOES cause rejection because
        // "company.com " !== "company.com"
        expect(isEmailDomainAllowed("user@company.com ", allowedDomains)).toBe(
          false,
        ); // Trailing space in domain part
        // Leading space before local part doesn't affect domain extraction
        expect(isEmailDomainAllowed(" user@company.com", allowedDomains)).toBe(
          true,
        ); // Space only in local part, domain still matches
      });
    });
  });
});
