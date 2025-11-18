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
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { LoadingContent } from "@/components/LoadingContent";
import { AdminUserRulesModal } from "@/app/(app)/[emailAccountId]/settings/AdminUserRulesModal";
import { formatDistanceToNow } from "date-fns";

export function AdminUserManagementSection() {
  const { data, isLoading, error, mutate } = useAdminUsers();
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<
    string | null
  >(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>("");

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
    </>
  );
}
