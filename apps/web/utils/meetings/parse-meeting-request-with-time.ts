import { createScopedLogger } from "@/utils/logger";
import { aiParseMeetingRequest } from "@/utils/meetings/parse-meeting-request";
import prisma from "@/utils/prisma";
import type { EmailForLLM } from "@/utils/types";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import { parseNaturalLanguageDateTime } from "@/utils/meetings/parse-datetime";

const logger = createScopedLogger("meetings/parse-request-with-time");

export interface ParsedMeetingWithTime {
  title: string;
  startTime: string; // ISO 8601 datetime
  duration: number; // minutes
  timezone: string;
  attendees: string[];
  agenda: string | null;
  notes: string | null;
}

/**
 * Parse a meeting request with a confirmed date/time
 *
 * This function:
 * 1. Uses AI to parse the meeting details from the email thread
 * 2. Converts the agreed natural language date/time to ISO format
 * 3. Combines everything into a structured meeting object
 */
export async function parseMeetingRequest({
  emailAccountId,
  threadMessages,
  agreedDateTime,
  userEmail,
}: {
  emailAccountId: string;
  threadMessages: EmailForLLM[];
  agreedDateTime: string; // Natural language like "Nov 8 at 2pm"
  userEmail: string;
}): Promise<ParsedMeetingWithTime> {
  logger.info("Parsing meeting request with confirmed time", {
    emailAccountId,
    agreedDateTime,
    messageCount: threadMessages.length,
  });

  // Get email account with AI config
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

  // Get user's timezone from their primary calendar
  const calendarConnection = await prisma.calendarConnection.findFirst({
    where: {
      emailAccountId,
      isConnected: true,
    },
    select: {
      calendars: {
        where: {
          isEnabled: true,
          primary: true,
        },
        select: {
          timezone: true,
        },
        take: 1,
      },
    },
  });

  // Use calendar timezone if available, otherwise default to UTC
  const timezone =
    calendarConnection?.calendars[0]?.timezone || "America/New_York";

  // Use the most recent message for AI parsing
  const latestMessage = threadMessages[threadMessages.length - 1];
  if (!latestMessage) {
    throw new Error("No messages in thread");
  }

  // Parse meeting details using AI
  const meetingDetails = await aiParseMeetingRequest({
    email: latestMessage,
    emailAccount: {
      id: emailAccount.id,
      email: emailAccount.email,
      about: emailAccount.about,
      user: emailAccount.user,
      account: emailAccount.account,
      userId: emailAccount.userId,
      multiRuleSelectionEnabled: emailAccount.multiRuleSelectionEnabled,
    },
    userEmail,
  });

  logger.info("AI parsed meeting details", {
    title: meetingDetails.title,
    attendeesCount: meetingDetails.attendees.length,
    duration: meetingDetails.durationMinutes,
  });

  // Parse the natural language date/time to ISO format
  // Check if agreedDateTime is already in ISO format
  let startTime: string;
  const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;

  if (isoDateTimeRegex.test(agreedDateTime)) {
    // Already in ISO format, use directly
    logger.info("Date/time already in ISO format, skipping parsing", {
      isoFormat: agreedDateTime,
    });
    startTime = agreedDateTime;
  } else {
    // Parse natural language to ISO format
    startTime = await parseNaturalLanguageDateTime({
      naturalLanguage: agreedDateTime,
      timezone,
      referenceTime: new Date(),
      userAi: {
        aiProvider: emailAccount.user.aiProvider,
        aiModel: emailAccount.user.aiModel,
        aiApiKey: emailAccount.user.aiApiKey,
        aiBaseUrl: emailAccount.user.aiBaseUrl,
      },
    });

    logger.info("Parsed date/time", {
      naturalLanguage: agreedDateTime,
      isoFormat: startTime,
      timezone,
    });
  }

  return {
    title: meetingDetails.title,
    startTime,
    duration: meetingDetails.durationMinutes,
    timezone,
    attendees: meetingDetails.attendees,
    agenda: meetingDetails.agenda,
    notes: meetingDetails.notes,
  };
}
