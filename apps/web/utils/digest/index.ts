import { createScopedLogger } from "@/utils/logger";
import { emailToContent } from "@/utils/mail";
import { enqueueJob } from "@/utils/queue";
import type { DigestBody } from "@/app/api/ai/digest/validation";
import type { ParsedMessage } from "@/utils/types";
import type { EmailForAction } from "@/utils/ai/types";

const logger = createScopedLogger("digest");

export async function enqueueDigestItem({
  email,
  emailAccountId,
  actionId,
  coldEmailId,
}: {
  email: ParsedMessage | EmailForAction;
  emailAccountId: string;
  actionId?: string;
  coldEmailId?: string;
}) {
  try {
    await enqueueJob<DigestBody>({
      name: "inbox-zero/ai.digest",
      queueName: "digest-item-summarize",
      concurrency: 3, // Allow up to 3 concurrent jobs from this queue
      data: {
        emailAccountId,
        actionId,
        coldEmailId,
        message: {
          id: email.id,
          threadId: email.threadId,
          from: email.headers.from,
          to: email.headers.to || "",
          subject: email.headers.subject,
          content: emailToContent(email),
        },
      },
    });
  } catch (error) {
    logger.error("Failed to enqueue digest item", {
      emailAccountId,
      error,
    });
  }
}
