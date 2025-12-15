import { z } from "zod";

export const hashEmailBody = z.object({
  email: z.string().min(1, "Value is required"),
});
export type HashEmailBody = z.infer<typeof hashEmailBody>;

export const convertGmailUrlBody = z.object({
  rfc822MessageId: z.string().trim().min(1, "RFC822 Message-ID is required"),
  email: z.string().trim().email("Valid email address is required"),
});
export type ConvertGmailUrlBody = z.infer<typeof convertGmailUrlBody>;

export const getLabelsBody = z.object({
  emailAccountId: z.string().min(1, "Email account ID is required"),
});
export type GetLabelsBody = z.infer<typeof getLabelsBody>;

export const setAdminStatusBody = z.object({
  userId: z.string().min(1, "User ID is required"),
  isAdmin: z.boolean(),
});
export type SetAdminStatusBody = z.infer<typeof setAdminStatusBody>;
