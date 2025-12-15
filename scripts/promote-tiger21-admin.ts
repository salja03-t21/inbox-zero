#!/usr/bin/env tsx
/**
 * Promote james.salmon@tiger21.com to admin on their Premium account
 * Usage: tsx scripts/promote-tiger21-admin.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function promoteToAdmin() {
  const email = "james.salmon@tiger21.com";

  try {
    console.log(`Looking for user: ${email}`);

    // Find the user
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        premium: true,
      },
    });

    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log(`✓ Found user: ${user.id}`);

    if (!user.premiumId) {
      console.error(`❌ User does not have a premium account`);
      process.exit(1);
    }

    console.log(`✓ User has premium account: ${user.premiumId}`);

    // Check if already admin
    const premium = await prisma.premium.findUnique({
      where: { id: user.premiumId },
    });

    if (!premium) {
      console.error(`❌ Premium account not found: ${user.premiumId}`);
      process.exit(1);
    }

    if (premium.admins.includes(user.id)) {
      console.log(`✓ User is already an admin`);
      process.exit(0);
    }

    // Add user to admins array
    console.log(`Promoting user to admin...`);
    await prisma.premium.update({
      where: { id: user.premiumId },
      data: {
        admins: {
          push: user.id,
        },
      },
    });

    console.log(`✅ Successfully promoted ${email} to admin!`);
  } catch (error) {
    console.error(`❌ Error:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

promoteToAdmin();
