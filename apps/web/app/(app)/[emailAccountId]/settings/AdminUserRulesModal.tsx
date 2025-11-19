"use client";

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { LoadingContent } from "@/components/LoadingContent";
import { useAdminRules } from "@/hooks/useAdminRules";
import {
  adminToggleRuleAction,
  adminDeleteRuleAction,
} from "@/utils/actions/admin-rule";
import { toastSuccess, toastError } from "@/components/Toast";
import { TrashIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { AdminRulesResponse } from "@/app/api/user/admin/rules/[emailAccountId]/route";

type Rule = AdminRulesResponse[number];

export function AdminUserRulesModal({
  emailAccountId,
  userEmail,
  isOpen,
  onClose,
}: {
  emailAccountId: string | null;
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { data, isLoading, error, mutate } = useAdminRules(emailAccountId);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);

  const handleToggleRule = useCallback(
    async (rule: Rule) => {
      if (!emailAccountId) return;

      setTogglingRuleId(rule.id);

      try {
        const result = await adminToggleRuleAction({
          ruleId: rule.id,
          emailAccountId,
          enabled: !rule.enabled,
          systemType: rule.systemType || undefined,
        });

        if (result?.serverError) {
          toastError({
            title: "Error toggling rule",
            description: result.serverError,
          });
        } else {
          toastSuccess({
            description: `Rule ${!rule.enabled ? "enabled" : "disabled"} successfully`,
          });
          mutate();
        }
      } catch (error) {
        toastError({
          title: "Error toggling rule",
          description: "An unexpected error occurred",
        });
      } finally {
        setTogglingRuleId(null);
      }
    },
    [emailAccountId, mutate],
  );

  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      if (!emailAccountId) return;

      try {
        const result = await adminDeleteRuleAction({
          ruleId,
          emailAccountId,
        });

        if (result?.serverError) {
          toastError({
            title: "Error deleting rule",
            description: result.serverError,
          });
        } else {
          toastSuccess({
            description: "Rule deleted successfully",
          });
          mutate();
        }
      } catch (error) {
        toastError({
          title: "Error deleting rule",
          description: "An unexpected error occurred",
        });
      } finally {
        setDeletingRuleId(null);
      }
    },
    [emailAccountId, mutate],
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Rules for {userEmail}</DialogTitle>
            <DialogDescription>
              View and manage automation rules for this user. You can
              enable/disable or delete rules.
            </DialogDescription>
          </DialogHeader>

          <LoadingContent loading={isLoading} error={error}>
            {data && data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Manage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">
                        <div>
                          <div>{rule.name}</div>
                          {rule.group && (
                            <div className="text-sm text-muted-foreground">
                              Group: {rule.group.name}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={rule.enabled ? "default" : "secondary"}>
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {rule.actions.map((action) => (
                            <Badge key={action.id} variant="outline">
                              {action.type}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatDistanceToNow(new Date(rule.createdAt), {
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleRule(rule)}
                            disabled={togglingRuleId === rule.id}
                          >
                            {togglingRuleId === rule.id
                              ? "..."
                              : rule.enabled
                                ? "Disable"
                                : "Enable"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeletingRuleId(rule.id)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground py-4">
                No rules found for this user.
              </p>
            )}
          </LoadingContent>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingRuleId}
        onOpenChange={() => setDeletingRuleId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this rule. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingRuleId) {
                  handleDeleteRule(deletingRuleId);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
