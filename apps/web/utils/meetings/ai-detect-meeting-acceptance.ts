import { z } from "zod";
import { createScopedLogger } from "@/utils/logger";
import { createGenerateObject } from "@/utils/llms";
import { getModel } from "@/utils/llms/model";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { EmailForLLM } from "@/utils/types";

const logger = createScopedLogger("meetings/ai-detect-acceptance");

const meetingAcceptanceSchema = z.object({
  isMeetingAcceptance: z
    .boolean()
    .describe("True if this email accepts or confirms a meeting time"),
  agreedDateTime: z
    .string()
    .nullable()
    .describe(
      "The agreed meeting date/time if mentioned (format: natural language like 'Nov 8 at 2pm' or 'tomorrow at 10am')",
    ),
  duration: z
    .number()
    .nullable()
    .describe("Proposed meeting duration in minutes, if mentioned"),
  reasoning: z
    .string()
    .describe("Brief explanation of why this is or isn't a meeting acceptance"),
});

export type MeetingAcceptanceResult = z.infer<typeof meetingAcceptanceSchema>;

/**
 * Use AI to detect if an email thread indicates meeting acceptance/confirmation
 *
 * This detects patterns like:
 * - "Yes, let's meet on the 8th at 2pm"
 * - "2pm works for me"
 * - "I'm free tomorrow at 10"
 * - "Let's do Tuesday at 3"
 * - "That time works"
 */
export async function aiDetectMeetingAcceptance({
  emailAccount,
  threadMessages,
  userEmail,
}: {
  emailAccount: EmailAccountWithAI;
  threadMessages: EmailForLLM[];
  userEmail: string;
}): Promise<MeetingAcceptanceResult> {
  logger.info("Analyzing thread for meeting acceptance", {
    userEmail,
    messageCount: threadMessages.length,
  });

  const threadContent = threadMessages
    .map((msg, index) => {
      const sender = msg.from === userEmail ? "You" : msg.from;
      return `Message ${index + 1} from ${sender}:
Subject: ${msg.subject || ""}
${msg.content || ""}`;
    })
    .join("\n\n---\n\n");

  const system = `You are an AI assistant that analyzes email threads to detect when someone has accepted or confirmed a meeting time.

Your task:
1. Read the email thread carefully
2. Determine if the MOST RECENT message contains acceptance/confirmation of a meeting time
3. Extract the agreed date/time if mentioned

IMPORTANT: Messages are numbered chronologically with Message 1 being the NEWEST (most recent) message.

Patterns that indicate meeting acceptance:
- "Yes, let's meet on [date/time]"
- "[time] works for me"
- "I'm free [date/time]"
- "Let's do [date/time]"
- "That time works"
- "See you on [date]"
- Direct confirmation of previously suggested times

DO NOT match:
- Initial meeting requests (asking if someone is free)
- Messages that only discuss availability without committing
- Questions about scheduling

IMPORTANT: Focus on Message 1 (the newest message) to see if it's accepting a previously proposed time.`;

  const prompt = `<current_time>
${new Date().toISOString()}
</current_time>

<thread>
${threadContent}
</thread>

Analyze this thread and determine if the most recent message accepts/confirms a meeting.`;

  const modelOptions = getModel(emailAccount.user);

  const generateObject = createGenerateObject({
    userEmail: emailAccount.email,
    label: "Meeting acceptance detection",
    modelOptions,
  });

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: meetingAcceptanceSchema,
    });

    logger.info("Meeting acceptance detection result", {
      isMeetingAcceptance: result.object.isMeetingAcceptance,
      agreedDateTime: result.object.agreedDateTime,
      reasoning: result.object.reasoning,
    });

    return result.object;
  } catch (error) {
    logger.error("Failed to detect meeting acceptance", { error });
    return {
      isMeetingAcceptance: false,
      agreedDateTime: null,
      duration: null,
      reasoning: "Error during AI analysis",
    };
  }
}
