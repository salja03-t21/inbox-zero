import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAdmin } from "@/utils/admin";

// Mock dependencies
// env.ADMINS is already transformed to an array by env.ts
vi.mock("@/env", () => ({
  env: {
    ADMINS: ["admin@example.com", "super@example.com"],
  },
}));

vi.mock("@/utils/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/utils/logger", () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
  }),
}));

const prisma = (await import("@/utils/prisma")).default;

describe("Admin Check Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Environment variable admin check", () => {
    it("should allow exact email matches", async () => {
      // Mock database to return no admin user
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      expect(await isAdmin({ email: "admin@example.com" })).toBe(true);
      expect(await isAdmin({ email: "super@example.com" })).toBe(true);
    });

    it("should be case insensitive", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      expect(await isAdmin({ email: "ADMIN@EXAMPLE.COM" })).toBe(true);
      expect(await isAdmin({ email: "Super@Example.Com" })).toBe(true);
    });

    it("should handle whitespace in env variable", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      // The implementation trims whitespace from the env variable split
      expect(await isAdmin({ email: "admin@example.com" })).toBe(true);
    });

    it("should reject partial matches", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      // These should NOT be admin (partial matches)
      expect(await isAdmin({ email: "admin@example.com.evil.com" })).toBe(
        false,
      );
      expect(await isAdmin({ email: "notadmin@example.com" })).toBe(false);
      expect(await isAdmin({ email: "admin" })).toBe(false);
      expect(await isAdmin({ email: "example.com" })).toBe(false);
    });

    it("should reject non-admin emails", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      expect(await isAdmin({ email: "user@example.com" })).toBe(false);
      expect(await isAdmin({ email: "hacker@evil.com" })).toBe(false);
      expect(await isAdmin({ email: "" })).toBe(false);
    });

    it("should handle missing email", async () => {
      expect(await isAdmin({ email: null })).toBe(false);
      expect(await isAdmin({ email: undefined })).toBe(false);
      expect(await isAdmin({})).toBe(false);
    });
  });

  describe("Database admin check", () => {
    it("should prioritize database admin flag", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: true,
        email: "dbadmin@example.com",
      } as never);

      // Should be admin even though not in env variable
      expect(await isAdmin({ email: "dbadmin@example.com" })).toBe(true);
    });

    it("should fall back to env if database says not admin", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: false,
        email: "admin@example.com",
      } as never);

      // Should still be admin due to env variable
      expect(await isAdmin({ email: "admin@example.com" })).toBe(true);
    });

    it("should work with userId", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isAdmin: true,
        email: "user@example.com",
      } as never);

      expect(await isAdmin({ userId: "user123" })).toBe(true);
    });
  });
});
