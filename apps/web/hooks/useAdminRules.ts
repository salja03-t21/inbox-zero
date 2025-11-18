import useSWR from "swr";
import type { AdminRulesResponse } from "@/app/api/user/admin/rules/[emailAccountId]/route";

export function useAdminRules(emailAccountId: string | null) {
  return useSWR<AdminRulesResponse>(
    emailAccountId ? `/api/user/admin/rules/${emailAccountId}` : null,
  );
}
