"use client";

import { useCallback, useState } from "react";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { LoadingContent } from "@/components/LoadingContent";
import { adminSetAdminStatusAction } from "@/utils/actions/admin";
import {
  adminDeleteEmailAccountAction,
  adminToggleEmailAccountAction,
} from "@/utils/actions/admin-rule";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { AdminUserRulesModal } from "@/app/(app)/[emailAccountId]/settings/AdminUserRulesModal";
import { formatDistanceToNow } from "date-fns";

export function AdminUsersManagement() {
  const { data, isLoading, error, mutate } = useAdminUsers();
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<
    string | null
  >(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [emailAccountToDelete, setEmailAccountToDelete] = useState<{
    id: string;
    email: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingAccountIds, setTogglingAccountIds] = useState<Set<string>>(
    new Set(),
  );

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

  const handleViewRules = useCallback(
    (emailAccountId: string, userEmail: string) => {
      setSelectedEmailAccountId(emailAccountId);
      setSelectedUserEmail(userEmail);
    },
    [],
  );

  const handleCloseModal = useCallback(() => {
    setSelectedEmailAccountId(null);
    setSelectedUserEmail("");
    mutate();
  }, [mutate]);

  const handleDeleteClick = useCallback(
    (emailAccountId: string, email: string) => {
      setEmailAccountToDelete({ id: emailAccountId, email });
      setDeleteDialogOpen(true);
    },
    [],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!emailAccountToDelete) return;

    setIsDeleting(true);
    try {
      const result = await adminDeleteEmailAccountAction({
        emailAccountId: emailAccountToDelete.id,
      });

      if (result?.serverError) {
        toastError({
          title: "Error deleting email account",
          description: result.serverError,
        });
      } else {
        toastSuccess({
          description: `Email account ${emailAccountToDelete.email} deleted successfully`,
        });
        mutate();
      }
    } catch (error) {
      toastError({
        title: "Error deleting email account",
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setEmailAccountToDelete(null);
    }
  }, [emailAccountToDelete, mutate]);

  const handleToggleEnabled = useCallback(
    async (emailAccountId: string, currentEnabled: boolean) => {
      setTogglingAccountIds((prev) => new Set(prev).add(emailAccountId));

      try {
        const result = await adminToggleEmailAccountAction({
          emailAccountId,
          enabled: !currentEnabled,
        });

        if (result?.serverError) {
          toastError({
            title: "Error toggling email account",
            description: result.serverError,
          });
        } else {
          toastSuccess({
            description: `Email account ${!currentEnabled ? "enabled" : "disabled"} successfully${!currentEnabled ? "" : ". Login access has been revoked."}`,
          });
          mutate();
        }
      } catch (error) {
        toastError({
          title: "Error toggling email account",
          description:
            error instanceof Error ? error.message : "Unknown error occurred",
        });
      } finally {
        setTogglingAccountIds((prev) => {
          const next = new Set(prev);
          next.delete(emailAccountId);
          return next;
        });
      }
    },
    [mutate],
  );

  return (
    <>
      <LoadingContent loading={isLoading} error={error}>
        {data && (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Email Accounts</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.name || "—"}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        {user.emailAccounts.map((account) => (
                          <div
                            key={account.id}
                            className="flex items-center gap-2"
                          >
                            <span className="text-sm">{account.email}</span>
                            {account.hasActiveRules ? (
                              <>
                                <Badge variant="secondary">
                                  {account.rulesCount}{" "}
                                  {account.rulesCount === 1 ? "rule" : "rules"}
                                </Badge>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0"
                                  onClick={() =>
                                    handleViewRules(account.id, account.email)
                                  }
                                >
                                  View Rules
                                </Button>
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                No rules
                              </span>
                            )}
                          </div>
                        ))}
                        {user.emailAccounts.length === 0 && (
                          <span className="text-sm text-muted-foreground">
                            No email accounts
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {formatDistanceToNow(new Date(user.createdAt), {
                        addSuffix: true,
                      })}
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
                      <div className="space-y-3">
                        <Button
                          variant={user.isAdmin ? "outline" : "default"}
                          size="sm"
                          onClick={() =>
                            handleToggleAdmin(user.id, user.isAdmin, user.email)
                          }
                        >
                          {user.isAdmin ? "Remove Admin" : "Make Admin"}
                        </Button>

                        {user.emailAccounts.map((account) => (
                          <div
                            key={account.id}
                            className="flex items-center gap-3"
                          >
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`enabled-${account.id}`}
                                checked={account.enabled}
                                onCheckedChange={() =>
                                  handleToggleEnabled(
                                    account.id,
                                    account.enabled,
                                  )
                                }
                                disabled={togglingAccountIds.has(account.id)}
                              />
                              <Label
                                htmlFor={`enabled-${account.id}`}
                                className="text-sm text-muted-foreground cursor-pointer"
                              >
                                {account.enabled ? "Enabled" : "Disabled"}
                              </Label>
                            </div>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() =>
                                handleDeleteClick(account.id, account.email)
                              }
                            >
                              Delete
                            </Button>
                          </div>
                        ))}
                      </div>
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

      <AdminUserRulesModal
        emailAccountId={selectedEmailAccountId}
        userEmail={selectedUserEmail}
        isOpen={!!selectedEmailAccountId}
        onClose={handleCloseModal}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Email Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the email account{" "}
              <strong>{emailAccountToDelete?.email}</strong>? This action cannot
              be undone and will permanently delete all associated data
              including rules, labels, and history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
