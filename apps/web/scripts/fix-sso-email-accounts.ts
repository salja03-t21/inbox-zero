/**
 * Fix Mislinked EmailAccounts Script
 *
 * This script detects and fixes EmailAccount records that are incorrectly
 * linked to SSO provider accounts instead of email provider accounts.
 *
 * The Problem:
 * When users log in via SSO (e.g., Okta), the system was incorrectly creating
 * EmailAccount records linked to the SSO Account. SSO accounts don't provide
 * email access (read/send), so these EmailAccounts are unusable.
 *
 * The Fix:
 * 1. Find all EmailAccounts linked to SSO providers
 * 2. For each one, check if the user has a valid email provider account (Google/Microsoft)
 * 3. If yes, re-link the EmailAccount to the valid email provider account
 * 4. If no, log a warning (user needs to add an email account)
 *
 * Run with: `npx tsx scripts/fix-sso-email-accounts.ts`
 * Make sure to set DATABASE_URL environment variable
 *
 * Options:
 *   --dry-run    Preview changes without applying them (default)
 *   --apply      Actually apply the fixes
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// SSO provider patterns - these providers are for authentication only, not email access
const SSO_PROVIDER_PATTERNS = ["okta", "sso", "saml", "auth0", "keycloak"];

// Valid email providers - these providers give actual email access
const VALID_EMAIL_PROVIDERS = ["google", "microsoft"];

function isSSOProvider(provider: string): boolean {
  return SSO_PROVIDER_PATTERNS.some((pattern) =>
    provider.toLowerCase().includes(pattern),
  );
}

// Note: We use VALID_EMAIL_PROVIDERS array directly in queries instead of this function

interface MislinkedEmailAccount {
  emailAccountId: string;
  emailAccountEmail: string;
  userId: string;
  currentAccountId: string;
  currentProvider: string;
  correctAccountId: string | null;
  correctProvider: string | null;
}

async function findMislinkedEmailAccounts(): Promise<MislinkedEmailAccount[]> {
  console.log("\n=== Scanning for Mislinked EmailAccounts ===\n");

  // Find all EmailAccounts and their linked Account providers
  const emailAccounts = await prisma.emailAccount.findMany({
    select: {
      id: true,
      email: true,
      userId: true,
      accountId: true,
      account: {
        select: {
          id: true,
          provider: true,
        },
      },
    },
  });

  const mislinked: MislinkedEmailAccount[] = [];

  for (const ea of emailAccounts) {
    const currentProvider = ea.account?.provider || "unknown";

    // Check if currently linked to an SSO provider
    if (isSSOProvider(currentProvider)) {
      console.log(`Found SSO-linked EmailAccount: ${ea.email}`);
      console.log(`  Current provider: ${currentProvider}`);

      // Look for a valid email provider account for this user
      const validAccounts = await prisma.account.findMany({
        where: {
          userId: ea.userId,
          provider: {
            in: VALID_EMAIL_PROVIDERS,
          },
        },
        select: {
          id: true,
          provider: true,
        },
      });

      if (validAccounts.length > 0) {
        // Prefer Microsoft for this user's email domain, else use first valid
        const preferredAccount =
          validAccounts.find((a) => a.provider === "microsoft") ||
          validAccounts[0];

        console.log(
          `  Found valid email provider: ${preferredAccount.provider}`,
        );

        mislinked.push({
          emailAccountId: ea.id,
          emailAccountEmail: ea.email,
          userId: ea.userId,
          currentAccountId: ea.accountId,
          currentProvider,
          correctAccountId: preferredAccount.id,
          correctProvider: preferredAccount.provider,
        });
      } else {
        console.log(`  WARNING: No valid email provider found for this user`);
        console.log(`  User needs to link a Google or Microsoft account`);

        mislinked.push({
          emailAccountId: ea.id,
          emailAccountEmail: ea.email,
          userId: ea.userId,
          currentAccountId: ea.accountId,
          currentProvider,
          correctAccountId: null,
          correctProvider: null,
        });
      }
    }
  }

  return mislinked;
}

async function fixMislinkedEmailAccounts(
  mislinked: MislinkedEmailAccount[],
  dryRun: boolean,
): Promise<void> {
  console.log("\n=== Fixing Mislinked EmailAccounts ===\n");

  const fixable = mislinked.filter((m) => m.correctAccountId !== null);
  const unfixable = mislinked.filter((m) => m.correctAccountId === null);

  if (fixable.length === 0) {
    console.log("No fixable EmailAccounts found.");
    return;
  }

  console.log(`Found ${fixable.length} fixable EmailAccounts`);
  console.log(
    `Found ${unfixable.length} unfixable EmailAccounts (need user action)\n`,
  );

  for (const item of fixable) {
    console.log(`Fixing: ${item.emailAccountEmail}`);
    console.log(`  From: ${item.currentProvider} (${item.currentAccountId})`);
    console.log(`  To: ${item.correctProvider} (${item.correctAccountId})`);

    if (!dryRun) {
      await prisma.emailAccount.update({
        where: { id: item.emailAccountId },
        data: { accountId: item.correctAccountId! },
      });
      console.log(`  FIXED!`);
    } else {
      console.log(`  [DRY RUN - not applied]`);
    }
  }

  if (unfixable.length > 0) {
    console.log("\n=== EmailAccounts That Need User Action ===\n");
    for (const item of unfixable) {
      console.log(`${item.emailAccountEmail} (userId: ${item.userId})`);
      console.log(
        `  Currently linked to SSO provider: ${item.currentProvider}`,
      );
      console.log(`  User must link a Google or Microsoft account`);
    }
  }
}

async function deleteOrphanedSSOEmailAccounts(dryRun: boolean): Promise<void> {
  console.log("\n=== Checking for Orphaned SSO EmailAccounts ===\n");

  // Find EmailAccounts linked to SSO providers that have no valid alternative
  const orphanedEmailAccounts = await prisma.emailAccount.findMany({
    where: {
      account: {
        provider: {
          contains: "okta", // or other SSO patterns
        },
      },
    },
    select: {
      id: true,
      email: true,
      userId: true,
      account: {
        select: {
          provider: true,
        },
      },
    },
  });

  // For each, check if user has ANY valid email provider account
  for (const ea of orphanedEmailAccounts) {
    const validAccountCount = await prisma.account.count({
      where: {
        userId: ea.userId,
        provider: {
          in: VALID_EMAIL_PROVIDERS,
        },
      },
    });

    if (validAccountCount === 0) {
      console.log(`Orphaned SSO EmailAccount: ${ea.email}`);
      console.log(`  Provider: ${ea.account?.provider}`);
      console.log(`  User has no valid email provider accounts`);

      if (!dryRun) {
        // Option 1: Delete the orphaned EmailAccount
        // await prisma.emailAccount.delete({ where: { id: ea.id } });
        // console.log(`  DELETED (user can re-add after linking email provider)`);

        // Option 2: Just log it (safer)
        console.log(
          `  [Would delete, but leaving for safety - run with specific flag to delete]`,
        );
      } else {
        console.log(`  [DRY RUN - would consider deleting]`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--apply");

  console.log("=========================================");
  console.log("Fix SSO Email Accounts Script");
  console.log("=========================================");
  console.log(`Mode: ${dryRun ? "DRY RUN (preview only)" : "APPLYING FIXES"}`);
  console.log(`To apply fixes, run with: --apply`);

  try {
    // Step 1: Find mislinked EmailAccounts
    const mislinked = await findMislinkedEmailAccounts();

    if (mislinked.length === 0) {
      console.log("\nNo mislinked EmailAccounts found. All good!");
      return;
    }

    // Step 2: Fix what we can
    await fixMislinkedEmailAccounts(mislinked, dryRun);

    // Step 3: Report on orphaned accounts
    await deleteOrphanedSSOEmailAccounts(dryRun);

    console.log("\n=========================================");
    console.log("Summary");
    console.log("=========================================");
    console.log(`Total mislinked: ${mislinked.length}`);
    console.log(
      `Fixable: ${mislinked.filter((m) => m.correctAccountId).length}`,
    );
    console.log(
      `Need user action: ${mislinked.filter((m) => !m.correctAccountId).length}`,
    );

    if (dryRun) {
      console.log("\nThis was a dry run. To apply fixes, run with: --apply");
    }
  } catch (error) {
    console.error("Error running fix script:", error);
    throw error;
  }
}

main()
  .finally(() => {
    prisma.$disconnect();
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
