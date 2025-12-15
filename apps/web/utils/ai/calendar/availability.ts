import { z } from "zod";
import { tool } from "ai";
import { TZDate } from "@date-fns/tz";
import { createScopedLogger } from "@/utils/logger";
import { createGenerateText } from "@/utils/llms";
import { getModel } from "@/utils/llms/model";
import { getUnifiedCalendarAvailability } from "@/utils/calendar/unified-availability";
import {
  findSuggestedTimes,
  getWorkingHours,
} from "@/utils/meetings/find-availability";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { EmailForLLM } from "@/utils/types";
import prisma from "@/utils/prisma";
import { getUserInfoPrompt } from "@/utils/ai/helpers";

const logger = createScopedLogger("calendar-availability");

const schema = z.object({ suggestedTimes: z.array(z.string()) });
export type CalendarAvailabilityContext = z.infer<typeof schema>;

export async function aiGetCalendarAvailability({
  emailAccount,
  messages,
}: {
  emailAccount: EmailAccountWithAI;
  messages: EmailForLLM[];
}): Promise<CalendarAvailabilityContext | null> {
  if (!messages?.length) {
    logger.warn("No messages provided for calendar availability check");
    return null;
  }

  const threadContent = messages
    .map((msg, index) => {
      const content = `${msg.subject || ""} ${msg.content || ""}`.trim();
      return content ? `Message ${index + 1}: ${content}` : null;
    })
    .filter(Boolean)
    .join("\n\n");

  if (!threadContent) {
    logger.info("No content in thread messages, skipping calendar check");
    return null;
  }

  const calendarConnections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId: emailAccount.id,
      isConnected: true,
    },
    include: {
      calendars: {
        where: { isEnabled: true },
        select: {
          calendarId: true,
          timezone: true,
          primary: true,
        },
      },
    },
  });

  // Determine user's primary timezone from calendars
  const userTimezone = getUserTimezone(calendarConnections);

  // Get user's working hours from settings
  const { start: workStartHour, end: workEndHour } = await getWorkingHours(
    emailAccount.id,
  );

  logger.trace("Determined user context", {
    userTimezone,
    workStartHour,
    workEndHour,
  });

  const system = `You are an AI assistant that analyzes email threads to determine if they contain meeting or scheduling requests, and if yes, returns the suggested times for the meeting.

Your task is to:
1. Analyze the email thread to determine if it's related to scheduling a meeting, call, or appointment
2. If it is scheduling-related, use the suggestTimeSlots tool to get available times that respect the user's working hours
3. Return possible times for the meeting by calling "returnSuggestedTimes" with the suggested dates and times

If the email thread is not about scheduling, return isRelevant: false.

IMPORTANT CONSTRAINTS:
- User's timezone: ${userTimezone}
- User's working hours: ${workStartHour}:00–${workEndHour}:00
- ONLY suggest times within working hours
- Default meeting duration: 30 minutes (unless clearly specified)
- Prefer using suggestTimeSlots tool over manual calculation
- You can only call "returnSuggestedTimes" once
- Your suggested times should be in format "YYYY-MM-DD HH:MM"
- Another agent will draft the final email reply

TIMEZONE CONTEXT: When interpreting times mentioned in emails (like "6pm"), assume they refer to ${userTimezone} unless explicitly stated otherwise.`;

  const prompt = `${getUserInfoPrompt({ emailAccount })}
  
<current_time>
${new Date().toISOString()}
</current_time>

<thread>
${threadContent}
</thread>`.trim();

  const modelOptions = getModel(emailAccount.user);

  const generateText = createGenerateText({
    userEmail: emailAccount.email,
    label: "Calendar availability analysis",
    modelOptions,
  });

  // Helper to format Date to "YYYY-MM-DD HH:MM" in user's timezone
  const formatDateTime = (date: Date, timezone: string): string => {
    const tzDate = new TZDate(date, timezone);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${tzDate.getFullYear()}-${pad(tzDate.getMonth() + 1)}-${pad(tzDate.getDate())} ${pad(tzDate.getHours())}:${pad(tzDate.getMinutes())}`;
  };

  let result: CalendarAvailabilityContext["suggestedTimes"] | null = null;

  await generateText({
    ...modelOptions,
    system,
    prompt,
    stopWhen: (result) =>
      result.steps.some((step) =>
        step.toolCalls?.some(
          (call) =>
            call.toolName === "returnSuggestedTimes" ||
            call.toolName === "suggestTimeSlots",
        ),
      ) || result.steps.length > 5,
    tools: {
      checkCalendarAvailability: tool({
        description:
          "Check calendar availability across all connected calendars (Google and Microsoft) for meeting requests",
        inputSchema: z.object({
          timeMin: z
            .string()
            .describe("The minimum time to check availability for"),
          timeMax: z
            .string()
            .describe("The maximum time to check availability for"),
        }),
        execute: async ({ timeMin, timeMax }) => {
          const startDate = new Date(timeMin);
          const endDate = new Date(timeMax);

          try {
            const busyPeriods = await getUnifiedCalendarAvailability({
              emailAccountId: emailAccount.id,
              startDate,
              endDate,
              timezone: userTimezone,
            });

            logger.trace("Unified calendar availability data", {
              busyPeriods,
            });

            return { busyPeriods };
          } catch (error) {
            logger.error("Error checking calendar availability", { error });
            return { busyPeriods: [] };
          }
        },
      }),
      suggestTimeSlots: tool({
        description:
          "Compute available time slots within working hours using the user's calendars - PREFERRED over manual calculation",
        inputSchema: z.object({
          daysAhead: z
            .number()
            .min(1)
            .max(30)
            .default(7)
            .optional()
            .describe("Number of days ahead to search for slots"),
          durationMinutes: z
            .number()
            .min(15)
            .max(180)
            .default(30)
            .optional()
            .describe("Meeting duration in minutes"),
          maxSuggestions: z
            .number()
            .min(1)
            .max(10)
            .default(5)
            .optional()
            .describe("Maximum number of time slots to suggest"),
          preferredStartHour: z
            .number()
            .min(0)
            .max(23)
            .optional()
            .describe("Preferred starting hour (0-23) if mentioned in email"),
        }),
        execute: async ({
          daysAhead = 7,
          durationMinutes = 30,
          maxSuggestions = 5,
          preferredStartHour,
        }) => {
          try {
            const slots = await findSuggestedTimes({
              emailAccountId: emailAccount.id,
              durationMinutes,
              daysAhead,
              timezone: userTimezone,
              preferredStartHour: preferredStartHour ?? workStartHour,
              maxSuggestions,
              workStartHour,
              workEndHour,
            });

            const suggestedTimes = slots.map((slot) =>
              formatDateTime(slot.start, userTimezone),
            );

            logger.info("Generated time slot suggestions", {
              count: suggestedTimes.length,
              workingHours: `${workStartHour}:00-${workEndHour}:00`,
              timezone: userTimezone,
              suggestions: suggestedTimes,
            });

            // Set result directly - this tool should be preferred
            result = suggestedTimes;

            return { suggestedTimes };
          } catch (error) {
            logger.error("Error generating time slot suggestions", { error });
            return { suggestedTimes: [] };
          }
        },
      }),
      returnSuggestedTimes: tool({
        description: "Return suggested times for a meeting",
        inputSchema: schema,
        execute: async ({ suggestedTimes }) => {
          result = suggestedTimes;
        },
      }),
    },
  });

  return result ? { suggestedTimes: result } : null;
}

function getUserTimezone(
  calendarConnections: Array<{
    calendars: Array<{
      calendarId: string;
      timezone: string | null;
      primary: boolean;
    }>;
  }>,
): string {
  // First, try to find the primary calendar's timezone
  for (const connection of calendarConnections) {
    const primaryCalendar = connection.calendars.find((cal) => cal.primary);
    if (primaryCalendar?.timezone) {
      return primaryCalendar.timezone;
    }
  }

  // If no primary calendar found, find any calendar with a timezone
  for (const connection of calendarConnections) {
    for (const calendar of connection.calendars) {
      if (calendar.timezone) {
        return calendar.timezone;
      }
    }
  }

  // Fallback to UTC if no timezone information is available
  return "UTC";
}
