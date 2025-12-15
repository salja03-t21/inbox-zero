import {
  addDays,
  addMinutes,
  startOfDay,
  endOfDay,
  isBefore,
  isAfter,
  parseISO,
} from "date-fns";
import { TZDate } from "@date-fns/tz";
import { createScopedLogger } from "@/utils/logger";
import { getUnifiedCalendarAvailability } from "@/utils/calendar/unified-availability";
import type { BusyPeriod } from "@/utils/calendar/availability-types";
import type { ParsedMeetingRequest } from "@/utils/meetings/parse-meeting-request";
import prisma from "@/utils/prisma";

const logger = createScopedLogger("meetings/find-availability");

/**
 * Get working hours from user settings with fallback defaults
 */
export async function getWorkingHours(emailAccountId: string): Promise<{
  start: number;
  end: number;
}> {
  const acct = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      meetingSchedulerWorkingHoursStart: true,
      meetingSchedulerWorkingHoursEnd: true,
    },
  });

  const start = acct?.meetingSchedulerWorkingHoursStart ?? 9;
  const end = acct?.meetingSchedulerWorkingHoursEnd ?? 17;

  // Validate and clamp working hours
  if (end <= start || start < 0 || start > 23 || end < 1 || end > 24) {
    logger.warn("Invalid working hours in settings, using defaults", {
      start,
      end,
    });
    return { start: 9, end: 17 };
  }

  return { start, end };
}

export interface AvailableTimeSlot {
  start: Date;
  end: Date;
  startISO: string;
  endISO: string;
}

export interface MeetingAvailability {
  requestedTimes: AvailableTimeSlot[];
  suggestedTimes: AvailableTimeSlot[];
  timezone: string;
  hasConflicts: boolean;
}

/**
 * Find available time slots for a meeting request
 *
 * Process:
 * 1. Get user's timezone from calendar
 * 2. Parse date/time preferences from meeting request
 * 3. Fetch busy periods from all calendars
 * 4. Check if requested times are available
 * 5. Suggest alternative times if requested times are busy
 */
export async function findMeetingAvailability({
  emailAccountId,
  meetingRequest,
}: {
  emailAccountId: string;
  meetingRequest: ParsedMeetingRequest;
}): Promise<MeetingAvailability> {
  logger.info("Finding meeting availability", {
    emailAccountId,
    datePreferences: meetingRequest.dateTimePreferences,
    duration: meetingRequest.durationMinutes,
  });

  // Get user's timezone from calendar connections
  const timezone = await getUserTimezone(emailAccountId);

  // Parse requested time slots from natural language preferences
  const requestedTimes = parseTimePreferences(
    meetingRequest.dateTimePreferences,
    meetingRequest.durationMinutes,
    timezone,
  );

  logger.trace("Parsed requested times", {
    count: requestedTimes.length,
    times: requestedTimes.map((t) => t.startISO),
  });

  // If no specific times requested, suggest times for the next 7 days
  if (requestedTimes.length === 0) {
    const workingHours = await getWorkingHours(emailAccountId);
    const suggestedTimes = await findSuggestedTimes({
      emailAccountId,
      durationMinutes: meetingRequest.durationMinutes,
      daysAhead: 7,
      timezone,
      workStartHour: workingHours.start,
      workEndHour: workingHours.end,
    });

    return {
      requestedTimes: [],
      suggestedTimes,
      timezone,
      hasConflicts: false,
    };
  }

  // Get busy periods for the date range covering all requested times
  const { startDate, endDate } = getDateRange(requestedTimes);
  const busyPeriods = await getUnifiedCalendarAvailability({
    emailAccountId,
    startDate,
    endDate,
    timezone,
  });

  logger.trace("Fetched busy periods", {
    count: busyPeriods.length,
  });

  // Check which requested times are available
  const availableRequestedTimes = requestedTimes.filter((slot) =>
    isTimeSlotAvailable(slot, busyPeriods),
  );

  const hasConflicts = availableRequestedTimes.length < requestedTimes.length;

  // If all requested times are busy, suggest alternative times
  let suggestedTimes: AvailableTimeSlot[] = [];
  if (hasConflicts) {
    const workingHours = await getWorkingHours(emailAccountId);
    suggestedTimes = await findSuggestedTimes({
      emailAccountId,
      durationMinutes: meetingRequest.durationMinutes,
      daysAhead: 7,
      timezone,
      preferredStartHour: getPreferredStartHour(requestedTimes),
      workStartHour: workingHours.start,
      workEndHour: workingHours.end,
    });
  }

  logger.info("Meeting availability found", {
    requestedCount: requestedTimes.length,
    availableCount: availableRequestedTimes.length,
    suggestedCount: suggestedTimes.length,
    hasConflicts,
  });

  return {
    requestedTimes: availableRequestedTimes,
    suggestedTimes,
    timezone,
    hasConflicts,
  };
}

/**
 * Find suggested available time slots
 * Now exported for use in AI calendar availability tool
 */
export async function findSuggestedTimes({
  emailAccountId,
  durationMinutes,
  daysAhead,
  timezone,
  preferredStartHour = 9, // Default to 9 AM
  maxSuggestions = 5,
  workStartHour = 9,
  workEndHour = 17,
}: {
  emailAccountId: string;
  durationMinutes: number;
  daysAhead: number;
  timezone: string;
  preferredStartHour?: number;
  maxSuggestions?: number;
  workStartHour?: number;
  workEndHour?: number;
}): Promise<AvailableTimeSlot[]> {
  const now = new Date();
  const startDate = startOfDay(now);
  const endDate = endOfDay(addDays(now, daysAhead));

  // Get busy periods
  const busyPeriods = await getUnifiedCalendarAvailability({
    emailAccountId,
    startDate,
    endDate,
    timezone,
  });

  const suggestions: AvailableTimeSlot[] = [];

  // Working hours are now passed in as parameters from user settings

  // Start checking from tomorrow
  let currentDay = addDays(startOfDay(now), 1);
  let daysChecked = 0;

  while (suggestions.length < maxSuggestions && daysChecked < daysAhead) {
    // Try slots at the preferred hour and nearby times
    const hoursToTry = [
      preferredStartHour,
      preferredStartHour + 1,
      preferredStartHour - 1,
      10,
      14,
      15,
    ].filter((h) => h >= workStartHour && h < workEndHour);

    for (const hour of hoursToTry) {
      if (suggestions.length >= maxSuggestions) break;

      const slotStart = new TZDate(currentDay, timezone);
      slotStart.setHours(hour, 0, 0, 0);

      const slot: AvailableTimeSlot = {
        start: slotStart,
        end: addMinutes(slotStart, durationMinutes),
        startISO: slotStart.toISOString(),
        endISO: addMinutes(slotStart, durationMinutes).toISOString(),
      };

      // Check if this slot is available and not a duplicate
      if (
        isTimeSlotAvailable(slot, busyPeriods) &&
        !suggestions.some((s) => s.startISO === slot.startISO)
      ) {
        suggestions.push(slot);
      }
    }

    currentDay = addDays(currentDay, 1);
    daysChecked++;
  }

  return suggestions;
}

/**
 * Check if a time slot is available (doesn't conflict with busy periods)
 */
function isTimeSlotAvailable(
  slot: AvailableTimeSlot,
  busyPeriods: BusyPeriod[],
): boolean {
  for (const busy of busyPeriods) {
    const busyStart = parseISO(busy.start);
    const busyEnd = parseISO(busy.end);

    // Check if there's any overlap
    const slotStart = slot.start;
    const slotEnd = slot.end;

    // Overlap if: slot starts before busy ends AND slot ends after busy starts
    if (isBefore(slotStart, busyEnd) && isAfter(slotEnd, busyStart)) {
      return false; // Conflict found
    }
  }

  return true; // No conflicts
}

/**
 * Parse natural language time preferences into time slots
 */
function parseTimePreferences(
  preferences: string[],
  durationMinutes: number,
  timezone: string,
): AvailableTimeSlot[] {
  const slots: AvailableTimeSlot[] = [];
  const _now = new Date();

  for (const pref of preferences) {
    try {
      // Try to parse common patterns
      const parsed = parseNaturalLanguageTime(pref, timezone);
      if (parsed) {
        const slot: AvailableTimeSlot = {
          start: parsed,
          end: addMinutes(parsed, durationMinutes),
          startISO: parsed.toISOString(),
          endISO: addMinutes(parsed, durationMinutes).toISOString(),
        };
        slots.push(slot);
      }
    } catch (error) {
      logger.warn("Failed to parse time preference", {
        preference: pref,
        error,
      });
    }
  }

  return slots;
}

/**
 * Parse natural language time expressions
 * Examples: "tomorrow at 2pm", "next Tuesday at 10am", "Jan 15 at 3pm"
 */
function parseNaturalLanguageTime(text: string, timezone: string): Date | null {
  const now = new Date();
  const lowerText = text.toLowerCase().trim();

  // Extract time (e.g., "2pm", "10:30am", "14:00")
  const timeMatch = lowerText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!timeMatch) return null;

  let hours = Number.parseInt(timeMatch[1]);
  const minutes = timeMatch[2] ? Number.parseInt(timeMatch[2]) : 0;
  const meridiem = timeMatch[3]?.toLowerCase();

  // Convert to 24-hour format
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  // Determine the date components (year, month, day)
  let year: number;
  let month: number;
  let day: number;

  if (lowerText.includes("tomorrow")) {
    const tomorrow = addDays(startOfDay(now), 1);
    year = tomorrow.getFullYear();
    month = tomorrow.getMonth();
    day = tomorrow.getDate();
  } else if (lowerText.includes("today")) {
    const today = startOfDay(now);
    year = today.getFullYear();
    month = today.getMonth();
    day = today.getDate();
  } else if (lowerText.includes("next week")) {
    const nextWeek = addDays(startOfDay(now), 7);
    year = nextWeek.getFullYear();
    month = nextWeek.getMonth();
    day = nextWeek.getDate();
  } else if (lowerText.includes("monday")) {
    const targetDate = getNextDayOfWeek(now, 1);
    year = targetDate.getFullYear();
    month = targetDate.getMonth();
    day = targetDate.getDate();
  } else if (lowerText.includes("tuesday")) {
    const targetDate = getNextDayOfWeek(now, 2);
    year = targetDate.getFullYear();
    month = targetDate.getMonth();
    day = targetDate.getDate();
  } else if (lowerText.includes("wednesday")) {
    const targetDate = getNextDayOfWeek(now, 3);
    year = targetDate.getFullYear();
    month = targetDate.getMonth();
    day = targetDate.getDate();
  } else if (lowerText.includes("thursday")) {
    const targetDate = getNextDayOfWeek(now, 4);
    year = targetDate.getFullYear();
    month = targetDate.getMonth();
    day = targetDate.getDate();
  } else if (lowerText.includes("friday")) {
    const targetDate = getNextDayOfWeek(now, 5);
    year = targetDate.getFullYear();
    month = targetDate.getMonth();
    day = targetDate.getDate();
  } else if (lowerText.includes("saturday")) {
    const targetDate = getNextDayOfWeek(now, 6);
    year = targetDate.getFullYear();
    month = targetDate.getMonth();
    day = targetDate.getDate();
  } else if (lowerText.includes("sunday")) {
    const targetDate = getNextDayOfWeek(now, 0);
    year = targetDate.getFullYear();
    month = targetDate.getMonth();
    day = targetDate.getDate();
  } else {
    // Try parsing as a date (e.g., "Jan 15", "January 15", "15 Jan")
    const dateMatch = lowerText.match(
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})/i,
    );
    if (dateMatch) {
      const monthStr = dateMatch[1];
      const dayNum = Number.parseInt(dateMatch[2]);
      const monthNames = [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ];
      const monthIndex = monthNames.findIndex((m) => monthStr.startsWith(m));
      if (monthIndex >= 0) {
        const targetDate = new Date(now.getFullYear(), monthIndex, dayNum);
        // If the date is in the past, assume next year
        if (isBefore(targetDate, now)) {
          year = now.getFullYear() + 1;
        } else {
          year = now.getFullYear();
        }
        month = monthIndex;
        day = dayNum;
      } else {
        return null;
      }
    } else {
      // Default to tomorrow if can't parse the date
      const tomorrow = addDays(startOfDay(now), 1);
      year = tomorrow.getFullYear();
      month = tomorrow.getMonth();
      day = tomorrow.getDate();
    }
  }

  // Create the final date with time in the specified timezone
  // Use TZDate constructor with year, month, day, hour, minute components
  // This ensures the date is created in the target timezone without conversion
  const result = new TZDate(year, month, day, hours, minutes, 0, 0, timezone);

  return result;
}

/**
 * Get the next occurrence of a day of the week
 */
function getNextDayOfWeek(from: Date, dayOfWeek: number): Date {
  const current = startOfDay(from);
  const currentDay = current.getDay();
  let daysToAdd = dayOfWeek - currentDay;

  if (daysToAdd <= 0) {
    daysToAdd += 7; // Next week
  }

  return addDays(current, daysToAdd);
}

/**
 * Get the date range covering all time slots
 */
function getDateRange(slots: AvailableTimeSlot[]): {
  startDate: Date;
  endDate: Date;
} {
  const dates = slots.flatMap((s) => [s.start, s.end]);
  return {
    startDate: new Date(Math.min(...dates.map((d) => d.getTime()))),
    endDate: new Date(Math.max(...dates.map((d) => d.getTime()))),
  };
}

/**
 * Extract preferred start hour from requested times
 */
function getPreferredStartHour(slots: AvailableTimeSlot[]): number {
  if (slots.length === 0) return 9; // Default to 9 AM

  const hours = slots.map((s) => s.start.getHours());
  const avgHour = Math.round(
    hours.reduce((sum, h) => sum + h, 0) / hours.length,
  );

  return avgHour;
}

/**
 * Get user's timezone from calendar connections
 */
async function getUserTimezone(emailAccountId: string): Promise<string> {
  const calendarConnections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId,
      isConnected: true,
    },
    include: {
      calendars: {
        where: { isEnabled: true },
        select: {
          timezone: true,
          primary: true,
        },
      },
    },
  });

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
