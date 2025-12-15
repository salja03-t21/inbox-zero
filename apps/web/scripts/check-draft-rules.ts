#!/usr/bin/env tsx
/**
 * Diagnostic script to check if DRAFT_EMAIL rules exist and are enabled
 * Run with: cd apps/web && pnpm tsx scripts/check-draft-rules.ts
 */

import { PrismaClient, ActionType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Checking for DRAFT_EMAIL rules...\n");

  // Find all rules with DRAFT_EMAIL actions
  const rulesWithDrafts = await prisma.rule.findMany({
    where: {
      actions: {
        some: {
          type: ActionType.DRAFT_EMAIL,
        },
      },
    },
    include: {
      actions: {
        where: {
          type: ActionType.DRAFT_EMAIL,
        },
      },
      emailAccount: {
        select: {
          email: true,
        },
      },
    },
  });

  console.log(
    `Found ${rulesWithDrafts.length} rules with DRAFT_EMAIL actions:\n`,
  );

  if (rulesWithDrafts.length === 0) {
    console.log("❌ No DRAFT_EMAIL rules found!");
    console.log("   This is likely why drafts aren't being created.");
    console.log(
      "\n💡 Solution: You need to create rules with DRAFT_EMAIL actions.",
    );
    console.log(
      "   Check the conversation tracking settings or create a custom rule.",
    );
  } else {
    rulesWithDrafts.forEach((rule, index) => {
      console.log(`${index + 1}. Rule: "${rule.name}"`);
      console.log(`   ID: ${rule.id}`);
      console.log(`   Enabled: ${rule.enabled ? "✅" : "❌"}`);
      console.log(`   System Type: ${rule.systemType || "custom"}`);
      console.log(`   Account: ${rule.emailAccount.email}`);
      console.log(
        `   Instructions: ${rule.instructions?.substring(0, 100)}...`,
      );
      console.log(`   Draft Actions: ${rule.actions.length}`);
      rule.actions.forEach((action) => {
        console.log(
          `     - ${action.type} (ID: ${action.id}, Label: ${action.label || "none"})`,
        );
      });
      console.log();
    });
  }

  // Check for conversation tracking meta rules
  console.log("\n🔍 Checking for conversation tracking rules...\n");

  const conversationRules = await prisma.rule.findMany({
    where: {
      systemType: {
        in: ["TO_REPLY", "AWAITING_REPLY", "FYI", "ACTIONED"] as any[],
      },
    },
    include: {
      actions: true,
      emailAccount: {
        select: {
          email: true,
        },
      },
    },
  });

  console.log(
    `Found ${conversationRules.length} conversation tracking rules:\n`,
  );

  if (conversationRules.length === 0) {
    console.log("❌ No conversation tracking rules found!");
    console.log("   These are required for automatic draft generation.");
  } else {
    conversationRules.forEach((rule, index) => {
      console.log(`${index + 1}. ${rule.systemType}`);
      console.log(`   Name: "${rule.name}"`);
      console.log(`   Enabled: ${rule.enabled ? "✅" : "❌"}`);
      console.log(`   Account: ${rule.emailAccount.email}`);
      console.log(`   Actions: ${rule.actions.length}`);
      rule.actions.forEach((action) => {
        console.log(`     - ${action.type}`);
      });
      console.log();
    });
  }

  // Check executed rules to see if any have been processed recently
  console.log("\n🔍 Checking recent rule executions...\n");

  const recentExecutions = await prisma.executedRule.findMany({
    take: 5,
    orderBy: {
      createdAt: "desc",
    },
  });

  console.log(`Found ${recentExecutions.length} recent executions:\n`);

  for (const exec of recentExecutions) {
    console.log(`- ${exec.createdAt.toISOString()}`);
    console.log(`  Status: ${exec.status}`);
    console.log(`  Rule ID: ${exec.ruleId || "none (meta rule?)"}`);
    console.log(`  Thread ID: ${exec.threadId}`);
    console.log(`  Reason: ${exec.reason?.substring(0, 100)}...`);
    console.log();
  }
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
