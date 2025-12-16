import { LoadStats } from "@/providers/StatLoaderProvider";
import { checkUserOwnsEmailAccount } from "@/utils/email-account";
import { SetupContent } from "./SetupContent";
import { redirect } from "next/navigation";
import prisma from "@/utils/prisma";

export default async function SetupPage({
  params,
}: {
  params: Promise<{ emailAccountId: string }>;
}) {
  const { emailAccountId } = await params;
  
  // Check if this email account has a valid email provider
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      account: {
        select: { provider: true }
      }
    }
  });
  
  if (!emailAccount) {
    redirect("/accounts");
  }
  
  const provider = emailAccount.account?.provider;
  if (provider !== "google" && provider !== "microsoft") {
    // This is an SSO-only account, redirect to accounts page
    redirect("/accounts");
  }
  
  await checkUserOwnsEmailAccount({ emailAccountId });

  return (
    <>
      <SetupContent />
      <LoadStats />
    </>
  );
}
