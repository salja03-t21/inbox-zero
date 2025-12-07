import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { withError } from "@/utils/middleware";
import { handleBatchRequest } from "@/app/api/user/categorize/senders/batch/handle-batch";
import { INTERNAL_API_KEY_HEADER } from "@/utils/internal-api";
import { env } from "@/env";
import type { NextRequest } from "next/server";

export const maxDuration = 300;

export const POST = withError(async (request: NextRequest) => {
  // Check if this is an internal call (Inngest fallback mode)
  const internalKey = request.headers.get(INTERNAL_API_KEY_HEADER);
  if (internalKey === env.INTERNAL_API_KEY) {
    return handleBatchRequest(request);
  }

  // Otherwise, verify QStash signature
  return verifySignatureAppRouter(handleBatchRequest)(request);
});
