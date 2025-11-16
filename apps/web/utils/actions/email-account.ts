"use server";

import { after } from "next/server";
import { actionClient } from "@/utils/actions/safe-action";
import prisma from "@/utils/prisma";
import { aiAnalyzePersona } from "@/utils/ai/knowledge/persona";
import { createEmailProvider } from "@/utils/email/provider";
import { getEmailAccountWithAiAndTokens } from "@/utils/user/get";
import { SafeError } from "@/utils/error";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import { z } from "zod";
import { updateContactRole } from "@inboxzero/loops";

export const updateEmailAccountRoleAction = actionClient
  .metadata({ name: "updateEmailAccountRole" })
  .schema(z.object({ role: z.string() }))
  .action(
    async ({
      ctx: { emailAccountId, userEmail, logger },
      parsedInput: { role },
    }) => {
      after(async () => {
        await updateContactRole({
          email: userEmail,
          role,
        }).catch((error) => {
          logger.error("Loops: Error updating role", { error });
        });
      });

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { role },
      });
    },
  );

export const analyzePersonaAction = actionClient
  .metadata({ name: "analyzePersona" })
  .action(async ({ ctx: { emailAccountId, provider } }) => {
    const existingPersona = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: { personaAnalysis: true },
    });

    if (existingPersona?.personaAnalysis) {
      return existingPersona.personaAnalysis;
    }

    const emailAccount = await getEmailAccountWithAiAndTokens({
      emailAccountId,
    });

    if (!emailAccount) {
      throw new SafeError("Email account not found");
    }

    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
    });

    const messagesResponse = await emailProvider.getMessagesWithPagination({
      maxResults: 200,
    });

    if (!messagesResponse.messages || messagesResponse.messages.length === 0) {
      throw new SafeError("No emails found for persona analysis");
    }

    const messages = messagesResponse.messages;

    const emails = messages.map((message) =>
      getEmailForLLM(message, { removeForwarded: true, maxLength: 2000 }),
    );

    const personaAnalysis = await aiAnalyzePersona({ emails, emailAccount });

    if (!personaAnalysis) {
      throw new SafeError("Failed to analyze persona");
    }

    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { personaAnalysis },
    });

    return personaAnalysis;
  });

const updateReferralSignatureSchema = z.object({ enabled: z.boolean() });

export const updateReferralSignatureAction = actionClient
  .metadata({ name: "updateReferralSignature" })
  .schema(updateReferralSignatureSchema)
  .action(
    async ({ ctx: { emailAccountId, logger }, parsedInput: { enabled } }) => {
      logger.info("Updating referral signature", { enabled });

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { includeReferralSignature: enabled },
      });
    },
  );

export const fetchSignaturesFromProviderAction = actionClient
  .metadata({ name: "fetchSignaturesFromProvider" })
  .action(async ({ ctx: { emailAccountId, provider } }) => {
    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
    });

    const signatures = await emailProvider.getSignatures();

    return { signatures };
  });

const connectSharedMailboxSchema = z.object({
  sharedMailboxEmail: z.string().email(),
  sharedMailboxName: z.string().optional(),
});

export const connectSharedMailboxAction = actionClient
  .metadata({ name: "connectSharedMailbox" })
  .schema(connectSharedMailboxSchema)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger },
      parsedInput: { sharedMailboxEmail, sharedMailboxName },
    }) => {
      logger.info("Connecting shared mailbox", {
        sharedMailboxEmail,
        emailAccountId,
      });

      // Check if this shared mailbox is already connected for this user
      const existingSharedMailbox = await prisma.emailAccount.findFirst({
        where: {
          userId,
          isSharedMailbox: true,
          sharedMailboxOwner: sharedMailboxEmail,
        },
      });

      if (existingSharedMailbox) {
        throw new SafeError(
          "This shared mailbox is already connected to your account",
        );
      }

      // Get the primary email account to copy the account credentials
      const primaryEmailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        include: { account: true },
      });

      if (!primaryEmailAccount) {
        throw new SafeError("Primary email account not found");
      }

      // Create a new EmailAccount entry for the shared mailbox
      // This shares the same Account (OAuth tokens) but represents a different mailbox
      const sharedMailbox = await prisma.emailAccount.create({
        data: {
          email: sharedMailboxEmail,
          name: sharedMailboxName || sharedMailboxEmail,
          userId,
          accountId: primaryEmailAccount.accountId,
          isSharedMailbox: true,
          sharedMailboxOwner: sharedMailboxEmail,
        },
      });

      logger.info("Shared mailbox connected successfully", {
        sharedMailboxId: sharedMailbox.id,
      });

      return { sharedMailboxId: sharedMailbox.id };
    },
  );

const disconnectSharedMailboxSchema = z.object({
  sharedMailboxId: z.string(),
});

export const disconnectSharedMailboxAction = actionClient
  .metadata({ name: "disconnectSharedMailbox" })
  .schema(disconnectSharedMailboxSchema)
  .action(
    async ({
      ctx: { userId, logger },
      parsedInput: { sharedMailboxId },
    }) => {
      logger.info("Disconnecting shared mailbox", {
        sharedMailboxId,
      });

      // Verify the shared mailbox belongs to the user and is actually a shared mailbox
      const sharedMailbox = await prisma.emailAccount.findFirst({
        where: {
          id: sharedMailboxId,
          userId,
          isSharedMailbox: true,
        },
      });

      if (!sharedMailbox) {
        throw new SafeError(
          "Shared mailbox not found or you don't have permission to disconnect it",
        );
      }

      // Delete the shared mailbox EmailAccount (this won't delete the Account/OAuth tokens)
      await prisma.emailAccount.delete({
        where: { id: sharedMailboxId },
      });

      logger.info("Shared mailbox disconnected successfully", {
        sharedMailboxId,
      });

      return { success: true };
    },
  );
