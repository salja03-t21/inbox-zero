import { createScopedLogger } from "@/utils/logger";
import { aiDetectMeetingAcceptance } from "@/utils/meetings/ai-detect-meeting-acceptance";
import { parseMeetingRequest } from "@/utils/meetings/parse-meeting-request-with-time";
import { createMeetingLink } from "@/utils/meetings/create-meeting-link";
import { createCalendarEvent } from "@/utils/meetings/create-calendar-event";
import prisma from "@/utils/prisma";
import type { EmailProvider } from "@/utils/email/types";
import type { ExecutedRule } from "@prisma/client";
import type { EmailForAction } from "@/utils/ai/types";

const logger = createScopedLogger("ai-actions/create-meeting");

export interface CreateMeetingArgs {
  id?: string;
  // Optional: Override meeting duration in minutes
  duration?: number | null;
  // Optional: Override meeting title
  title?: string | null;
  // Action fields (not used but required for type compatibility)
  label?: string | null;
  subject?: string | null;
  content?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  url?: string | null;
  folderName?: string | null;
  folderId?: string | null;
  delayInMinutes?: number | null;
}

/**
 * CREATE_MEETING action handler
 *
 * This action:
 * 1. Uses AI to detect if the email thread contains meeting acceptance/confirmation
 * 2. Parses the agreed meeting details (time, attendees, agenda, etc.)
 * 3. Creates a meeting link (Teams/Google Meet/Zoom based on user preference)
 * 4. Creates a calendar event with the meeting link
 * 5. Sends calendar invitations to attendees
 *
 * This works for patterns like:
 * - "Yes, let's meet on the 8th at 2pm"
 * - "2pm works for me"
 * - "Let's do Tuesday at 3"
 */
export async function createMeetingAction({
  client,
  email,
  args,
  userEmail,
  userId: _userId,
  emailAccountId,
  executedRule: _executedRule,
}: {
  client: EmailProvider;
  email: EmailForAction;
  args: CreateMeetingArgs;
  userEmail: string;
  userId: string;
  emailAccountId: string;
  executedRule: ExecutedRule;
}): Promise<{ eventId?: string; eventUrl?: string }> {
  logger.info("Starting CREATE_MEETING action", {
    userEmail,
    threadId: email.threadId,
    messageId: email.id,
  });

  // Get email account with user and account info for AI
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    include: {
      user: {
        select: {
          aiProvider: true,
          aiModel: true,
          aiApiKey: true,
          aiBaseUrl: true,
        },
      },
      account: {
        select: {
          provider: true,
        },
      },
    },
  });

  if (!emailAccount) {
    throw new Error("Email account not found");
  }

  // Get the thread messages for AI analysis
  const threadMessages = await client.getThreadMessages(email.threadId);

  // Step 1: Use AI to detect if this is a meeting acceptance
  const acceptanceResult = await aiDetectMeetingAcceptance({
    emailAccount: {
      id: emailAccount.id,
      email: emailAccount.email,
      about: emailAccount.about,
      user: emailAccount.user,
      account: emailAccount.account,
      userId: emailAccount.userId,
      multiRuleSelectionEnabled: emailAccount.multiRuleSelectionEnabled,
    },
    threadMessages: threadMessages.map((msg) => ({
      id: msg.id,
      from: msg.headers.from,
      to: msg.headers.to || "",
      subject: msg.headers.subject,
      content: msg.textPlain || msg.textHtml || "",
      date: new Date(msg.headers.date),
    })),
    userEmail,
  });

  logger.info("Meeting acceptance detection result", {
    isMeetingAcceptance: acceptanceResult.isMeetingAcceptance,
    agreedDateTime: acceptanceResult.agreedDateTime,
    reasoning: acceptanceResult.reasoning,
  });

  if (!acceptanceResult.isMeetingAcceptance) {
    logger.info("Not a meeting acceptance, skipping meeting creation");
    return {};
  }

  if (!acceptanceResult.agreedDateTime) {
    logger.warn("Meeting acceptance detected but no date/time specified");
    return {};
  }

  // Step 2: Parse the meeting details
  const meetingDetails = await parseMeetingRequest({
    emailAccountId,
    threadMessages: threadMessages.map((msg) => ({
      id: msg.id,
      from: msg.headers.from,
      to: msg.headers.to || "",
      subject: msg.headers.subject,
      content: msg.textPlain || msg.textHtml || "",
      date: new Date(msg.headers.date),
    })),
    agreedDateTime: acceptanceResult.agreedDateTime,
    userEmail,
  });

  logger.info("Parsed meeting details", {
    title: meetingDetails.title,
    startTime: meetingDetails.startTime,
    attendeesCount: meetingDetails.attendees.length,
  });

  // Apply overrides from action args
  if (args.duration) {
    meetingDetails.duration = args.duration;
  }
  if (args.title) {
    meetingDetails.title = args.title;
  }

  // Calculate end time
  const startDateTime = new Date(meetingDetails.startTime);
  const endDateTime = new Date(
    startDateTime.getTime() + meetingDetails.duration * 60_000,
  );

  // Step 3: Create meeting link
  const meetingLink = await createMeetingLink({
    emailAccountId,
    subject: meetingDetails.title,
    startDateTime,
    endDateTime: endDateTime.toISOString(),
  });

  logger.info("Created meeting link", {
    provider: meetingLink.provider,
    hasJoinUrl: !!meetingLink.joinUrl,
  });

  // Step 4: Create calendar event
  // Convert our ParsedMeetingWithTime to ParsedMeetingRequest format
  const calendarEvent = await createCalendarEvent({
    emailAccountId,
    meetingDetails: {
      title: meetingDetails.title,
      location: null,
      attendees: meetingDetails.attendees,
      dateTimePreferences: [],
      durationMinutes: meetingDetails.duration,
      agenda: meetingDetails.agenda,
      preferredProvider: null,
      notes: meetingDetails.notes,
      isUrgent: false,
    },
    startDateTime,
    endDateTime: endDateTime.toISOString(),
    meetingLink,
    timezone: meetingDetails.timezone,
  });

  logger.info("Calendar event created successfully", {
    eventId: calendarEvent.eventId,
    provider: calendarEvent.provider,
    eventUrl: calendarEvent.eventUrl,
  });

  return {
    eventId: calendarEvent.eventId,
    eventUrl: calendarEvent.eventUrl,
  };
}
