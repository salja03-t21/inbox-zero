import { redirect } from "next/navigation";
import prisma from "@/utils/prisma";
import { auth } from "@/utils/auth";

export default async function EmailAccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ emailAccountId: string }>;
}) {
  const { emailAccountId } = await params;
  const session = await auth();
  
  if (!session?.user?.id) {
    redirect("/login");
  }

  // Check if this email account has a valid email provider
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      userId: true,
      account: {
        select: { provider: true }
      }
    }
  });

  // If account doesn't exist or doesn't belong to this user, redirect to accounts
  if (!emailAccount || emailAccount.userId !== session.user.id) {
    redirect("/accounts");
  }

  const provider = emailAccount.account?.provider;
  
  // If not a valid email provider (Google/Microsoft), find a valid one or redirect to accounts
  if (provider !== "google" && provider !== "microsoft") {
    // Find a valid email account for this user
    const validAccount = await prisma.emailAccount.findFirst({
      where: {
        userId: session.user.id,
        account: {
          provider: { in: ["google", "microsoft"] }
        }
      },
      select: { id: true }
    });

    if (validAccount) {
      // Redirect to the same path but with valid account ID
      // Extract the path after the emailAccountId
      redirect(`/${validAccount.id}/automation`);
    } else {
      // No valid email account, redirect to accounts page to add one
      redirect("/accounts");
    }
  }

  return <>{children}</>;
}
