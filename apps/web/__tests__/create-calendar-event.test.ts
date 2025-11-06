import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ParsedMeetingRequest } from "@/utils/meetings/parse-meeting-request";
import type { MeetingLinkResult } from "@/utils/meetings/providers/types";

// Run with: pnpm test create-calendar-event

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
    calendarConnection: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/utils/calendar/client", () => ({
  getCalendarClientWithRefresh: vi.fn(),
}));

vi.mock("@/utils/outlook/calendar-client", () => ({
  getCalendarClientWithRefresh: vi.fn(),
}));

// Import after mocks
import { createCalendarEvent } from "@/utils/meetings/create-calendar-event";

describe("Create Calendar Event", () => {
  const mockMeetingDetails: ParsedMeetingRequest = {
    title: "Team Sync",
    attendees: ["alice@example.com", "bob@example.com"],
    dateTimePreferences: [],
    durationMinutes: 60,
    preferredProvider: null,
    location: null,
    agenda: null,
    notes: null,
    isUrgent: false,
  };

  const mockMeetingLink: MeetingLinkResult = {
    provider: "google-meet",
    joinUrl: "https://meet.google.com/abc-defg-hij",
    conferenceData: {
      conferenceSolution: {
        name: "Google Meet",
        key: { type: "hangoutsMeet" },
      },
      createRequest: { requestId: "test-request-id" },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("Google Calendar", () => {
    beforeEach(async () => {
      const prisma = (await import("@/utils/prisma")).default;

      // Mock email account
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: {
          provider: "google",
        },
      } as any);

      // Mock calendar connection
      prisma.calendarConnection.findFirst.mockResolvedValue({
        id: "calendar-connection-id",
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        expiresAt: new Date(Date.now() + 3_600_000),
        calendars: [
          {
            calendarId: "primary",
          },
        ],
      } as any);

      // Mock Google Calendar client
      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockCalendarClient = {
        events: {
          insert: vi.fn().mockResolvedValue({
            data: {
              id: "google-event-id",
              htmlLink: "https://calendar.google.com/event?eid=abc123",
            },
          }),
        },
      };
      getCalendarClientWithRefresh.mockResolvedValue(mockCalendarClient as any);
    });

    test("creates event with basic details", async () => {
      const startDateTime = new Date("2024-03-20T10:00:00Z");
      const endDateTime = "2024-03-20T11:00:00Z";

      const result = await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: mockMeetingDetails,
        startDateTime,
        endDateTime,
        meetingLink: mockMeetingLink,
        timezone: "UTC",
      });

      expect(result.eventId).toBe("google-event-id");
      expect(result.eventUrl).toContain("calendar.google.com");
      expect(result.provider).toBe("google");

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);

      expect(mockClient.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: "primary",
          requestBody: expect.objectContaining({
            summary: "Team Sync",
            start: {
              dateTime: startDateTime.toISOString(),
              timeZone: "UTC",
            },
            end: {
              dateTime: endDateTime,
              timeZone: "UTC",
            },
            attendees: [
              { email: "alice@example.com", responseStatus: "needsAction" },
              { email: "bob@example.com", responseStatus: "needsAction" },
            ],
          }),
          sendUpdates: "all",
        }),
      );
    });

    test("includes conference data for Google Meet", async () => {
      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: mockMeetingDetails,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: mockMeetingLink,
        timezone: "UTC",
      });

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);

      expect(mockClient.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            conferenceData: mockMeetingLink.conferenceData,
          }),
          conferenceDataVersion: 1,
        }),
      );
    });

    test("includes agenda and notes in description", async () => {
      const detailsWithAgendaAndNotes: ParsedMeetingRequest = {
        ...mockMeetingDetails,
        agenda: "1. Review Q1 goals\n2. Discuss blockers",
        notes: "Please bring your project updates",
      };

      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: detailsWithAgendaAndNotes,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: mockMeetingLink,
        timezone: "UTC",
      });

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);

      const insertCall = mockClient.events.insert.mock.calls[0][0];
      const description = insertCall.requestBody.description;

      expect(description).toContain("Review Q1 goals");
      expect(description).toContain("Please bring your project updates");
      expect(description).toContain("https://meet.google.com");
    });

    test("includes location when specified", async () => {
      const detailsWithLocation: ParsedMeetingRequest = {
        ...mockMeetingDetails,
        location: "Conference Room A",
      };

      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: detailsWithLocation,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: mockMeetingLink,
        timezone: "UTC",
      });

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);

      expect(mockClient.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            location: "Conference Room A",
          }),
        }),
      );
    });

    test("handles timezone correctly", async () => {
      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: mockMeetingDetails,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: mockMeetingLink,
        timezone: "America/New_York",
      });

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);

      expect(mockClient.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            start: expect.objectContaining({
              timeZone: "America/New_York",
            }),
            end: expect.objectContaining({
              timeZone: "America/New_York",
            }),
          }),
        }),
      );
    });

    test("refreshes tokens when needed", async () => {
      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);

      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: mockMeetingDetails,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: mockMeetingLink,
        timezone: "UTC",
      });

      expect(getCalendarClientWithRefresh).toHaveBeenCalledWith({
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        expiresAt: expect.any(Number),
        emailAccountId: "email-account-id",
      });
    });
  });

  describe("Microsoft Calendar", () => {
    beforeEach(async () => {
      const prisma = (await import("@/utils/prisma")).default;

      // Mock email account
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: {
          provider: "microsoft",
        },
      } as any);

      // Mock calendar connection
      prisma.calendarConnection.findFirst.mockResolvedValue({
        id: "calendar-connection-id",
        accessToken: "microsoft-access-token",
        refreshToken: "microsoft-refresh-token",
        expiresAt: new Date(Date.now() + 3_600_000),
        calendars: [
          {
            calendarId: "primary",
          },
        ],
      } as any);

      // Mock Outlook Calendar client
      const { getCalendarClientWithRefresh } = await import(
        "@/utils/outlook/calendar-client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockCalendarClient = {
        api: vi.fn().mockReturnValue({
          post: vi.fn().mockResolvedValue({
            id: "outlook-event-id",
            webLink: "https://outlook.office365.com/calendar/item/abc123",
          }),
        }),
      };
      getCalendarClientWithRefresh.mockResolvedValue(mockCalendarClient as any);
    });

    const teamsMeetingLink: MeetingLinkResult = {
      provider: "teams",
      joinUrl: "https://teams.microsoft.com/l/meetup/abc123",
      conferenceData: {
        id: "teams-meeting-id",
        joinWebUrl: "https://teams.microsoft.com/l/meetup/abc123",
      },
    };

    test("creates event with basic details", async () => {
      const startDateTime = new Date("2024-03-20T10:00:00Z");
      const endDateTime = "2024-03-20T11:00:00Z";

      const result = await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: mockMeetingDetails,
        startDateTime,
        endDateTime,
        meetingLink: teamsMeetingLink,
        timezone: "UTC",
      });

      expect(result.eventId).toBe("outlook-event-id");
      expect(result.eventUrl).toContain("outlook.office365.com");
      expect(result.provider).toBe("microsoft");

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/outlook/calendar-client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);
      const mockApi = mockClient.api("/me/events");

      expect(mockApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Team Sync",
          start: {
            dateTime: startDateTime.toISOString(),
            timeZone: "UTC",
          },
          end: {
            dateTime: endDateTime,
            timeZone: "UTC",
          },
          attendees: [
            {
              emailAddress: { address: "alice@example.com" },
              type: "required",
            },
            {
              emailAddress: { address: "bob@example.com" },
              type: "required",
            },
          ],
        }),
      );
    });

    test("includes Teams meeting data", async () => {
      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: mockMeetingDetails,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: teamsMeetingLink,
        timezone: "UTC",
      });

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/outlook/calendar-client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);
      const mockApi = mockClient.api("/me/events");

      expect(mockApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          isOnlineMeeting: true,
          onlineMeetingProvider: "teamsForBusiness",
          onlineMeeting: {
            joinUrl: "https://teams.microsoft.com/l/meetup/abc123",
          },
        }),
      );
    });

    test("includes agenda and notes in body", async () => {
      const detailsWithAgendaAndNotes: ParsedMeetingRequest = {
        ...mockMeetingDetails,
        agenda: "1. Review Q1 goals\n2. Discuss blockers",
        notes: "Please bring your project updates",
      };

      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: detailsWithAgendaAndNotes,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: teamsMeetingLink,
        timezone: "UTC",
      });

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/outlook/calendar-client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);
      const mockApi = mockClient.api("/me/events");

      const postCall = mockApi.post.mock.calls[0][0];
      const bodyContent = postCall.body.content;

      expect(bodyContent).toContain("Review Q1 goals");
      expect(bodyContent).toContain("Please bring your project updates");
      expect(bodyContent).toContain("https://teams.microsoft.com");
    });

    test("includes location when specified", async () => {
      const detailsWithLocation: ParsedMeetingRequest = {
        ...mockMeetingDetails,
        location: "Conference Room B",
      };

      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: detailsWithLocation,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: teamsMeetingLink,
        timezone: "UTC",
      });

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/outlook/calendar-client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);
      const mockApi = mockClient.api("/me/events");

      expect(mockApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          location: {
            displayName: "Conference Room B",
          },
        }),
      );
    });

    test("uses correct endpoint for non-primary calendar", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.calendarConnection.findFirst.mockResolvedValue({
        id: "calendar-connection-id",
        accessToken: "microsoft-access-token",
        refreshToken: "microsoft-refresh-token",
        expiresAt: new Date(Date.now() + 3_600_000),
        calendars: [
          {
            calendarId: "custom-calendar-id",
          },
        ],
      } as any);

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/outlook/calendar-client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = await getCalendarClientWithRefresh(null as any);

      await createCalendarEvent({
        emailAccountId: "email-account-id",
        meetingDetails: mockMeetingDetails,
        startDateTime: new Date("2024-03-20T10:00:00Z"),
        endDateTime: "2024-03-20T11:00:00Z",
        meetingLink: teamsMeetingLink,
        timezone: "UTC",
      });

      expect(mockClient.api).toHaveBeenCalledWith(
        "/me/calendars/custom-calendar-id/events",
      );
    });
  });

  describe("Error handling", () => {
    test("throws error when email account not found", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue(null);

      await expect(
        createCalendarEvent({
          emailAccountId: "nonexistent-id",
          meetingDetails: mockMeetingDetails,
          startDateTime: new Date("2024-03-20T10:00:00Z"),
          endDateTime: "2024-03-20T11:00:00Z",
          meetingLink: mockMeetingLink,
          timezone: "UTC",
        }),
      ).rejects.toThrow("Email account not found");
    });

    test("throws error when calendar connection not found", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "google" },
      } as any);
      prisma.calendarConnection.findFirst.mockResolvedValue(null);

      await expect(
        createCalendarEvent({
          emailAccountId: "email-account-id",
          meetingDetails: mockMeetingDetails,
          startDateTime: new Date("2024-03-20T10:00:00Z"),
          endDateTime: "2024-03-20T11:00:00Z",
          meetingLink: mockMeetingLink,
          timezone: "UTC",
        }),
      ).rejects.toThrow("No connected Google calendar found");
    });

    test("throws error when tokens are missing", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "google" },
      } as any);
      prisma.calendarConnection.findFirst.mockResolvedValue({
        id: "calendar-connection-id",
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        calendars: [],
      } as any);

      await expect(
        createCalendarEvent({
          emailAccountId: "email-account-id",
          meetingDetails: mockMeetingDetails,
          startDateTime: new Date("2024-03-20T10:00:00Z"),
          endDateTime: "2024-03-20T11:00:00Z",
          meetingLink: mockMeetingLink,
          timezone: "UTC",
        }),
      ).rejects.toThrow("Missing calendar authentication tokens");
    });

    test("handles Google Calendar API errors", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "google" },
      } as any);
      prisma.calendarConnection.findFirst.mockResolvedValue({
        id: "calendar-connection-id",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: new Date(),
        calendars: [{ calendarId: "primary" }],
      } as any);

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/calendar/client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = {
        events: {
          insert: vi.fn().mockRejectedValue(new Error("Calendar API error")),
        },
      };
      getCalendarClientWithRefresh.mockResolvedValue(mockClient as any);

      await expect(
        createCalendarEvent({
          emailAccountId: "email-account-id",
          meetingDetails: mockMeetingDetails,
          startDateTime: new Date("2024-03-20T10:00:00Z"),
          endDateTime: "2024-03-20T11:00:00Z",
          meetingLink: mockMeetingLink,
          timezone: "UTC",
        }),
      ).rejects.toThrow("Failed to create calendar event");
    });

    test("handles Microsoft Calendar API errors", async () => {
      const prisma = (await import("@/utils/prisma")).default;
      prisma.emailAccount.findUnique.mockResolvedValue({
        id: "email-account-id",
        account: { provider: "microsoft" },
      } as any);
      prisma.calendarConnection.findFirst.mockResolvedValue({
        id: "calendar-connection-id",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: new Date(),
        calendars: [{ calendarId: "primary" }],
      } as any);

      const { getCalendarClientWithRefresh } = await import(
        "@/utils/outlook/calendar-client"
      );
      vi.mocked(getCalendarClientWithRefresh);
      const mockClient = {
        api: vi.fn().mockReturnValue({
          post: vi.fn().mockRejectedValue(new Error("Outlook API error")),
        }),
      };
      getCalendarClientWithRefresh.mockResolvedValue(mockClient as any);

      await expect(
        createCalendarEvent({
          emailAccountId: "email-account-id",
          meetingDetails: mockMeetingDetails,
          startDateTime: new Date("2024-03-20T10:00:00Z"),
          endDateTime: "2024-03-20T11:00:00Z",
          meetingLink: {
            provider: "teams",
            joinUrl: "https://teams.microsoft.com/abc",
            conferenceData: null,
          },
          timezone: "UTC",
        }),
      ).rejects.toThrow("Failed to create calendar event");
    });
  });
});
