import { runActionFunction } from "@/utils/ai/actions";
import prisma from "@/utils/prisma";
import type { Prisma } from "@prisma/client";
import { ExecutedRuleStatus, ActionType } from "@prisma/client";
import { createScopedLogger } from "@/utils/logger";
import type { ParsedMessage } from "@/utils/types";
import { updateExecutedActionWithDraftId } from "@/utils/ai/choose-rule/draft-management";
import type { EmailProvider } from "@/utils/email/types";

type ExecutedRuleWithActionItems = Prisma.ExecutedRuleGetPayload<{
  include: { actionItems: true };
}>;

export async function executeAct({
  client,
  executedRule,
  userEmail,
  userId,
  emailAccountId,
  message,
}: {
  client: EmailProvider;
  executedRule: ExecutedRuleWithActionItems;
  message: ParsedMessage;
  userEmail: string;
  userId: string;
  emailAccountId: string;
}) {
  const logger = createScopedLogger("ai-execute-act").with({
    email: userEmail,
    emailAccountId,
    executedRuleId: executedRule.id,
    ruleId: executedRule.ruleId,
    threadId: executedRule.threadId,
    messageId: executedRule.messageId,
  });

  logger.info("Starting action execution", {
    actionCount: executedRule.actionItems.length,
    actionTypes: executedRule.actionItems.map((a) => a.type),
    hasDraftAction: executedRule.actionItems.some(
      (a) => a.type === ActionType.DRAFT_EMAIL,
    ),
  });

  for (const action of executedRule.actionItems) {
    try {
      logger.info("Executing action", {
        actionId: action.id,
        actionType: action.type,
        hasContent: !!action.content,
        contentLength: action.content?.length,
      });

      const actionResult = await runActionFunction({
        client,
        email: message,
        action,
        userEmail,
        userId,
        emailAccountId,
        executedRule,
      });

      logger.info("Action executed successfully", {
        actionId: action.id,
        actionType: action.type,
        hasDraftId: !!actionResult?.draftId,
      });

      if (action.type === ActionType.DRAFT_EMAIL && actionResult?.draftId) {
        logger.info("Updating executed action with draft ID", {
          actionId: action.id,
          draftId: actionResult.draftId,
        });

        await updateExecutedActionWithDraftId({
          actionId: action.id,
          draftId: actionResult.draftId,
          logger,
        });
      }
    } catch (error) {
      logger.error("Error executing action", { error });
      await prisma.executedRule.update({
        where: { id: executedRule.id },
        data: { status: ExecutedRuleStatus.ERROR },
      });
      throw error;
    }
  }

  await prisma.executedRule
    .update({
      where: { id: executedRule.id },
      data: { status: ExecutedRuleStatus.APPLIED },
    })
    .catch((error) => {
      logger.error("Failed to update executed rule", { error });
    });
}
