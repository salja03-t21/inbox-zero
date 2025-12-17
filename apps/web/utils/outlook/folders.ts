import type { MailFolder } from "@microsoft/microsoft-graph-types";
import type { OutlookClient } from "./client";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("outlook/folders");

// Should not use a common separator like "/|\>" as it may be used in the folder name.
// Using U+2999 as it is unlikely to appear in normal text
export const FOLDER_SEPARATOR = " ⦙ ";

export type OutlookFolder = {
  id: NonNullable<MailFolder["id"]>;
  displayName: NonNullable<MailFolder["displayName"]>;
  childFolders: OutlookFolder[];
};

function convertMailFolderToOutlookFolder(folder: MailFolder): OutlookFolder {
  return {
    id: folder.id ?? "",
    displayName: folder.displayName ?? "",
    childFolders:
      folder.childFolders?.map(convertMailFolderToOutlookFolder) ?? [],
  };
}

export async function getOutlookRootFolders(
  client: OutlookClient,
): Promise<OutlookFolder[]> {
  const fields = "id,displayName";

  // First, get all root folders without expansion (to avoid limits)
  const response: { value: MailFolder[] } = await client
    .getClient()
    .api(`${client.getBaseUrl()}/mailFolders`)
    .select(fields)
    .top(999)
    .get();

  const rootFolders = response.value.map(convertMailFolderToOutlookFolder);

  // Then fetch child folders for each root folder separately (with pagination support)
  await Promise.all(
    rootFolders.map(async (folder) => {
      try {
        folder.childFolders = await getOutlookChildFolders(client, folder.id);
      } catch (error) {
        logger.warn("Failed to fetch child folders for root folder", {
          folderId: folder.id,
          folderName: folder.displayName,
          error,
        });
        folder.childFolders = [];
      }
    }),
  );

  return rootFolders;
}

export async function getOutlookChildFolders(
  client: OutlookClient,
  folderId: string,
): Promise<OutlookFolder[]> {
  const fields = "id,displayName";
  let allFolders: MailFolder[] = [];
  let nextLink: string | undefined;

  // Fetch all folders with pagination support
  do {
    const response: { value: MailFolder[]; "@odata.nextLink"?: string } =
      nextLink
        ? await client.getClient().api(nextLink).get()
        : await client
            .getClient()
            .api(`${client.getBaseUrl()}/mailFolders/${folderId}/childFolders`)
            .select(fields)
            .top(999)
            .expand(
              `childFolders($select=${fields};$expand=childFolders($select=${fields}))`,
            )
            .get();

    allFolders = allFolders.concat(response.value);
    nextLink = response["@odata.nextLink"];
  } while (nextLink);

  return allFolders.map(convertMailFolderToOutlookFolder);
}

/**
 * Find a folder by name, searching Inbox child folders first, then root folders.
 * This ensures we prefer folders created under Inbox (standard location for mail folders).
 */
async function findOutlookFolderByName(
  client: OutlookClient,
  folderName: string,
): Promise<OutlookFolder | undefined> {
  const escapedFolderName = folderName.replace(/'/g, "''");

  // First, search within Inbox child folders (preferred location)
  try {
    const inboxId = await getWellKnownFolderId(client, "inbox");
    logger.info("Searching for folder in Inbox", {
      folderName,
      scope: "inbox",
    });

    const inboxChildrenResponse: {
      value: MailFolder[];
      "@odata.nextLink"?: string;
    } = await client
      .getClient()
      .api(`${client.getBaseUrl()}/mailFolders/${inboxId}/childFolders`)
      .filter(`displayName eq '${escapedFolderName}'`)
      .select("id,displayName")
      .top(100)
      .get();

    if (inboxChildrenResponse.value && inboxChildrenResponse.value.length > 0) {
      logger.info("Found folder in Inbox", {
        folderName,
        folderId: inboxChildrenResponse.value[0].id,
        scope: "inbox",
      });
      return convertMailFolderToOutlookFolder(inboxChildrenResponse.value[0]);
    }
  } catch (error) {
    logger.warn("Error searching Inbox child folders", {
      folderName,
      error,
      scope: "inbox",
    });
    // Continue to root search as fallback
  }

  // Fallback: search at root level for backward compatibility
  // (existing folders may be at root level from before this fix)
  try {
    logger.info("Searching for folder at root level", {
      folderName,
      scope: "root",
    });

    const rootResponse: { value: MailFolder[]; "@odata.nextLink"?: string } =
      await client
        .getClient()
        .api(`${client.getBaseUrl()}/mailFolders`)
        .filter(`displayName eq '${escapedFolderName}'`)
        .select("id,displayName")
        .top(200)
        .get();

    if (rootResponse.value && rootResponse.value.length > 0) {
      logger.info("Found folder at root level", {
        folderName,
        folderId: rootResponse.value[0].id,
        scope: "root",
      });
      return convertMailFolderToOutlookFolder(rootResponse.value[0]);
    }
  } catch (error) {
    logger.warn("Error searching root folders", {
      folderName,
      error,
      scope: "root",
    });
  }

  logger.info("Folder not found in Inbox or root", { folderName });
  return undefined;
}

export async function getOutlookFolderTree(
  client: OutlookClient,
  maxDepth = 10,
): Promise<OutlookFolder[]> {
  const folders = await getOutlookRootFolders(client);

  // Recursively fetch all child folders to the specified depth
  async function expandFolder(
    folder: OutlookFolder,
    currentDepth: number,
  ): Promise<void> {
    // Stop if we've reached max depth or if this folder has no ID
    if (currentDepth >= maxDepth || !folder.id) {
      return;
    }

    // The initial call to getOutlookRootFolders now fetches child folders separately
    // for each root folder (depth 0 -> depth 1), with full pagination support.
    // We only need to expand deeper (depth >= 2)
    if (
      currentDepth >= 2 &&
      (!folder.childFolders || folder.childFolders.length === 0)
    ) {
      try {
        folder.childFolders = await getOutlookChildFolders(client, folder.id);
      } catch (error) {
        logger.warn("Failed to fetch child folders", {
          folderId: folder.id,
          folderName: folder.displayName,
          depth: currentDepth,
          error,
        });
        folder.childFolders = [];
        return;
      }
    }

    // Recursively expand all children
    if (folder.childFolders && folder.childFolders.length > 0) {
      await Promise.all(
        folder.childFolders.map((child) =>
          expandFolder(child, currentDepth + 1),
        ),
      );
    }
  }

  // Expand all root folders
  await Promise.all(folders.map((folder) => expandFolder(folder, 0)));

  return folders;
}

/**
 * Find a folder by navigating a path like "Inbox ⦙ Brex Receipts"
 * Returns the folder ID if found, undefined otherwise
 */
async function findFolderByPath(
  client: OutlookClient,
  pathParts: string[],
): Promise<string | undefined> {
  if (pathParts.length === 0) return undefined;

  // Map well-known folder names to their API names
  const wellKnownFolderMap: Record<string, string> = {
    inbox: "inbox",
    "sent items": "sentitems",
    sent: "sentitems",
    drafts: "drafts",
    "deleted items": "deleteditems",
    deleted: "deleteditems",
    trash: "deleteditems",
    junk: "junkemail",
    "junk email": "junkemail",
    spam: "junkemail",
    archive: "archive",
  };

  let currentFolderId: string | undefined;

  for (let i = 0; i < pathParts.length; i++) {
    const partName = pathParts[i].trim();
    const escapedName = partName.replace(/'/g, "''");

    if (i === 0) {
      // First part - check if it's a well-known folder
      const wellKnownName = wellKnownFolderMap[partName.toLowerCase()];
      if (wellKnownName) {
        try {
          currentFolderId = await getWellKnownFolderId(
            client,
            wellKnownName as
              | "inbox"
              | "sentitems"
              | "deleteditems"
              | "drafts"
              | "junkemail"
              | "archive",
          );
          continue;
        } catch {
          // Not a well-known folder, search at root
        }
      }

      // Search at root level
      const rootResponse: { value: Array<{ id: string }> } = await client
        .getClient()
        .api(`${client.getBaseUrl()}/mailFolders`)
        .filter(`displayName eq '${escapedName}'`)
        .select("id")
        .get();

      if (rootResponse.value.length > 0) {
        currentFolderId = rootResponse.value[0].id;
      } else {
        return undefined; // Parent folder not found
      }
    } else {
      // Subsequent parts - search within parent folder
      if (!currentFolderId) return undefined;

      const childResponse: { value: Array<{ id: string }> } = await client
        .getClient()
        .api(
          `${client.getBaseUrl()}/mailFolders/${currentFolderId}/childFolders`,
        )
        .filter(`displayName eq '${escapedName}'`)
        .select("id")
        .get();

      if (childResponse.value.length > 0) {
        currentFolderId = childResponse.value[0].id;
      } else {
        return undefined; // Child folder not found
      }
    }
  }

  return currentFolderId;
}

/**
 * Get or create a folder by name or path.
 * Supports paths like "Inbox ⦙ Brex Receipts" to navigate to subfolders.
 * Creates folders under Inbox (standard location for mail organization).
 * Searches Inbox first, then root level for backward compatibility.
 */
export async function getOrCreateOutlookFolderIdByName(
  client: OutlookClient,
  folderName: string,
): Promise<string> {
  // Validate and normalize folder name
  const trimmedName = folderName.trim();
  if (!trimmedName) {
    throw new Error("Folder name cannot be empty");
  }

  // Check if this is a path (contains the separator)
  const pathParts = trimmedName.split(FOLDER_SEPARATOR).map((p) => p.trim());

  if (pathParts.length > 1) {
    // This is a path like "Inbox ⦙ Brex Receipts"
    logger.info("Parsing folder path", {
      folderPath: trimmedName,
      pathParts,
    });

    // Try to find the folder by navigating the path
    const existingFolderId = await findFolderByPath(client, pathParts);
    if (existingFolderId) {
      logger.info("Found existing folder by path", {
        folderPath: trimmedName,
        folderId: existingFolderId,
      });
      return existingFolderId;
    }

    // Folder doesn't exist - create it
    // First, find or get the parent folder
    const parentParts = pathParts.slice(0, -1);
    const targetFolderName = pathParts[pathParts.length - 1];

    let parentFolderId = await findFolderByPath(client, parentParts);

    if (!parentFolderId) {
      // If parent doesn't exist and it's a single part, try well-known folders
      if (parentParts.length === 1) {
        const wellKnownMap: Record<string, string> = {
          inbox: "inbox",
          "sent items": "sentitems",
          drafts: "drafts",
          archive: "archive",
        };
        const wellKnown = wellKnownMap[parentParts[0].toLowerCase()];
        if (wellKnown) {
          try {
            parentFolderId = await getWellKnownFolderId(
              client,
              wellKnown as "inbox" | "sentitems" | "drafts" | "archive",
            );
          } catch {
            logger.warn("Well-known folder not found", {
              folder: parentParts[0],
            });
          }
        }
      }
    }

    if (!parentFolderId) {
      logger.error("Parent folder not found for path", {
        folderPath: trimmedName,
        parentParts,
      });
      throw new Error(`Parent folder not found: ${parentParts.join(" > ")}`);
    }

    // Create the target folder under the parent
    logger.info("Creating folder under parent", {
      folderName: targetFolderName,
      parentPath: parentParts.join(FOLDER_SEPARATOR),
      parentId: parentFolderId,
    });

    try {
      const response = await client
        .getClient()
        .api(
          `${client.getBaseUrl()}/mailFolders/${parentFolderId}/childFolders`,
        )
        .post({
          displayName: targetFolderName,
        });

      logger.info("Folder created successfully", {
        folderName: targetFolderName,
        folderId: response.id,
        parentPath: parentParts.join(FOLDER_SEPARATOR),
      });

      return response.id;
    } catch (error) {
      // biome-ignore lint/suspicious/noExplicitAny: simplest
      const err = error as any;
      if (err?.code === "ErrorFolderExists" || err?.statusCode === 409) {
        // Race condition - folder was created between check and create
        const folderId = await findFolderByPath(client, pathParts);
        if (folderId) return folderId;
      }
      throw error;
    }
  }

  // Simple folder name (no path) - use original logic
  // Check if folder already exists (searches Inbox first, then root)
  const existingFolder = await findOutlookFolderByName(client, trimmedName);

  if (existingFolder) {
    logger.info("Using existing folder", {
      folderName: trimmedName,
      folderId: existingFolder.id,
    });
    return existingFolder.id;
  }

  // Create new folder under Inbox
  try {
    const inboxId = await getWellKnownFolderId(client, "inbox");
    logger.info("Creating folder under Inbox", {
      folderName: trimmedName,
      parent: "inbox",
      parentId: inboxId,
    });

    const response = await client
      .getClient()
      .api(`${client.getBaseUrl()}/mailFolders/${inboxId}/childFolders`)
      .post({
        displayName: trimmedName,
      });

    logger.info("Folder created successfully", {
      folderName: trimmedName,
      folderId: response.id,
      parent: "inbox",
    });

    return response.id;
  } catch (error) {
    // If folder already exists (race condition or created between check and create),
    // fetch folders again and return the existing folder ID
    // biome-ignore lint/suspicious/noExplicitAny: simplest
    const err = error as any;
    if (err?.code === "ErrorFolderExists" || err?.statusCode === 409) {
      logger.info(
        "Folder already exists (race condition), fetching existing folder",
        {
          folderName: trimmedName,
        },
      );
      const folder = await findOutlookFolderByName(client, trimmedName);
      if (folder) {
        return folder.id;
      }
    }

    logger.error("Failed to create folder", {
      folderName: trimmedName,
      error: err?.message || error,
      errorCode: err?.code,
      statusCode: err?.statusCode,
    });

    throw error;
  }
}

/**
 * Get or create an InboxZero folder (for tracking processed/archived emails)
 * Similar to Gmail's getOrCreateInboxZeroLabel
 */
export async function getOrCreateInboxZeroFolder(
  client: OutlookClient,
  folderType: "processed" | "archived" | "marked_read",
): Promise<{ id: string; displayName: string }> {
  const folderName = `Inbox Zero/${folderType}`;
  const folderId = await getOrCreateOutlookFolderIdByName(client, folderName);

  return {
    id: folderId,
    displayName: folderName,
  };
}

/**
 * Move a message to a specific folder
 * Used for archiving or organizing emails
 */
export async function moveMessageToFolder(
  client: OutlookClient,
  messageId: string,
  destinationFolderId: string,
): Promise<void> {
  await client
    .getClient()
    .api(`${client.getBaseUrl()}/messages/${messageId}/move`)
    .post({
      destinationId: destinationFolderId,
    });
}

/**
 * Mark a message as read or unread
 */
export async function markMessageAsRead(
  client: OutlookClient,
  messageId: string,
  isRead: boolean,
): Promise<void> {
  await client
    .getClient()
    .api(`${client.getBaseUrl()}/messages/${messageId}`)
    .patch({
      isRead,
    });
}

/**
 * Flag (star) or unflag a message
 * Equivalent to Gmail's starred label
 */
export async function flagMessage(
  client: OutlookClient,
  messageId: string,
  isFlagged: boolean,
): Promise<void> {
  await client
    .getClient()
    .api(`${client.getBaseUrl()}/messages/${messageId}`)
    .patch({
      flag: isFlagged
        ? { flagStatus: "flagged" }
        : { flagStatus: "notFlagged" },
    });
}

/**
 * Get well-known folder IDs (inbox, sent, archive, etc.)
 * These are standard folders that exist in all Outlook accounts
 */
export async function getWellKnownFolderId(
  client: OutlookClient,
  folderName:
    | "inbox"
    | "sentitems"
    | "deleteditems"
    | "drafts"
    | "junkemail"
    | "archive",
): Promise<string> {
  const response = await client
    .getClient()
    .api(`${client.getBaseUrl()}/mailFolders/${folderName}`)
    .select("id")
    .get();

  return response.id;
}
