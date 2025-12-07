import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withEmailAccount } from "@/utils/middleware";

export type GetKnowledgeSettingsResponse = {
  knowledgeExtractionEnabled: boolean;
  knowledgeAutoApprove: boolean;
  lastKnowledgeExtractionAt: Date | null;
};

export const GET = withEmailAccount(async (request) => {
  const emailAccountId = request.auth.emailAccountId;

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      knowledgeExtractionEnabled: true,
      knowledgeAutoApprove: true,
      lastKnowledgeExtractionAt: true,
    },
  });

  if (!emailAccount) {
    return NextResponse.json({ error: "Email account not found" }, { status: 404 });
  }

  const result: GetKnowledgeSettingsResponse = {
    knowledgeExtractionEnabled: emailAccount.knowledgeExtractionEnabled,
    knowledgeAutoApprove: emailAccount.knowledgeAutoApprove,
    lastKnowledgeExtractionAt: emailAccount.lastKnowledgeExtractionAt,
  };

  return NextResponse.json(result);
});
