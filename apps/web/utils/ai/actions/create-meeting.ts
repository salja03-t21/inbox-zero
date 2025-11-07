import { createScopedLogger } from "@/utils/logger";
import { aiDetectMeetingAcceptance } from "@/utils/meetings/ai-detect-meeting-acceptance";
import { parseMeetingRequest } from "@/utils/meetings/parse-meeting-request-with-time";
import { createMeetingLink } from "@/utils/meetings/providers";
import { createCalendarEvent } from "@/utils/meetings/create-calendar-event";
import prisma from "@/utils/prisma";
import type { EmailProvider } from "@/utils/email/types";
import type { ExecutedRule } from "@prisma/client";
import type { EmailForAction } from "@/utils/ai/types";
import type { EmailAccountWithAI } from "@/utils/llms/types";

const logger = createScopedLogger("ai-actions/create-meeting");

export interface CreateMeetingArgs {
  // Optional: Override meeting duration in minutes
  duration?: number | null;
  // Optional: Override meeting title
  title?: string | null;
}

/**
 * CREATE_MEETING action handler
 *
 * This action:
 * 1. Uses AI to detect if the email thread contains meeting acceptance/confirmation
 * 2. Parses the agreed meeting details (time, attendees, etc.)
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
  userId,
  emailAccountId,
  executedRule,
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

  // Get email account with AI config
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    include: {
      user: {
        include: {
          aiProvider: true,
          aiModel: true,
        },
      },
      account: true,
    },
  });

  if (!emailAccount) {
    throw new Error("Email account not found");
  }

  // Get the thread messages for AI analysis
  const threadMessages = await client.getThreadMessages(email.threadId);

  // Step 1: Use AI to detect if this is a meeting acceptance
  const acceptanceResult = await aiDetectMeetingAcceptance({
    emailAccount: emailAccount as EmailAccountWithAI,
    threadMessages: threadMessages.map((msg) => ({
      from: msg.headers.from,
      to: msg.headers.to || "",
      subject: msg.headers.subject,
      content: msg.textPlain || msg.textHtml || "",
      date: msg.headers.date,
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
      from: msg.headers.from,
      to: msg.headers.to || "",
      subject: msg.headers.subject,
      content: msg.textPlain || msg.textHtml || "",
      date: msg.headers.date,
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
    title: meetingDetails.title,
    startTime: meetingDetails.startTime,
    endTime: endDateTime.toISOString(),
    attendees: meetingDetails.attendees,
  });

  logger.info("Created meeting link", {
    provider: meetingLink.provider,
    hasJoinUrl: !!meetingLink.joinUrl,
  });

  // Step 4: Create calendar event
  const calendarEvent = await createCalendarEvent({
    emailAccountId,
    meetingDetails,
    startDateTime,
    endDateTime: endDateTime.toISOString(),
    meetingLink,
    timezone: meetingDetails.timezone || "UTC",
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
