// This script fixes the SSO email issue in auth.ts
const fs = require("node:fs");
const path = require("node:path");

const authPath = path.join(__dirname, "apps/web/utils/auth.ts");
let content = fs.readFileSync(authPath, "utf8");

// Add SSO handling to getProfileData function
const getProfileDataEnd = content.indexOf(
  "}\n\nasync function handleLinkAccount",
);
if (getProfileDataEnd !== -1) {
  const insertPoint = content.lastIndexOf("}", getProfileDataEnd);
  const ssoHandling = `
  
  // For SSO providers, we can't fetch profile data using access token
  // The profile data should already be available in the user record
  if (providerId.includes('okta') || providerId.includes('sso')) {
    logger.info("[getProfileData] SSO provider detected, returning null", {
      providerId
    });
    return null;
  }
  
  logger.warn("[getProfileData] Unknown provider type", {
    providerId,
    isGoogle: isGoogleProvider(providerId),
    isMicrosoft: isMicrosoftProvider(providerId)
  });
  
  return null;`;

  content =
    content.slice(0, insertPoint) +
    ssoHandling +
    "\n" +
    content.slice(insertPoint);
}

// Add SSO handling to handleLinkAccount function
const handleLinkAccountStart = content.indexOf(
  "async function handleLinkAccount(account: Account) {",
);
const tryBlockStart = content.indexOf("try {", handleLinkAccountStart);
const tryBlockContent = tryBlockStart + 5;

const ssoAccountHandling = `
    // For SSO providers, get user info from the user record
    if (account.providerId.includes('okta') || account.providerId.includes('sso')) {
      logger.info("[handleLinkAccount] SSO provider detected, getting user info from database", {
        providerId: account.providerId,
        userId: account.userId
      });
      
      const user = await prisma.user.findUnique({
        where: { id: account.userId },
        select: { email: true, name: true, image: true },
      });
      
      if (!user?.email) {
        logger.error("[handleLinkAccount] No user email found for SSO provider", {
          userId: account.userId,
          providerId: account.providerId,
        });
        throw new Error("User email not found for SSO account linking.");
      }
      
      primaryEmail = user.email;
      primaryName = user.name;
      primaryPhotoUrl = user.image;
    } else {
      // Original OAuth provider logic`;

content =
  content.slice(0, tryBlockContent) +
  "\n" +
  ssoAccountHandling +
  "\n    " +
  content.slice(tryBlockContent);

// Close the else block
const _primaryEmailCheck = content.indexOf("if (!primaryEmail) {");
const throwErrorEnd = content.indexOf(
  "}\n",
  content.indexOf(
    'throw new Error("Primary email not found for linked account.");',
  ),
);
content =
  content.slice(0, throwErrorEnd + 1) +
  "\n    }" +
  content.slice(throwErrorEnd + 1);

fs.writeFileSync(authPath, content);
