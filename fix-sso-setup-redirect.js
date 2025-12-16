const fs = require('fs');

// Read the setup page
const setupPath = 'apps/web/app/(app)/[emailAccountId]/setup/page.tsx';
let content = fs.readFileSync(setupPath, 'utf8');

// Add a check at the beginning of the component to redirect SSO-only users
const importSection = content.match(/(import[\s\S]*?)\n\nexport/)[1];
const newImports = importSection + '\nimport { redirect } from "next/navigation";\nimport prisma from "@/utils/prisma";';

const functionStart = content.indexOf('export default async function SetupPage');
const functionBody = content.substring(functionStart);

const newFunction = `export default async function SetupPage({
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
  }` + functionBody.substring(functionBody.indexOf('{') + 1);

content = content.substring(0, content.indexOf(importSection)) + newImports + '\n\n' + newFunction;

// Write the updated file
fs.writeFileSync(setupPath, content);
console.log('Updated setup page to redirect SSO-only users');
