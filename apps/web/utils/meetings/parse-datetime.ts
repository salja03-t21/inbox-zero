import { z } from "zod";
import { createGenerateObject } from "@/utils/llms";
import { createScopedLogger } from "@/utils/logger";
import { getModel } from "@/utils/llms/model";

const logger = createScopedLogger("meetings/parse-datetime");

const parsedDateTimeSchema = z.object({
  isoDateTime: z
    .string()
    .describe("The parsed date/time in ISO 8601 format with timezone"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Confidence in the parsing"),
  reasoning: z.string().describe("Explanation of how the date was interpreted"),
});

/**
 * Parse natural language date/time expressions into ISO 8601 format
 *
 * Examples:
 * - "tomorrow at 2pm" → "2025-11-08T14:00:00Z"
 * - "Nov 8 at 10am" → "2025-11-08T10:00:00Z"
 * - "next Tuesday at 3" → "2025-11-12T15:00:00Z"
 */
export async function parseNaturalLanguageDateTime({
  naturalLanguage,
  timezone,
  referenceTime,
}: {
  naturalLanguage: string;
  timezone: string;
  referenceTime: Date;
}): Promise<string> {
  logger.info("Parsing natural language date/time", {
    naturalLanguage,
    timezone,
    referenceTime: referenceTime.toISOString(),
  });

  const system = `You are an AI that parses natural language date/time expressions into ISO 8601 format.

Current time: ${referenceTime.toISOString()}
Timezone: ${timezone}

Your task:
1. Parse the natural language date/time
2. Convert it to ISO 8601 format with the specified timezone
3. Return your confidence level
4. Explain your reasoning

Guidelines:
- "tomorrow" means the next calendar day
- "next [day]" means the next occurrence of that weekday
- "the 8th" refers to the 8th of the current or next month (whichever is closer in the future)
- If no year is specified, assume the current year or next year if the date has passed
- If no time is specified, assume 12:00 PM (noon)
- If AM/PM is ambiguous, prefer PM for meeting times
- Use 24-hour format in ISO output`;

  const prompt = `Parse this date/time expression: "${naturalLanguage}"`;

  // Use economy model (gpt-4o-mini) for simple parsing tasks
  const { openai } = await import("@ai-sdk/openai");
  const modelOptions = getModel(
    {
      aiProvider: "openai",
      aiModel: "gpt-4o-mini",
      aiApiKey: null,
      aiBaseUrl: null,
    },
    "economy",
  );

  const generateObject = createGenerateObject({
    userEmail: "system",
    label: "Parse datetime",
    modelOptions,
  });

  const result = await generateObject({
    ...modelOptions,
    system,
    prompt,
    schema: parsedDateTimeSchema,
  });

  logger.info("Parsed date/time", {
    naturalLanguage,
    parsed: result.object.isoDateTime,
    confidence: result.object.confidence,
    reasoning: result.object.reasoning,
  });

  if (result.object.confidence === "low") {
    logger.warn("Low confidence in date/time parsing", {
      naturalLanguage,
      parsed: result.object.isoDateTime,
      reasoning: result.object.reasoning,
    });
  }

  return result.object.isoDateTime;
}
