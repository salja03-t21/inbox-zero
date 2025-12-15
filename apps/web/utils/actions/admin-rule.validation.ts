import { z } from "zod";
import { SystemType } from "@prisma/client";

export const adminToggleRuleBody = z.object({
  ruleId: z.string(),
  emailAccountId: z.string(),
  enabled: z.boolean(),
  systemType: z.nativeEnum(SystemType).optional(),
});
export type AdminToggleRuleBody = z.infer<typeof adminToggleRuleBody>;

export const adminDeleteRuleBody = z.object({
  ruleId: z.string(),
  emailAccountId: z.string(),
});
export type AdminDeleteRuleBody = z.infer<typeof adminDeleteRuleBody>;

export const adminDeleteEmailAccountBody = z.object({
  emailAccountId: z.string(),
});
export type AdminDeleteEmailAccountBody = z.infer<
  typeof adminDeleteEmailAccountBody
>;

export const adminToggleEmailAccountBody = z.object({
  emailAccountId: z.string(),
  enabled: z.boolean(),
});
export type AdminToggleEmailAccountBody = z.infer<
  typeof adminToggleEmailAccountBody
>;
