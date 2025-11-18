"use server";

import { revalidatePath } from "next/cache";
import {
  adminToggleRuleBody,
  adminDeleteRuleBody,
} from "@/utils/actions/admin-rule.validation";
import prisma from "@/utils/prisma";
import { actionClientUser } from "@/utils/actions/safe-action";
import { isOrganizationAdmin } from "@/utils/organizations/roles";
import { SafeError } from "@/utils/error";
import { deleteRule } from "@/utils/rule/rule";
import { createEmailProvider } from "@/utils/email/provider";
import type { SystemType } from "@prisma/client";

// Custom action client that verifies admin permissions
const adminActionClient = actionClientUser.use(async ({ next, ctx }) => {
  const { userId } = ctx;

  // Get the requesting user with their organization memberships
  const requestingUser = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      emailAccounts: {
        include: {
          members: true,
        },
      },
    },
  });

  if (!requestingUser) {
    throw new SafeError("User not found");
  }

  // Check if user is an admin in any organization
  const isAdmin = requestingUser.emailAccounts.some((account) =>
    isOrganizationAdmin(account.members),
  );

  if (!isAdmin) {
    throw new SafeError("Unauthorized: Admin access required");
  }

  return next({ ctx: { ...ctx, isAdmin } });
});

export const adminToggleRuleAction = adminActionClient
  .metadata({ name: "adminToggleRule" })
  .inputSchema(adminToggleRuleBody)
  .action(
    async ({ parsedInput: { ruleId, emailAccountId, enabled, systemType } }) => {
      // Verify the rule belongs to the specified email account
      const rule = await prisma.rule.findFirst({
        where: {
          id: ruleId,
          emailAccountId,
        },
      });

      if (!rule) {
        throw new SafeError("Rule not found or access denied");
      }

      // Get email account for provider
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
      });

      if (!emailAccount) {
        throw new SafeError("Email account not found");
      }

      const provider = await createEmailProvider({
        emailAccountId,
        emailAccountEmail: emailAccount.email,
      });

      // Update the rule
      await toggleRule({
        ruleId,
        systemType,
        enabled,
        emailAccountId,
        provider,
      });

      revalidatePath(`/settings`);
    },
  );

export const adminDeleteRuleAction = adminActionClient
  .metadata({ name: "adminDeleteRule" })
  .inputSchema(adminDeleteRuleBody)
  .action(async ({ parsedInput: { ruleId, emailAccountId } }) => {
    // Verify the rule belongs to the specified email account
    const rule = await prisma.rule.findFirst({
      where: {
        id: ruleId,
        emailAccountId,
      },
    });

    if (!rule) {
      throw new SafeError("Rule not found or access denied");
    }

    // Get email account for provider
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
    });

    if (!emailAccount) {
      throw new SafeError("Email account not found");
    }

    const provider = await createEmailProvider({
      emailAccountId,
      emailAccountEmail: emailAccount.email,
    });

    // Delete the rule
    await deleteRule({
      emailAccountId,
      id: ruleId,
      provider,
    });

    revalidatePath(`/settings`);
  });

// Helper function to toggle rule (similar to the one in rule.ts)
async function toggleRule({
  ruleId,
  systemType,
  enabled,
  emailAccountId,
  provider,
}: {
  ruleId: string;
  systemType?: SystemType;
  enabled: boolean;
  emailAccountId: string;
  provider: Awaited<ReturnType<typeof createEmailProvider>>;
}) {
  const rule = await prisma.rule.findUnique({
    where: { id: ruleId, emailAccountId },
    include: { actions: true },
  });

  if (!rule) {
    throw new SafeError("Rule not found");
  }

  await prisma.rule.update({
    where: { id: ruleId, emailAccountId },
    data: { enabled },
  });
}
