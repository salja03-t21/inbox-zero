import { z } from "zod";
import { tb } from "./client";

const tinybirdEmailAction = z.object({
  ownerEmail: z.string(),
  threadId: z.string(),
  action: z.enum(["archive", "delete"]),
  actionSource: z.enum(["user", "automation"]),
  timestamp: z.number(),
});

export type TinybirdEmailAction = z.infer<typeof tinybirdEmailAction>;

// Build ingest endpoint only if Tinybird client is initialized
const publishEmailAction = tb
  ? tb.buildIngestEndpoint({
      datasource: "email_action",
      event: tinybirdEmailAction,
    })
  : null;

// Helper functions for specific actions - skip if Tinybird not configured
export const publishArchive = (params: Omit<TinybirdEmailAction, "action">) => {
  if (!publishEmailAction) {
    // Tinybird not configured, skip publishing
    return Promise.resolve();
  }
  return publishEmailAction({ ...params, action: "archive" });
};

export const publishDelete = (params: Omit<TinybirdEmailAction, "action">) => {
  if (!publishEmailAction) {
    // Tinybird not configured, skip publishing
    return Promise.resolve();
  }
  return publishEmailAction({ ...params, action: "delete" });
};
