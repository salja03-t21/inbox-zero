"use server";

import { revalidatePath } from "next/cache";
import {
  adminToggleRuleBody,
  adminDeleteRuleBody,
  adminDeleteEmailAccountBody,
  adminToggleEmailAccountBody,
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
    async ({
      parsedInput: { ruleId, emailAccountId, enabled, systemType },
    }) => {
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
        include: {
          account: {
            select: {
              provider: true,
            },
          },
        },
      });

      if (!emailAccount) {
        throw new SafeError("Email account not found");
      }

      const provider = await createEmailProvider({
        emailAccountId,
        provider: emailAccount.account.provider,
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
      include: {
        account: {
          select: {
            provider: true,
          },
        },
      },
    });

    if (!emailAccount) {
      throw new SafeError("Email account not found");
    }

    const _provider = await createEmailProvider({
      emailAccountId,
      provider: emailAccount.account.provider,
    });

    // Delete the rule
    await deleteRule({
      emailAccountId,
      ruleId,
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

export const adminDeleteEmailAccountAction = adminActionClient
  .metadata({ name: "adminDeleteEmailAccount" })
  .schema(adminDeleteEmailAccountBody)
  .action(async ({ parsedInput: { emailAccountId } }) => {
    // Verify the email account exists
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      include: {
        user: true,
        account: true,
      },
    });

    if (!emailAccount) {
      throw new SafeError("Email account not found");
    }

    // Delete the email account (cascading deletes will handle related records)
    await prisma.emailAccount.delete({
      where: { id: emailAccountId },
    });

    // Also delete the associated Account if this was the only EmailAccount using it
    const remainingEmailAccounts = await prisma.emailAccount.findFirst({
      where: { accountId: emailAccount.accountId },
    });

    if (!remainingEmailAccounts) {
      await prisma.account.delete({
        where: { id: emailAccount.accountId },
      });
    }

    revalidatePath(`/settings`);
    revalidatePath(`/accounts`);
  });

export const adminToggleEmailAccountAction = adminActionClient
  .metadata({ name: "adminToggleEmailAccount" })
  .schema(adminToggleEmailAccountBody)
  .action(async ({ parsedInput: { emailAccountId, enabled } }) => {
    // Verify the email account exists
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      include: { account: true },
    });

    if (!emailAccount) {
      throw new SafeError("Email account not found");
    }

    // Update the enabled status
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { enabled },
    });

    // If disabling, also clear the account's access tokens to prevent login
    if (!enabled) {
      await prisma.account.update({
        where: { id: emailAccount.accountId },
        data: {
          access_token: null,
          refresh_token: null,
          expires_at: null,
          refreshTokenExpiresAt: null,
        },
      });
    }

    revalidatePath(`/settings`);
  });
