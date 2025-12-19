import { PremiumTier } from "@prisma/client";
import prisma from "@/utils/prisma";

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export async function createPremiumForUser({ userId }: { userId: string }) {
  return await prisma.premium.create({
    data: {
      users: { connect: { id: userId } },
      admins: { connect: { id: userId } },
      // All users get lifetime premium access
      tier: PremiumTier.LIFETIME,
      lemonSqueezyRenewsAt: new Date(Date.now() + TEN_YEARS_MS),
      emailAccountsAccess: 10,
    },
  });
}
