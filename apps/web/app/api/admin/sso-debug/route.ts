import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withAuth } from "@/utils/middleware";
import { isAdmin as checkIsAdmin } from "@/utils/admin";

// Force dynamic route - do not pre-render at build time
export const dynamic = "force-dynamic";

/**
 * Debug endpoint to analyze SSO provider configuration.
 * This helps diagnose JSON parsing issues in the oidcConfig field.
 *
 * SECURITY: Requires authenticated admin user.
 */
export const GET = withAuth(async (request) => {
  const userId = request.auth.userId;

  // Get user's email for admin check
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Check if the requesting user is a global admin
  const userIsAdmin = await checkIsAdmin({ userId, email: user.email });

  if (!userIsAdmin) {
    return NextResponse.json(
      { error: "Unauthorized: Global admin access required" },
      { status: 403 },
    );
  }
  const providerId = "okta-tiger21-1765774132282";

  const provider = await prisma.ssoProvider.findFirst({
    where: { providerId },
  });

  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const oidcConfig = provider.oidcConfig;

  // Analyze the raw value
  const analysis = {
    providerId: provider.providerId,
    issuer: provider.issuer,
    domain: provider.domain,
    oidcConfig: {
      raw: oidcConfig,
      type: typeof oidcConfig,
      isNull: oidcConfig === null,
      isUndefined: oidcConfig === undefined,
      length: typeof oidcConfig === "string" ? oidcConfig.length : null,
    },
    stringAnalysis:
      typeof oidcConfig === "string"
        ? {
            firstChar: oidcConfig[0],
            firstCharCode: oidcConfig.charCodeAt(0),
            first10Chars: oidcConfig.substring(0, 10),
            last10Chars: oidcConfig.substring(oidcConfig.length - 10),
            startsWithBrace: oidcConfig.startsWith("{"),
            startsWithQuote: oidcConfig.startsWith('"'),
            startsWithBackslash: oidcConfig.startsWith("\\"),
            containsEscapedQuotes: oidcConfig.includes('\\"'),
            containsDoubleBackslash: oidcConfig.includes("\\\\"),
          }
        : null,
    parseAttempt: null as
      | { success: true; parsed: unknown }
      | { success: false; error: string }
      | null,
    doubleParseAttempt: null as
      | { success: true; parsed: unknown }
      | { success: false; error: string }
      | null,
  };

  // Try to parse it
  if (typeof oidcConfig === "string") {
    try {
      const parsed = JSON.parse(oidcConfig);
      analysis.parseAttempt = { success: true, parsed };

      // Check if the result is still a string (double-stringified)
      if (typeof parsed === "string") {
        try {
          const doubleParsed = JSON.parse(parsed);
          analysis.doubleParseAttempt = { success: true, parsed: doubleParsed };
        } catch (e) {
          analysis.doubleParseAttempt = {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
    } catch (e) {
      analysis.parseAttempt = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  } else if (typeof oidcConfig === "object" && oidcConfig !== null) {
    // Already an object (some ORMs return parsed JSON)
    analysis.parseAttempt = { success: true, parsed: oidcConfig };
  }

  return NextResponse.json(analysis, { status: 200 });
});
