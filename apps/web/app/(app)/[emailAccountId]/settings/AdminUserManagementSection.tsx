"use client";

import { useState, useCallback } from "react";
import { FormSection, FormSectionLeft } from "@/components/Form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { LoadingContent } from "@/components/LoadingContent";
import { AdminUserRulesModal } from "@/app/(app)/[emailAccountId]/settings/AdminUserRulesModal";
import { adminDeleteEmailAccountAction } from "@/utils/actions/admin-rule";
import { toastSuccess, toastError } from "@/components/Toast";
import { formatDistanceToNow } from "date-fns";

export function AdminUserManagementSection() {
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
    mutate(); // Refresh the user list after modal closes
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
        mutate(); // Refresh the list
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

  return (
    <>
      <FormSection>
        <FormSectionLeft
          title="User Management"
          description="View and manage all users and their email automation rules. Only administrators can access this section."
        />

        <LoadingContent loading={isLoading} error={error}>
          <div className="col-span-2 space-y-4">
            {data && data.length > 0 ? (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Email Accounts</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.name || "—"}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            {user.emailAccounts.map((account) => (
                              <div
                                key={account.id}
                                className="flex items-center gap-2"
                              >
                                <span className="text-sm">
                                  {account.email}
                                </span>
                                {account.hasActiveRules ? (
                                  <>
                                    <Badge variant="secondary">
                                      {account.rulesCount}{" "}
                                      {account.rulesCount === 1
                                        ? "rule"
                                        : "rules"}
                                    </Badge>
                                    <Button
                                      variant="link"
                                      size="sm"
                                      onClick={() =>
                                        handleViewRules(
                                          account.id,
                                          account.email,
                                        )
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
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(user.createdAt), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            {user.emailAccounts.map((account) => (
                              <div key={account.id}>
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
              </Card>
            ) : (
              <p className="text-muted-foreground">No users found.</p>
            )}
          </div>
        </LoadingContent>
      </FormSection>

      <AdminUserRulesModal
        emailAccountId={selectedEmailAccountId}
        userEmail={selectedUserEmail}
        isOpen={!!selectedEmailAccountId}
        onClose={handleCloseModal}
      />

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      >
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
            <AlertDialogCancel disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
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
