"use client";

import { useState, useCallback } from "react";
import { HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionDescription } from "@/components/Typography";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError, toastSuccess } from "@/components/Toast";
import { PremiumAlertWithData, usePremium } from "@/components/PremiumAlert";
import { SetDateDropdown } from "@/app/(app)/[emailAccountId]/assistant/SetDateDropdown";
import { useThreads } from "@/hooks/useThreads";
import { fetchWithAccount } from "@/utils/fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface BulkRunRulesProps {
  emailAccountId: string;
  onJobCreated?: (jobId: string) => void;
}

export function BulkRunRules({
  emailAccountId,
  onJobCreated,
}: BulkRunRulesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const { data, isLoading, error } = useThreads({ type: "inbox" });
  const { hasAiAccess, isLoading: isLoadingPremium } = usePremium();

  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [onlyUnread, setOnlyUnread] = useState(true);

  const startBulkProcess = useCallback(async () => {
    if (!startDate) {
      toastError({ description: "Please select a start date" });
      return;
    }

    setIsStarting(true);

    try {
      const response = await fetchWithAccount({
        url: "/api/bulk-process/start",
        emailAccountId,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            emailAccountId,
            startDate: startDate.toISOString(),
            endDate: endDate?.toISOString(),
            onlyUnread,
          }),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start bulk processing");
      }

      const result = await response.json();

      toastSuccess({
        description:
          "Bulk processing started! Processing will continue in the background.",
      });

      setIsOpen(false);

      if (onJobCreated) {
        onJobCreated(result.jobId);
      }
    } catch (error) {
      console.error("Error starting bulk process:", error);
      toastError({
        title: "Failed to start bulk processing",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsStarting(false);
    }
  }, [startDate, endDate, onlyUnread, emailAccountId, onJobCreated]);

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
                        disabled={!startDate || isStarting}
                        loading={isStarting}
                        onClick={startBulkProcess}
                      >
                        {isStarting ? "Starting..." : "Process Emails"}
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
