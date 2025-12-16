const fs = require('fs');

// Read the file
let content = fs.readFileSync('apps/web/utils/account.ts', 'utf8');

// Find and replace the redirectToEmailAccountPath function
const functionStart = content.indexOf('export async function redirectToEmailAccountPath');
const functionEnd = content.indexOf('\n}', content.indexOf('redirect(redirectUrl);')) + 2;

const newFunction = `export async function redirectToEmailAccountPath(path: \`/\${string}\`) {
  const session = await auth();
  const userId = session?.user.id;
  if (!userId) throw new Error("Not authenticated");

  // Get all email accounts with provider info
  const emailAccounts = await prisma.emailAccount.findMany({
    where: { userId },
    select: {
      id: true,
      email: true,
      accountId: true,
      account: { select: { provider: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (emailAccounts.length === 0) {
    redirect("/accounts");
  }

  // Check if user has any valid email provider (Google or Microsoft)
  const validProviderAccounts = emailAccounts.filter(
    (account) =>
      account.account?.provider === "google" ||
      account.account?.provider === "microsoft"
  );

  // If no valid email provider, redirect to accounts page
  if (validProviderAccounts.length === 0) {
    redirect("/accounts");
  }

  const lastEmailAccountId = await getLastEmailAccountFromCookie(userId);
  
  // Use last account if it's valid, otherwise use first valid provider account
  let emailAccountId = lastEmailAccountId;
  if (!emailAccountId || !validProviderAccounts.find(a => a.id === emailAccountId)) {
    emailAccountId = validProviderAccounts[0].id;
  }

  const redirectUrl = \`/\${emailAccountId}\${path}\`;

  redirect(redirectUrl);
}`;

content = content.substring(0, functionStart) + newFunction + content.substring(functionEnd);

// Write the file back
fs.writeFileSync('apps/web/utils/account.ts', content);
console.log('Updated redirectToEmailAccountPath function');
