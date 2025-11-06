"use client";

import { useState } from "react";
import { HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionDescription } from "@/components/Typography";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError } from "@/components/Toast";
import { PremiumAlertWithData, usePremium } from "@/components/PremiumAlert";
import { SetDateDropdown } from "@/app/(app)/[emailAccountId]/assistant/SetDateDropdown";
import { useThreads } from "@/hooks/useThreads";
import type { ThreadsResponse } from "@/app/api/threads/route";
import type { ThreadsQuery } from "@/app/api/threads/validation";
import { runAiRules } from "@/utils/queue/email-actions";
import { sleep } from "@/utils/sleep";
import { fetchWithAccount } from "@/utils/fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function BulkRunRules({
  onStart,
}: {
  onStart?: (params: {
    startDate: Date;
    endDate?: Date;
    onlyUnread: boolean;
    onDiscovered: (count: number) => void;
    onProcessed: (count: number) => void;
    onComplete: (aborted: boolean) => void;
  }) => (() => void) | Promise<() => void>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading, error } = useThreads({ type: "inbox" });

  const { hasAiAccess, isLoading: isLoadingPremium } = usePremium();

  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [onlyUnread, setOnlyUnread] = useState(true);

  return (
    <div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" Icon={HistoryIcon}>
            Bulk Process Emails
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process Existing Inbox Emails</DialogTitle>
          </DialogHeader>
          <LoadingContent loading={isLoading} error={error}>
            {data && (
              <>
                <SectionDescription>
                  This runs your rules on emails in your inbox that have not
                  been successfully processed (excludes emails with SKIPPED or
                  ERROR status).
                </SectionDescription>

                <LoadingContent loading={isLoadingPremium}>
                  {hasAiAccess ? (
                    <div className="flex flex-col space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <SetDateDropdown
                          onChange={setStartDate}
                          value={startDate}
                          placeholder="Set start date"
                        />
                        <SetDateDropdown
                          onChange={setEndDate}
                          value={endDate}
                          placeholder="Set end date (optional)"
                        />
                      </div>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={onlyUnread}
                          onChange={(e) => setOnlyUnread(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <span className="text-sm">
                          Only process unread emails
                        </span>
                      </label>

                      <Button
                        type="button"
                        disabled={!startDate}
                        onClick={async () => {
                          if (!startDate) {
                            toastError({
                              description: "Please select a start date",
                            });
                            return;
                          }

                          // Close dialog immediately
                          setIsOpen(false);

                          // Call parent's onStart if provided
                          if (onStart) {
                            onStart({
                              startDate,
                              endDate,
                              onlyUnread,
                              onDiscovered: () => {},
                              onProcessed: () => {},
                              onComplete: () => {},
                            });
                          }
                        }}
                      >
                        Process Emails
                      </Button>
                    </div>
                  ) : (
                    <PremiumAlertWithData />
                  )}
                </LoadingContent>
              </>
            )}
          </LoadingContent>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// fetch batches of messages and add them to the ai queue
export async function onRun(
  emailAccountId: string,
  {
    startDate,
    endDate,
    onlyUnread,
  }: { startDate: Date; endDate?: Date; onlyUnread: boolean },
  callbacks: {
    onDiscovered: (count: number) => void;
    onProcessed: (count: number) => void;
  },
  onComplete: (aborted: boolean) => void,
) {
  let nextPageToken = "";
  const LIMIT = 25;

  let aborted = false;
  const seenThreadIds = new Set<string>(); // Track processed threads to avoid duplicates

  function abort() {
    aborted = true;
  }

  async function run() {
    // Cursor-based pagination: loop until no more pages or aborted
    // No hard limit - processes all threads in date range
    while (!aborted) {
      const query: ThreadsQuery = {
        type: "inbox",
        limit: LIMIT,
        after: startDate,
        ...(endDate ? { before: endDate } : {}),
        ...(onlyUnread ? { isUnread: true } : {}),
        ...(nextPageToken ? { nextPageToken } : {}),
      };

      const res = await fetchWithAccount({
        url: `/api/threads?${
          // biome-ignore lint/suspicious/noExplicitAny: simplest
          new URLSearchParams(query as any).toString()
        }`,
        emailAccountId,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("Failed to fetch threads:", res.status, errorData);
        toastError({
          title: "Failed to fetch emails",
          description:
            typeof errorData.error === "string"
              ? errorData.error
              : `Error: ${res.status}`,
        });
        break;
      }

      const data: ThreadsResponse = await res.json();

      if (!data.threads) {
        console.error("Invalid response: missing threads", data);
        toastError({
          title: "Invalid response",
          description: "Failed to process emails. Please try again.",
        });
        break;
      }

      nextPageToken = data.nextPageToken || "";

      const threadsWithoutPlan = data.threads.filter((t) => !t.plan);

      // Deduplicate: filter out threads we've already seen
      const newThreads = threadsWithoutPlan.filter(
        (t) => !seenThreadIds.has(t.id),
      );
      newThreads.forEach((t) => seenThreadIds.add(t.id));

      // Track: discovered = all fetched, processed = those queued for AI
      callbacks.onDiscovered(data.threads.length);
      callbacks.onProcessed(newThreads.length);

      runAiRules(emailAccountId, newThreads, false);

      if (!nextPageToken || aborted) break;

      // avoid gmail api rate limits
      // ai takes longer anyway
      await sleep(threadsWithoutPlan.length ? 5000 : 2000);
    }

    onComplete(aborted);
  }

  run();

  return abort;
}
