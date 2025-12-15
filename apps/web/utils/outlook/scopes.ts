// https://learn.microsoft.com/en-us/graph/permissions-reference

import { env } from "@/env";

export const SCOPES = [
  "openid",
  "profile",
  "email",
  "User.Read",
  "offline_access", // Required for refresh tokens
  "Mail.ReadWrite", // Read and write access to mailbox
  ...(env.NEXT_PUBLIC_EMAIL_SEND_ENABLED ? ["Mail.Send"] : []), // Send emails
  "Mail.ReadBasic", // Read basic mail properties
  "Mail.Read", // Read mail in all mailboxes
  "Mail.Read.Shared", // Read mail in shared mailboxes
  "Mail.ReadWrite.Shared", // Read and write mail in shared mailboxes
  "MailboxSettings.ReadWrite", // Read and write mailbox settings
  ...(env.NEXT_PUBLIC_CONTACTS_ENABLED ? ["Contacts.ReadWrite"] : []),
] as const;

export const CALENDAR_SCOPES = [
  "openid",
  "profile",
  "email",
  "User.Read",
  "offline_access", // Required for refresh tokens
  "Calendars.Read", // Read user calendars
  "Calendars.ReadWrite", // Read and write user calendars
  "OnlineMeetings.ReadWrite", // Create and manage Teams meetings
] as const;
