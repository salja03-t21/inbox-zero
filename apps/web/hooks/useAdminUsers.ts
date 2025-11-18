import useSWR from "swr";
import type { AdminUsersResponse } from "@/app/api/user/admin/users/route";

export function useAdminUsers() {
  return useSWR<AdminUsersResponse>("/api/user/admin/users");
}
