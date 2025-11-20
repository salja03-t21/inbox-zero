"use client";

import { useCallback } from "react";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { LoadingContent } from "@/components/LoadingContent";
import { adminSetAdminStatusAction } from "@/utils/actions/admin";
import { toastError, toastSuccess } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";

export function AdminUsersManagement() {
  const { data, isLoading, error, mutate } = useAdminUsers();

  const handleToggleAdmin = useCallback(
    async (userId: string, currentStatus: boolean, userEmail: string) => {
      const newStatus = !currentStatus;

      const result = await adminSetAdminStatusAction({
        userId,
        isAdmin: newStatus,
      });

      if (result?.serverError) {
        toastError({
          title: "Error updating admin status",
          description: result.serverError,
        });
      } else {
        toastSuccess({
          description:
            result?.data?.message || "Admin status updated successfully",
        });
        mutate();
      }
    },
    [mutate],
  );

  return (
    <LoadingContent loading={isLoading} error={error}>
      {data && (
        <div className="rounded-lg border bg-card">
          <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Email Accounts</TableHead>
                  <TableHead>Admin Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.name || "N/A"}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {user.emailAccounts.map((account) => (
                          <div
                            key={account.id}
                            className="text-sm text-gray-600"
                          >
                            {account.email}
                            {account.hasActiveRules && (
                              <Badge variant="secondary" className="ml-2">
                                {account.rulesCount} rules
                              </Badge>
                            )}
                          </div>
                        ))}
                        {user.emailAccounts.length === 0 && (
                          <span className="text-sm text-gray-400">
                            No email accounts
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.isAdmin ? (
                        <Badge variant="default" className="gap-1">
                          <ShieldCheckIcon className="h-3 w-3" />
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <ShieldOffIcon className="h-3 w-3" />
                          User
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant={user.isAdmin ? "outline" : "default"}
                        size="sm"
                        onClick={() =>
                          handleToggleAdmin(user.id, user.isAdmin, user.email)
                        }
                      >
                        {user.isAdmin ? "Remove Admin" : "Make Admin"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {data.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No users found
              </div>
            )}
          </div>
      )}
    </LoadingContent>
  );
}
