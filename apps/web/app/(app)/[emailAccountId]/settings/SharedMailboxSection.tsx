"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { FormSection, FormSectionLeft } from "@/components/Form";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError, toastSuccess } from "@/components/Toast";
import { useAction } from "next-safe-action/hooks";
import { connectSharedMailboxAction } from "@/utils/actions/email-account";
import type { SharedMailboxesResponse } from "@/app/api/outlook/shared-mailboxes/route";
import { Badge } from "@/components/ui/badge";
import { useEmailAccount } from "@/providers/EmailAccountProvider";
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
  const { emailAccount } = useEmailAccount();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Only show this section for Microsoft accounts
  if (!isMicrosoftProvider(emailAccount.account.provider)) {
    return null;
  }

  return (
    <FormSection id="shared-mailboxes">
      <FormSectionLeft
        title="Shared Mailboxes"
        description="Connect to shared mailboxes you have access to. This allows you to manage emails from shared inboxes like support@company.com."
      />
      <div className="space-y-4">
        <ConnectedMailboxesList />
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
            <AvailableMailboxesList
              onConnect={() => setDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </FormSection>
  );
}

function ConnectedMailboxesList() {
  const { emailAccount } = useEmailAccount();
  
  // Fetch connected shared mailboxes
  const { data, isLoading, error, mutate } = useSWR<{
    sharedMailboxes: Array<{
      id: string;
      email: string;
      name: string | null;
    }>;
  }>(`/api/user/shared-mailboxes?emailAccountId=${emailAccount.id}`);

  if (isLoading) return <LoadingContent loading />;
  if (error) return <LoadingContent error={error} />;

  const sharedMailboxes = data?.sharedMailboxes || [];

  if (sharedMailboxes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        No shared mailboxes connected yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sharedMailboxes.map((mailbox) => (
        <div
          key={mailbox.id}
          className="flex items-center justify-between rounded-lg border p-3"
        >
          <div className="flex flex-col">
            <span className="font-medium">{mailbox.name || mailbox.email}</span>
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
              onClick={() => {
                // TODO: Implement disconnect functionality
                toastError({
                  description:
                    "Disconnect functionality coming soon",
                });
              }}
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AvailableMailboxesList({ onConnect }: { onConnect: () => void }) {
  const { data, isLoading, error } = useSWR<SharedMailboxesResponse>(
    "/api/outlook/shared-mailboxes"
  );

  const { execute: connectMailbox, isExecuting } = useAction(
    connectSharedMailboxAction,
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
    }
  );

  const handleConnect = useCallback(
    (email: string, displayName: string) => {
      connectMailbox({
        sharedMailboxEmail: email,
        sharedMailboxName: displayName,
      });
    },
    [connectMailbox]
  );

  if (isLoading) return <LoadingContent loading />;
  if (error) return <LoadingContent error={error} />;

  const mailboxes = data?.mailboxes || [];

  if (mailboxes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        No shared mailboxes found. Make sure you have delegated access to shared
        mailboxes in your Microsoft account.
      </div>
    );
  }

  return (
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
            onClick={() => handleConnect(mailbox.email, mailbox.displayName)}
            disabled={isExecuting}
          >
            {isExecuting ? "Connecting..." : "Connect"}
          </Button>
        </div>
      ))}
    </div>
  );
}
