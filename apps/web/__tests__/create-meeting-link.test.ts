import { describe, expect, test, vi, beforeEach } from "vitest";

// Run with: pnpm test create-meeting-link

// Mock dependencies
vi.mock("@/utils/logger", () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/utils/prisma", () => ({
  default: {
    emailAccount: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/utils/meetings/providers/teams", () => ({
  createTeamsMeeting: vi.fn(),
}));

vi.mock("@/utils/meetings/providers/google-meet", () => ({
  createGoogleMeetConferenceData: vi.fn(),
}));

// Import after mocks
import { createMeetingLink } from "@/utils/meetings/create-meeting-link";

describe("Create Meeting Link", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("Google accounts", () => {
    beforeEach(async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: {
          provider: "google",
        },
      } as any);
    });

    test("creates Google Meet link when requested", async () => {
      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/abc-defg-hij",
        conferenceData: {
          conferenceSolution: {
            name: "Google Meet",
            key: { type: "hangoutsMeet" },
          },
          createRequest: { requestId: "test-request-id" },
        },
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "google-meet",
      });

      expect(result.provider).toBe("google-meet");
      expect(result.joinUrl).toContain("meet.google.com");
      expect(createGoogleMeetConferenceData).toHaveBeenCalledWith({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: expect.any(Date),
        endDateTime: "2024-03-20T11:00:00Z",
      });
    });

    test("creates Google Meet by default (no provider specified)", async () => {
      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/xyz-uvw-rst",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: null,
      });

      expect(result.provider).toBe("google-meet");
      expect(createGoogleMeetConferenceData).toHaveBeenCalled();
    });

    test("falls back to Google Meet when Teams is requested", async () => {
      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/fallback",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "teams",
      });

      expect(result.provider).toBe("google-meet");
      expect(createGoogleMeetConferenceData).toHaveBeenCalled();
    });

    test("falls back to Google Meet when Zoom is requested", async () => {
      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/zoom-fallback",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "zoom",
      });

      expect(result.provider).toBe("google-meet");
      expect(createGoogleMeetConferenceData).toHaveBeenCalled();
    });

    test('returns no link when "none" is requested', async () => {
      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "none",
      });

      expect(result.provider).toBe("none");
      expect(result.joinUrl).toBe("");
      expect(result.conferenceData).toBeNull();
    });
  });

  describe("Microsoft accounts", () => {
    beforeEach(async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: {
          provider: "microsoft",
        },
      } as any);
    });

    test("creates Teams meeting when requested", async () => {
      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );
      createTeamsMeeting.mockResolvedValue({
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/l/meetup/abc123",
        conferenceData: {
          id: "teams-meeting-id",
          joinWebUrl: "https://teams.microsoft.com/l/meetup/abc123",
        },
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "teams",
      });

      expect(result.provider).toBe("teams");
      expect(result.joinUrl).toContain("teams.microsoft.com");
      expect(createTeamsMeeting).toHaveBeenCalledWith({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: expect.any(Date),
        endDateTime: "2024-03-20T11:00:00Z",
      });
    });

    test("creates Teams meeting by default (no provider specified)", async () => {
      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );
      createTeamsMeeting.mockResolvedValue({
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/l/meetup/default",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: null,
      });

      expect(result.provider).toBe("teams");
      expect(createTeamsMeeting).toHaveBeenCalled();
    });

    test("falls back to Teams when Google Meet is requested", async () => {
      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );
      createTeamsMeeting.mockResolvedValue({
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/l/meetup/fallback",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "google-meet",
      });

      expect(result.provider).toBe("teams");
      expect(createTeamsMeeting).toHaveBeenCalled();
    });

    test("falls back to Teams when Zoom is requested", async () => {
      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );
      createTeamsMeeting.mockResolvedValue({
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/l/meetup/zoom-fallback",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "zoom",
      });

      expect(result.provider).toBe("teams");
      expect(createTeamsMeeting).toHaveBeenCalled();
    });

    test('returns no link when "none" is requested', async () => {
      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "none",
      });

      expect(result.provider).toBe("none");
      expect(result.joinUrl).toBe("");
      expect(result.conferenceData).toBeNull();
    });
  });

  describe("Error handling", () => {
    test("throws error when email account not found", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue(null);

      await expect(
        createMeetingLink({
          emailAccountId: "nonexistent-id",
          subject: "Test Meeting",
          startDateTime: new Date("2024-03-20T10:00:00Z"),
          endDateTime: "2024-03-20T11:00:00Z",
          preferredProvider: null,
        }),
      ).rejects.toThrow("Email account not found");
    });

    test("falls back to Teams for unknown provider types", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: {
          provider: "unknown-provider", // Will be treated as Microsoft
        },
      } as any);

      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );
      vi.mocked(createTeamsMeeting).mockResolvedValue({
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/l/meetup/test-meeting-id",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: null,
      });

      // Unknown providers fall back to Teams (Microsoft behavior)
      expect(result.provider).toBe("teams");
      expect(createTeamsMeeting).toHaveBeenCalled();
    });
  });

  describe("Provider compatibility", () => {
    test("Google account: Google Meet is compatible", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "google" },
      } as any);

      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/compatible",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date(),
        endDateTime: new Date().toISOString(),
        preferredProvider: "google-meet",
      });

      expect(result.provider).toBe("google-meet");
      expect(createGoogleMeetConferenceData).toHaveBeenCalled();
    });

    test("Microsoft account: Teams is compatible", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "microsoft" },
      } as any);

      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );
      createTeamsMeeting.mockResolvedValue({
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/compatible",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date(),
        endDateTime: new Date().toISOString(),
        preferredProvider: "teams",
      });

      expect(result.provider).toBe("teams");
      expect(createTeamsMeeting).toHaveBeenCalled();
    });

    test("Google account: Teams is not compatible, falls back", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "google" },
      } as any);

      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );

      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/fallback",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date(),
        endDateTime: new Date().toISOString(),
        preferredProvider: "teams",
      });

      expect(result.provider).toBe("google-meet");
      expect(createGoogleMeetConferenceData).toHaveBeenCalled();
      expect(createTeamsMeeting).not.toHaveBeenCalled();
    });

    test("Microsoft account: Google Meet is not compatible, falls back", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "microsoft" },
      } as any);

      const { createTeamsMeeting } = await import(
        "@/utils/meetings/providers/teams"
      );
      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );

      createTeamsMeeting.mockResolvedValue({
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/fallback",
        conferenceData: null,
      });

      const result = await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: new Date(),
        endDateTime: new Date().toISOString(),
        preferredProvider: "google-meet",
      });

      expect(result.provider).toBe("teams");
      expect(createTeamsMeeting).toHaveBeenCalled();
      expect(createGoogleMeetConferenceData).not.toHaveBeenCalled();
    });
  });

  describe("Meeting details", () => {
    test("passes subject correctly", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "google" },
      } as any);

      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/test",
        conferenceData: null,
      });

      await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Important Client Meeting",
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        preferredProvider: "google-meet",
      });

      expect(createGoogleMeetConferenceData).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Important Client Meeting",
        }),
      );
    });

    test("passes datetime correctly", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "google" },
      } as any);

      const { createGoogleMeetConferenceData } = await import(
        "@/utils/meetings/providers/google-meet"
      );
      createGoogleMeetConferenceData.mockResolvedValue({
        provider: "google-meet",
        joinUrl: "https://meet.google.com/test",
        conferenceData: null,
      });

      const startTime = new Date("2024-03-20T10:00:00Z");
      const endTime = "2024-03-20T11:00:00Z";

      await createMeetingLink({
        emailAccountId: "email-account-id",
        subject: "Test Meeting",
        startDateTime: startTime,
        endDateTime: endTime,
        preferredProvider: "google-meet",
      });

      expect(createGoogleMeetConferenceData).toHaveBeenCalledWith(
        expect.objectContaining({
          startDateTime: startTime,
          endDateTime: endTime,
        }),
      );
    });
  });
});
