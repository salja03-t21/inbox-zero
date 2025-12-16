import useSWR from "swr";
import { useMemo } from "react";
import type { GetEmailAccountsResponse } from "@/app/api/user/email-accounts/route";
import { isValidEmailProvider } from "@/utils/email/provider-types";

export function useAccounts() {
  const result = useSWR<GetEmailAccountsResponse>("/api/user/email-accounts", {
    revalidateOnFocus: false,
  });

  // Defense layer: Filter to only valid email providers (Google, Microsoft)
  // The API should already filter these, but this provides client-side safety
  const filteredData = useMemo(() => {
    if (!result.data?.emailAccounts) return result.data;

    return {
      ...result.data,
      emailAccounts: result.data.emailAccounts.filter((acc) =>
        isValidEmailProvider(acc.account?.provider),
      ),
    };
  }, [result.data]);

  return {
    ...result,
    data: filteredData,
  };
}
