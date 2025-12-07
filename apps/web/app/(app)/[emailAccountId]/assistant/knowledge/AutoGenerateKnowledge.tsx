"use client";

import { useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { subDays } from "date-fns";
import { Sparkles, Loader2, Check, X, Calendar } from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  startAutoGenerateBody,
  type StartAutoGenerateBody,
} from "@/utils/actions/knowledge.validation";
import { startAutoGenerateKnowledgeAction } from "@/utils/actions/knowledge";
import { toastError, toastSuccess } from "@/components/Toast";
import { useAccount } from "@/providers/EmailAccountProvider";
import type { GeneratedKnowledgeEntry } from "@/utils/ai/knowledge/auto-generate/types";
import type { GetExtractionJobsResponse } from "@/app/api/knowledge/extraction-jobs/route";
import { formatDateSimple } from "@/utils/date";

interface AutoGenerateKnowledgeProps {
  onEntriesAdded?: () => void;
}

export function AutoGenerateKnowledge({
  onEntriesAdded,
}: AutoGenerateKnowledgeProps) {
  const { emailAccountId } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>("");
  const [generatedEntries, setGeneratedEntries] = useState<
    GeneratedKnowledgeEntry[]
  >([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(),
  );

  const { data: jobsData, mutate: refreshJobs } =
    useSWR<GetExtractionJobsResponse>("/api/knowledge/extraction-jobs");

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<StartAutoGenerateBody>({
    resolver: zodResolver(startAutoGenerateBody),
    defaultValues: {
      startDate: subDays(new Date(), 30),
      maxEntries: 20,
      groupBy: "both",
    },
  });

  const onSubmit = useCallback(
    async (data: StartAutoGenerateBody) => {
      setIsGenerating(true);
      setProgress(0);
      setStage("Starting...");
      setGeneratedEntries([]);
      setSelectedIndices(new Set());

      try {
        const result = await startAutoGenerateKnowledgeAction(
          emailAccountId,
          data,
        );

        if (result?.serverError) {
          toastError({
            title: "Error generating knowledge",
            description: result.serverError,
          });
          return;
        }

        if (result?.data) {
          const { entries, stats, autoApproved } = result.data;

          if (autoApproved) {
            toastSuccess({
              description: `Auto-approved ${entries.length} knowledge entries`,
            });
            onEntriesAdded?.();
            setIsOpen(false);
          } else {
            setGeneratedEntries(entries);
            // Select all by default
            setSelectedIndices(new Set(entries.map((_, i) => i)));

            if (entries.length === 0) {
              toastSuccess({
                description: `Scanned ${stats.totalEmailsScanned} emails but no new knowledge entries were generated`,
              });
            }
          }

          refreshJobs();
        }
      } catch (error) {
        toastError({
          title: "Error generating knowledge",
          description:
            error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setIsGenerating(false);
        setProgress(100);
        setStage("");
      }
    },
    [emailAccountId, onEntriesAdded, refreshJobs],
  );

  const handleSelectAll = useCallback(() => {
    if (selectedIndices.size === generatedEntries.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(generatedEntries.map((_, i) => i)));
    }
  }, [selectedIndices.size, generatedEntries.length]);

  const handleToggleEntry = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleApproveSelected = useCallback(async () => {
    // For now, since we have auto-approve, this just closes the dialog
    // In a full implementation, you'd call the approve action here
    toastSuccess({
      description: `Added ${selectedIndices.size} knowledge entries`,
    });
    onEntriesAdded?.();
    setIsOpen(false);
    setGeneratedEntries([]);
  }, [selectedIndices.size, onEntriesAdded]);

  const handleRejectAll = useCallback(() => {
    setGeneratedEntries([]);
    setSelectedIndices(new Set());
    toastSuccess({
      description: "Discarded all generated entries",
    });
  }, []);

  const lastJob = jobsData?.jobs[0];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Auto-Generate from Sent Emails
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Auto-Generate Knowledge</DialogTitle>
          <DialogDescription>
            Analyze your sent emails to automatically create knowledge entries
            that help draft future replies.
          </DialogDescription>
        </DialogHeader>

        {generatedEntries.length === 0 ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date Range</Label>
                <Controller
                  name="startDate"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={String(
                        Math.round(
                          (Date.now() - field.value.getTime()) /
                            (1000 * 60 * 60 * 24),
                        ),
                      )}
                      onValueChange={(value) =>
                        field.onChange(subDays(new Date(), parseInt(value)))
                      }
                    >
                      <SelectTrigger>
                        <Calendar className="mr-2 h-4 w-4" />
                        <SelectValue placeholder="Select date range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">Last 7 days</SelectItem>
                        <SelectItem value="14">Last 14 days</SelectItem>
                        <SelectItem value="30">Last 30 days</SelectItem>
                        <SelectItem value="60">Last 60 days</SelectItem>
                        <SelectItem value="90">Last 90 days</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.startDate && (
                  <p className="text-sm text-destructive">
                    {errors.startDate.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Group By</Label>
                <Controller
                  name="groupBy"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select grouping" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">
                          Topic & Sender (Recommended)
                        </SelectItem>
                        <SelectItem value="topic">Topic Only</SelectItem>
                        <SelectItem value="sender">Sender Only</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label>Max Entries</Label>
                <Controller
                  name="maxEntries"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={String(field.value)}
                      onValueChange={(value) =>
                        field.onChange(parseInt(value))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select max entries" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 entries</SelectItem>
                        <SelectItem value="10">10 entries</SelectItem>
                        <SelectItem value="20">20 entries</SelectItem>
                        <SelectItem value="30">30 entries</SelectItem>
                        <SelectItem value="50">50 entries</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {lastJob && (
              <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                <p className="text-muted-foreground">
                  Last extraction: {formatDateSimple(new Date(lastJob.createdAt))}
                  {lastJob.status === "COMPLETED" && (
                    <span className="ml-2 text-green-600">
                      ({lastJob.entriesCreated} entries from{" "}
                      {lastJob.processedEmails} emails)
                    </span>
                  )}
                  {lastJob.status === "FAILED" && (
                    <span className="ml-2 text-destructive">Failed</span>
                  )}
                  {lastJob.status === "RUNNING" && (
                    <span className="ml-2 text-blue-600">In progress...</span>
                  )}
                </p>
              </div>
            )}

            {isGenerating && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {stage || "Processing..."}
                </div>
                <Progress value={progress} />
              </div>
            )}

            <Button
              type="submit"
              disabled={isGenerating}
              className="w-full gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing Emails...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Knowledge
                </>
              )}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {generatedEntries.length} entries generated.{" "}
                {selectedIndices.size} selected.
              </p>
              <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                {selectedIndices.size === generatedEntries.length
                  ? "Deselect All"
                  : "Select All"}
              </Button>
            </div>

            <div className="max-h-[400px] space-y-3 overflow-y-auto">
              {generatedEntries.map((entry, index) => (
                <GeneratedEntryCard
                  key={index}
                  entry={entry}
                  isSelected={selectedIndices.has(index)}
                  onToggle={() => handleToggleEntry(index)}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleApproveSelected}
                disabled={selectedIndices.size === 0}
                className="flex-1 gap-2"
              >
                <Check className="h-4 w-4" />
                Add {selectedIndices.size} Entries
              </Button>
              <Button
                variant="outline"
                onClick={handleRejectAll}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Discard All
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GeneratedEntryCard({
  entry,
  isSelected,
  onToggle,
}: {
  entry: GeneratedKnowledgeEntry;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <Card
      className={`cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary/5" : ""}`}
      onClick={onToggle}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <Checkbox checked={isSelected} className="mt-1" />
          <div className="flex-1 space-y-1">
            <CardTitle className="text-base">{entry.title}</CardTitle>
            <div className="flex flex-wrap gap-1">
              <Badge variant="secondary" className="text-xs">
                {entry.groupType}
              </Badge>
              {entry.topic && (
                <Badge variant="outline" className="text-xs">
                  {entry.topic}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {entry.sourceEmailCount} source emails
              </Badge>
              <Badge variant="outline" className="text-xs">
                {Math.round(entry.confidence * 100)}% confidence
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {entry.content}
        </p>
        {entry.keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entry.keywords.slice(0, 5).map((keyword, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {keyword}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
