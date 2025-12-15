import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withEmailAccount } from "@/utils/middleware";
import type { KnowledgeExtractionJob } from "@prisma/client";

export type GetExtractionJobsResponse = {
  jobs: KnowledgeExtractionJob[];
};

export const GET = withEmailAccount(async (request) => {
  const emailAccountId = request.auth.emailAccountId;

  const jobs = await prisma.knowledgeExtractionJob.findMany({
    where: { emailAccountId },
    orderBy: { createdAt: "desc" },
    take: 10, // Limit to last 10 jobs
  });

  const result: GetExtractionJobsResponse = { jobs };

  return NextResponse.json(result);
});
