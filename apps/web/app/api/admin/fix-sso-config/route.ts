import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";

export async function GET() {
  const provider = await prisma.ssoProvider.findFirst({
    where: { providerId: "okta-tiger21-1765774132282" },
  });

  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const correctConfig = {
    clientId: "0oa251hvxm7RlukZO0h8",
    discoveryUrl: "https://apps.tiger21.com/.well-known/openid-configuration",
  };

  await prisma.ssoProvider.update({
    where: { id: provider.id },
    data: {
      oidcConfig: JSON.stringify(correctConfig),
    },
  });

  const updated = await prisma.ssoProvider.findFirst({
    where: { providerId: "okta-tiger21-1765774132282" },
  });

  return NextResponse.json({
    old: provider.oidcConfig,
    new: updated?.oidcConfig,
    message: "Updated successfully",
  });
}
