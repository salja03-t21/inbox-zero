"use client";

import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { parseAsBoolean, useQueryState } from "nuqs";
import PQueue from "p-queue";
import {
  BookOpenCheckIcon,
  SparklesIcon,
  PenSquareIcon,
  PauseIcon,
  ChevronsDownIcon,
  RefreshCcwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import { LoadingContent } from "@/components/LoadingContent";
import type { MessagesResponse } from "@/app/api/messages/route";
import { EmailMessageCell } from "@/components/EmailMessageCell";
import { runRulesAction } from "@/utils/actions/ai-rule";
import type { RulesResponse } from "@/app/api/user/rules/route";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import type { RunRulesResult } from "@/utils/ai/choose-rule/run-rules";
import { SearchForm } from "@/components/SearchForm";
import type { BatchExecutedRulesResponse } from "@/app/api/user/executed-rules/batch/route";
import { isAIRule, isGroupRule, isStaticRule } from "@/utils/condition";
import {
  BulkRunRules,
  onRun as bulkOnRun,
} from "@/app/(app)/[emailAccountId]/assistant/BulkRunRules";
import { cn } from "@/utils";
import { TestCustomEmailForm } from "@/app/(app)/[emailAccountId]/assistant/TestCustomEmailForm";
import { ResultsDisplay } from "@/app/(app)/[emailAccountId]/assistant/ResultDisplay";
import { useAccount } from "@/providers/EmailAccountProvider";
import { FixWithChat } from "@/app/(app)/[emailAccountId]/assistant/FixWithChat";
import { useChat } from "@/providers/ChatProvider";
import { useAiQueueState } from "@/store/ai-queue";
import { SectionDescription } from "@/components/Typography";

type Message = MessagesResponse["messages"][number];

export function ProcessRulesContent({ testMode }: { testMode: boolean }) {
  const [searchQuery, setSearchQuery] = useQueryState("search");
  const [showCustomForm, setShowCustomForm] = useQueryState(
    "custom",
    parseAsBoolean.withDefault(false),
  );

  const { data, isLoading, isValidating, error, setSize, mutate, size } =
    useSWRInfinite<MessagesResponse>(
      (index, previousPageData) => {
        // Always return the URL for the first page
        if (index === 0) {
          const params = new URLSearchParams();
          if (searchQuery) params.set("q", searchQuery);
          const paramsString = params.toString();

          return `/api/messages${paramsString ? `?${paramsString}` : ""}`;
        }

        // For subsequent pages, check if we have a next page token
        const pageToken = previousPageData?.nextPageToken;
        if (!pageToken) return null;

        const params = new URLSearchParams();
        if (searchQuery) params.set("q", searchQuery);
        params.set("pageToken", pageToken);
        const paramsString = params.toString();

        return `/api/messages${paramsString ? `?${paramsString}` : ""}`;
      },
      {
        revalidateFirstPage: false,
      },
    );

  const onLoadMore = async () => {
    const nextSize = size + 1;
    await setSize(nextSize);
  };

  // Check if we have more data to load
  const hasMore = data?.[data.length - 1]?.nextPageToken != null;

  // filter out messages in same thread
  // only keep the most recent message in each thread
  const messages = useMemo(() => {
    const threadIds = new Set();
    const messages = data?.flatMap((page) => page.messages) || [];
    return messages.filter((message) => {
      // works because messages are sorted by date descending
      if (threadIds.has(message.threadId)) return false;
      threadIds.add(message.threadId);
      return true;
    });
  }, [data]);

  const { data: rules } = useSWR<RulesResponse>("/api/user/rules");
  const { emailAccountId, userEmail } = useAccount();
  const queue = useAiQueueState();

  // Fetch existing executed rules for current messages
  const messageIdsToFetch = useMemo(
    () => messages.map((m) => m.id),
    [messages],
  );

  const { data: existingRules } = useSWR<BatchExecutedRulesResponse>(
    messageIdsToFetch.length > 0
      ? `/api/user/executed-rules/batch?messageIds=${messageIdsToFetch.join(",")}`
      : null,
  );

  // only show test rules form if we have an AI rule. this form won't match group/static rules which will confuse users
  const hasAiRules = rules?.some(
    (rule) => isAIRule(rule) && !isGroupRule(rule) && !isStaticRule(rule),
  );

  const isRunningAllRef = useRef(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [currentPageLimit, setCurrentPageLimit] = useState(testMode ? 1 : 10);
  const [isRunning, setIsRunning] = useState<Record<string, boolean>>({});
  const [resultsMap, setResultsMap] = useState<
    Record<string, RunRulesResult[]>
  >({});
  const handledThreadsRef = useRef(new Set<string>());

  // Bulk processing state
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkFetchingDone, setBulkFetchingDone] = useState(false);
  const [bulkDiscovered, setBulkDiscovered] = useState(0);
  const [bulkProcessed, setBulkProcessed] = useState(0);
  const bulkAbortRef = useRef<(() => void) | undefined>(undefined);

  // Auto-complete when fetching is done and queue is empty
  useEffect(() => {
    if (isBulkProcessing && bulkFetchingDone && queue.size === 0) {
      // All done!
      setIsBulkProcessing(false);
      setBulkFetchingDone(false);
      toastSuccess({
        description: `Completed! Processed ${bulkProcessed} emails.`,
      });
    }
  }, [isBulkProcessing, bulkFetchingDone, queue.size, bulkProcessed]);

  // Merge existing rules with results
  const allResults = useMemo(() => {
    const merged = { ...resultsMap };
    if (existingRules?.rulesMap) {
      for (const [messageId, rule] of Object.entries(existingRules.rulesMap)) {
        if (!merged[messageId]) {
          merged[messageId] = rule.map((r) => ({
            rule: r.rule,
            actionItems: r.actionItems,
            reason: r.reason,
            existing: true,
            createdAt: r.createdAt,
            status: r.status,
          }));
        }
      }
    }
    return merged;
  }, [resultsMap, existingRules]);

  const onRun = useCallback(
    async (message: Message, rerun?: boolean) => {
      setIsRunning((prev) => ({ ...prev, [message.id]: true }));

      const result = await runRulesAction(emailAccountId, {
        messageId: message.id,
        threadId: message.threadId,
        isTest: testMode,
        rerun,
      });
      if (result?.serverError) {
        toastError({
          title: "There was an error processing the email",
          description: result.serverError,
        });
      } else if (result?.data) {
        setResultsMap((prev) => ({ ...prev, [message.id]: result.data! }));
      }
      setIsRunning((prev) => ({ ...prev, [message.id]: false }));
    },
    [testMode, emailAccountId],
  );

  const handleRunAll = async () => {
    handleStart();

    // Create a queue with concurrency of 3 to maintain constant flow
    const processQueue = new PQueue({ concurrency: 3 });

    // Increment the page limit each time we run
    setCurrentPageLimit((prev) => prev + (testMode ? 1 : 10));

    for (let page = 0; page < currentPageLimit; page++) {
      // Get current data, only fetch if we don't have this page yet
      let currentData = data;
      if (!currentData?.[page]) {
        await setSize((size) => size + 1);
        currentData = await mutate();
      }

      const currentBatch = currentData?.[page]?.messages || [];

      // Filter messages that should be processed
      const messagesToProcess = currentBatch.filter((message) => {
        if (allResults[message.id]) return false;
        if (handledThreadsRef.current.has(message.threadId)) return false;
        return true;
      });

      // Add all messages to the queue for concurrent processing
      for (const message of messagesToProcess) {
        if (!isRunningAllRef.current) break;

        processQueue.add(async () => {
          if (!isRunningAllRef.current) return;

          try {
            await onRun(message);
            handledThreadsRef.current.add(message.threadId);
          } catch (error) {
            console.error(`Failed to process message ${message.id}:`, error);
            toastError({
              title: "Failed to process email",
              description: `Error processing email from ${message.headers.from}: ${error instanceof Error ? error.message : "Unknown error"}`,
            });
          }
        });
      }

      // Check if we got new data in the last request
      const lastPage = currentData?.[page];
      if (!lastPage?.nextPageToken || !isRunningAllRef.current) break;
    }

    // Wait for all queued tasks to complete
    await processQueue.onIdle();

    handleStop();
  };

  const handleStart = () => {
    setIsRunningAll(true);
    isRunningAllRef.current = true;
  };

  const handleStop = () => {
    isRunningAllRef.current = false;
    setIsRunningAll(false);
  };

  const { setInput } = useChat();

  const handleBulkStart = async (params: {
    startDate: Date;
    endDate?: Date;
    onlyUnread: boolean;
    onDiscovered: (count: number) => void;
    onProcessed: (count: number) => void;
    onComplete: (aborted: boolean) => void;
  }) => {
    setIsBulkProcessing(true);
    setBulkFetchingDone(false);
    setBulkDiscovered(0);
    setBulkProcessed(0);

    bulkAbortRef.current = await bulkOnRun(
      emailAccountId,
      {
        startDate: params.startDate,
        endDate: params.endDate,
        onlyUnread: params.onlyUnread,
      },
      {
        onDiscovered: (count) => setBulkDiscovered((total) => total + count),
        onProcessed: (count) => setBulkProcessed((total) => total + count),
      },
      (aborted: boolean) => {
        if (aborted) {
          // User cancelled
          setIsBulkProcessing(false);
          setBulkFetchingDone(false);
        } else {
          // Fetching done, but queue may still be processing
          setBulkFetchingDone(true);
        }
      },
    );

    return bulkAbortRef.current;
  };

  const handleBulkCancel = () => {
    bulkAbortRef.current?.();
    setIsBulkProcessing(false);
    setBulkFetchingDone(false);
    toastSuccess({
      description: "Processing cancelled.",
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 pb-6">
        <div className="flex items-center gap-2">
          {isRunningAll ? (
            <Button onClick={handleStop} variant="outline" size="sm">
              <PauseIcon className="mr-2 size-4" />
              Stop
            </Button>
          ) : (
            <Button onClick={handleRunAll} size="sm">
              <BookOpenCheckIcon className="mr-2 size-4" />
              {testMode ? "Test All" : "Run on All"}
            </Button>
          )}

          {!testMode && <BulkRunRules onStart={handleBulkStart} />}
        </div>

        <div className="flex items-center gap-2">
          {hasAiRules && testMode && (
            <Button
              variant="ghost"
              onClick={() => setShowCustomForm((show) => !show)}
              size="sm"
            >
              <PenSquareIcon className="mr-2 size-4" />
              Custom
            </Button>
          )}
          <SearchForm
            defaultQuery={searchQuery || undefined}
            onSearch={setSearchQuery}
          />
        </div>
      </div>

      {/* Bulk processing progress display */}
      {isBulkProcessing && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
          <div className="flex items-center justify-between">
            <div>
              <SectionDescription className="mt-0">
                Discovered: {bulkDiscovered} emails
                <br />
                Queued for processing: {bulkProcessed}
                <br />
                Processing: {queue.size} remaining in queue
              </SectionDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleBulkCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {hasAiRules && showCustomForm && testMode && (
        <div className="my-2">
          <TestCustomEmailForm />
        </div>
      )}

      <LoadingContent loading={isLoading} error={error}>
        {messages.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No emails found
          </div>
        ) : (
          <Card>
            <Table>
              <TableBody>
                {messages.map((message) => (
                  <ProcessRulesRow
                    key={message.id}
                    message={message}
                    userEmail={userEmail}
                    isRunning={isRunning[message.id]}
                    results={allResults[message.id]}
                    onRun={(rerun) => onRun(message, rerun)}
                    testMode={testMode}
                    setInput={setInput}
                  />
                ))}
              </TableBody>
            </Table>

            <div className="mx-4 mb-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={onLoadMore}
                loading={isValidating}
                disabled={!hasMore || isValidating}
              >
                {!isValidating && <ChevronsDownIcon className="mr-2 size-4" />}
                {isValidating
                  ? "Loading..."
                  : hasMore
                    ? "Load More"
                    : "No More Messages"}
              </Button>
            </div>
          </Card>
        )}
      </LoadingContent>
    </div>
  );
}

function ProcessRulesRow({
  message,
  userEmail,
  isRunning,
  results,
  onRun,
  testMode,
  setInput,
}: {
  message: Message;
  userEmail: string;
  isRunning: boolean;
  results: RunRulesResult[];
  onRun: (rerun?: boolean) => void;
  testMode: boolean;
  setInput: (input: string) => void;
}) {
  return (
    <TableRow
      className={
        isRunning ? "animate-pulse bg-blue-50 dark:bg-blue-950/20" : undefined
      }
    >
      <TableCell>
        <div className="flex items-center justify-between">
          <EmailMessageCell
            sender={message.headers.from}
            subject={message.headers.subject}
            snippet={message.snippet}
            userEmail={userEmail}
            threadId={message.threadId}
            messageId={message.id}
            labelIds={message.labelIds}
          />
          <div className="ml-4 flex items-center gap-1">
            {results ? (
              <>
                <ResultsDisplay results={results} />
                <FixWithChat
                  setInput={setInput}
                  message={message}
                  results={results}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isRunning}
                  onClick={() => onRun(true)}
                >
                  <RefreshCcwIcon
                    className={cn("mr-2 size-4", isRunning && "animate-spin")}
                  />
                  <span>{testMode ? "Retest" : "Rerun"}</span>
                </Button>
              </>
            ) : (
              <Button
                variant="default"
                size="sm"
                loading={isRunning}
                onClick={() => onRun()}
              >
                {!isRunning && <SparklesIcon className="mr-2 size-4" />}
                {testMode ? "Test" : "Run"}
              </Button>
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
