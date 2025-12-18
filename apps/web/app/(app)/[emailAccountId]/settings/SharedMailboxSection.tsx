"use client";

import React, { useCallback, useId, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { FormSection, FormSectionLeft } from "@/components/Form";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError, toastSuccess } from "@/components/Toast";
import { useAction } from "next-safe-action/hooks";
import {
  connectSharedMailboxAction,
  disconnectSharedMailboxAction,
} from "@/utils/actions/email-account";
import type { SharedMailboxesResponse } from "@/app/api/outlook/shared-mailboxes/route";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/providers/EmailAccountProvider";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PlusIcon, TrashIcon } from "lucide-react";

export function SharedMailboxSection() {
  const sectionId = useId();
  const { emailAccount } = useAccount();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Only show this section for Microsoft accounts
  if (!emailAccount || !isMicrosoftProvider(emailAccount.account.provider)) {
    return null;
  }

  const handleConnect = () => {
    setDialogOpen(false);
    setRefreshTrigger((prev) => prev + 1); // Trigger refresh
  };

  return (
    <FormSection id={sectionId}>
      <FormSectionLeft
        title="Shared Mailboxes"
        description="Connect to shared mailboxes you have access to. This allows you to manage emails from shared inboxes like support@company.com."
      />
      <div className="space-y-4">
        <ConnectedMailboxesList refreshTrigger={refreshTrigger} />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <PlusIcon className="mr-2 h-4 w-4" />
              Connect Shared Mailbox
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Connect Shared Mailbox</DialogTitle>
              <DialogDescription>
                Select a shared mailbox to connect. You'll be able to read and
                manage emails from this mailbox.
              </DialogDescription>
            </DialogHeader>
            <AvailableMailboxesList onConnect={handleConnect} />
          </DialogContent>
        </Dialog>
      </div>
    </FormSection>
  );
}

function ConnectedMailboxesList({
  refreshTrigger,
}: {
  refreshTrigger: number;
}) {
  const { emailAccount } = useAccount();

  // Fetch connected shared mailboxes
  const { data, isLoading, error, mutate } = useSWR<{
    sharedMailboxes: Array<{
      id: string;
      email: string;
      name: string | null;
    }>;
  }>(
    emailAccount
      ? `/api/user/shared-mailboxes?emailAccountId=${emailAccount.id}`
      : null,
  );

  // Refresh when trigger changes
  React.useEffect(() => {
    if (refreshTrigger > 0) {
      mutate();
    }
  }, [refreshTrigger, mutate]);

  const { execute: disconnectMailbox, isExecuting: isDisconnecting } =
    useAction(disconnectSharedMailboxAction, {
      onSuccess: () => {
        toastSuccess({ description: "Shared mailbox disconnected!" });
        mutate(); // Refresh the list
      },
      onError: (error) => {
        toastError({
          description: `Failed to disconnect: ${error.error.serverError || ""}`,
        });
      },
    });

  const handleDisconnect = useCallback(
    (mailboxId: string, mailboxName: string) => {
      if (confirm(`Are you sure you want to disconnect "${mailboxName}"?`)) {
        disconnectMailbox({ sharedMailboxId: mailboxId });
      }
    },
    [disconnectMailbox],
  );

  const sharedMailboxes = data?.sharedMailboxes || [];

  return (
    <LoadingContent loading={isLoading} error={error}>
      {sharedMailboxes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No shared mailboxes connected yet
        </div>
      ) : (
        <div className="space-y-2">
          {sharedMailboxes.map((mailbox) => (
            <div
              key={mailbox.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex flex-col">
                <span className="font-medium">
                  {mailbox.name || mailbox.email}
                </span>
                {mailbox.name && (
                  <span className="text-sm text-muted-foreground">
                    {mailbox.email}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Connected</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleDisconnect(mailbox.id, mailbox.name || mailbox.email)
                  }
                  disabled={isDisconnecting}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </LoadingContent>
  );
}

function AvailableMailboxesList({ onConnect }: { onConnect: () => void }) {
  const { emailAccountId } = useAccount();
  const emailInputId = `shared-mailbox-email-${emailAccountId}`;
  const nameInputId = `shared-mailbox-name-${emailAccountId}`;
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");

  const { execute: connectMailbox, isExecuting } = useAction(
    connectSharedMailboxAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "Shared mailbox connected!" });
        setManualEmail("");
        setManualName("");
        onConnect();
      },
      onError: (error) => {
        toastError({
          description: `Failed to connect: ${error.error.serverError || ""}`,
        });
      },
    },
  );

  const handleManualConnect = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualEmail.trim()) {
        toastError({ description: "Please enter an email address" });
        return;
      }
      connectMailbox({
        sharedMailboxEmail: manualEmail.trim(),
        sharedMailboxName: manualName.trim() || manualEmail.trim(),
      });
    },
    [manualEmail, manualName, connectMailbox],
  );

  return (
    <div className="space-y-4">
      <form onSubmit={handleManualConnect} className="space-y-3">
        <div>
          <label
            htmlFor={emailInputId}
            className="block text-sm font-medium mb-1"
          >
            Shared Mailbox Email
          </label>
          <input
            id={emailInputId}
            type="email"
            placeholder="shared@company.com"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm"
            disabled={isExecuting}
          />
        </div>
        <div>
          <label
            htmlFor={nameInputId}
            className="block text-sm font-medium mb-1"
          >
            Display Name (optional)
          </label>
          <input
            id={nameInputId}
            type="text"
            placeholder="e.g., Support Team"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm"
            disabled={isExecuting}
          />
        </div>
        <Button type="submit" disabled={isExecuting} className="w-full">
          {isExecuting ? "Connecting..." : "Connect Shared Mailbox"}
        </Button>
      </form>
      <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <p className="font-medium mb-1">Note:</p>
        <p>
          Microsoft Graph API doesn't support listing shared mailboxes directly.
          Please enter the email address of the shared mailbox you have
          delegated access to in your Microsoft account.
        </p>
      </div>
    </div>
  );
}

function _OldAvailableMailboxesList({ onConnect }: { onConnect: () => void }) {
  const { emailAccountId } = useAccount();
  const { data, isLoading, error } = useSWR<SharedMailboxesResponse>(
    "/api/outlook/shared-mailboxes",
  );

  const { execute: connectMailbox, isExecuting } = useAction(
    connectSharedMailboxAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        toastSuccess({ description: "Shared mailbox connected!" });
        onConnect();
      },
      onError: (error) => {
        toastError({
          description: `Failed to connect: ${error.error.serverError || ""}`,
        });
      },
    },
  );

  const handleConnect = useCallback(
    (email: string, displayName: string) => {
      connectMailbox({
        sharedMailboxEmail: email,
        sharedMailboxName: displayName,
      });
    },
    [connectMailbox],
  );

  const mailboxes = data?.mailboxes || [];

  return (
    <LoadingContent loading={isLoading} error={error}>
      {mailboxes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No shared mailboxes found. Make sure you have delegated access to
          shared mailboxes in your Microsoft account.
        </div>
      ) : (
        <div className="space-y-2">
          {mailboxes.map((mailbox) => (
            <div
              key={mailbox.email}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex flex-col">
                <span className="font-medium">{mailbox.displayName}</span>
                <span className="text-sm text-muted-foreground">
                  {mailbox.email}
                </span>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  handleConnect(mailbox.email, mailbox.displayName)
                }
                disabled={isExecuting}
              >
                {isExecuting ? "Connecting..." : "Connect"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </LoadingContent>
  );
}
