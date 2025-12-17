// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import React from "react";
import { BulkRunRules } from "./BulkRunRules";

// Mock dependencies
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
    type,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    type?: string;
    variant?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      data-loading={loading}
      data-variant={variant}
      type={(type as "button" | "submit" | "reset") || "button"}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/Typography", () => ({
  SectionDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="section-description">{children}</p>
  ),
}));

vi.mock("@/components/LoadingContent", () => ({
  LoadingContent: ({
    loading,
    error,
    children,
  }: {
    loading: boolean;
    error?: Error;
    children: React.ReactNode;
  }) => {
    if (loading) return <div data-testid="loading">Loading...</div>;
    if (error) return <div data-testid="error">{error.message}</div>;
    return <>{children}</>;
  },
}));

vi.mock("@/components/PremiumAlert", () => ({
  PremiumAlertWithData: () => (
    <div data-testid="premium-alert">Premium required</div>
  ),
  usePremium: () => ({
    hasAiAccess: true,
    isLoading: false,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div
      data-testid="dialog"
      data-open={open}
      onClick={() => onOpenChange(!open)}
      onKeyDown={(e) => e.key === "Enter" && onOpenChange(!open)}
      role="button"
      tabIndex={0}
    >
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-trigger">{children}</div>
  ),
}));

vi.mock("@/app/(app)/[emailAccountId]/assistant/SetDateDropdown", () => ({
  SetDateDropdown: ({
    onChange,
    placeholder,
    disabled,
  }: {
    onChange: (date: Date | undefined) => void;
    placeholder: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid={`date-dropdown-${placeholder}`}
      onClick={() => onChange(new Date("2024-01-01"))}
      disabled={disabled}
    >
      {placeholder}
    </button>
  ),
}));

vi.mock("@/hooks/useThreads", () => ({
  useThreads: () => ({
    data: { threads: [] },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/store/ai-queue", () => ({
  useAiQueueState: () => ({
    size: 5,
  }),
}));

vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => ({
    emailAccountId: "test-account-id",
  }),
}));

vi.mock("@/components/Toast", () => ({
  toastError: vi.fn(),
}));

// Mock the fetch functions - use vi.hoisted to avoid initialization order issues
vi.mock("@/utils/fetch", () => ({
  fetchWithAccount: vi.fn(),
}));

vi.mock("@/utils/queue/email-actions", () => ({
  runAiRules: vi.fn(),
}));

vi.mock("@/utils/sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

describe("BulkRunRules Component", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { fetchWithAccount } = await import("@/utils/fetch");
    mockFetch = vi.mocked(fetchWithAccount);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("Initialization and State", () => {
    it("should initialize progress tracking states correctly", () => {
      render(<BulkRunRules />);

      // Component should render without progress display initially
      expect(screen.queryByText(/Discovered:/)).not.toBeTruthy();
      expect(screen.queryByText(/Queued for processing:/)).not.toBeTruthy();
      expect(screen.queryByText(/Processing:/)).not.toBeTruthy();
    });

    it("should initialize with onlyUnread checkbox checked by default", () => {
      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toHaveProperty("checked", true);
    });

    it("should initialize with no start or end date selected", () => {
      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      // Button should be disabled when no start date is set
      const processButton = screen.getByText("Process Emails");
      expect(processButton).toHaveProperty("disabled", true);
    });
  });

  describe("Progress Display", () => {
    it("should correctly display progress based on discovered, processed, and queued counts", async () => {
      // Mock fetch to return threads
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [
            { id: "thread1", plan: null },
            { id: "thread2", plan: null },
            { id: "thread3", plan: { ruleId: "rule1" } }, // Has plan, won't be processed
          ],
          nextPageToken: null,
        }),
      });

      render(<BulkRunRules />);

      // Open dialog
      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      // Set start date
      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      // Click process button
      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Wait for progress to appear
      await waitFor(() => {
        expect(screen.getByText(/Discovered:/)).toBeTruthy();
      });

      // Should show discovered count (all threads)
      expect(screen.getByText(/Discovered: 3 emails/)).toBeTruthy();

      // Should show processed count (threads without plans)
      expect(screen.getByText(/Queued for processing: 2/)).toBeTruthy();

      // Should show queue size from store
      expect(screen.getByText(/Processing: 5 remaining in queue/)).toBeTruthy();
    });

    it("should show progress only when running is true", async () => {
      render(<BulkRunRules />);

      // Open dialog
      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      // Progress should not be visible initially
      expect(screen.queryByText(/Discovered:/)).not.toBeTruthy();

      // Set start date and start processing
      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [],
          nextPageToken: null,
        }),
      });

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Progress should now be visible
      await waitFor(() => {
        expect(screen.getByText(/Discovered:/)).toBeTruthy();
      });
    });

    it("should reset progress counts when starting a new run", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [{ id: "thread1", plan: null }],
          nextPageToken: null,
        }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      // First run
      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      await waitFor(() => {
        expect(screen.getByText(/Discovered: 1 emails/)).toBeTruthy();
      });

      // Wait for completion
      await waitFor(() => {
        expect(processButton).not.toHaveProperty("disabled", true);
      });

      // Second run should reset counts
      fireEvent.click(processButton);

      // Counts should reset (not accumulate)
      await waitFor(() => {
        expect(screen.getByText(/Discovered: 1 emails/)).toBeTruthy();
      });
    });
  });

  describe("onRun Callback Functionality", () => {
    it("should call onDiscovered callback with correct number of discovered threads", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [
            { id: "thread1", plan: null },
            { id: "thread2", plan: null },
            { id: "thread3", plan: null },
            { id: "thread4", plan: { ruleId: "rule1" } },
          ],
          nextPageToken: null,
        }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Should discover all 4 threads
      await waitFor(() => {
        expect(screen.getByText(/Discovered: 4 emails/)).toBeTruthy();
      });
    });

    it("should call onProcessed callback with correct number of processed threads", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [
            { id: "thread1", plan: null },
            { id: "thread2", plan: null },
            { id: "thread3", plan: { ruleId: "rule1" } }, // Has plan
            { id: "thread4", plan: { ruleId: "rule2" } }, // Has plan
          ],
          nextPageToken: null,
        }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Should only process threads without plans (2 threads)
      await waitFor(() => {
        expect(screen.getByText(/Queued for processing: 2/)).toBeTruthy();
      });
    });

    it("should accumulate counts across multiple pages", async () => {
      // First page returns threads with nextPageToken
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            threads: [
              { id: "thread1", plan: null },
              { id: "thread2", plan: null },
            ],
            nextPageToken: "page2",
          }),
        })
        // Second page returns more threads without nextPageToken
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            threads: [
              { id: "thread3", plan: null },
              { id: "thread4", plan: { ruleId: "rule1" } },
            ],
            nextPageToken: null,
          }),
        });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Should accumulate across pages: 2 + 2 = 4 discovered
      await waitFor(() => {
        expect(screen.getByText(/Discovered: 4 emails/)).toBeTruthy();
      });

      // Should accumulate processed: 2 + 1 = 3 (excluding thread4 with plan)
      expect(screen.getByText(/Queued for processing: 3/)).toBeTruthy();
    });
  });

  describe("onlyUnread Filter", () => {
    it("should correctly filter threads when onlyUnread is true", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [{ id: "thread1", plan: null }],
          nextPageToken: null,
        }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      // onlyUnread is true by default
      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Verify fetch was called with isUnread parameter
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.objectContaining({
            url: expect.stringContaining("isUnread=true"),
            emailAccountId: "test-account-id",
          }),
        );
      });
    });

    it("should not include isUnread filter when onlyUnread is false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [{ id: "thread1", plan: null }],
          nextPageToken: null,
        }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      // Uncheck onlyUnread
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Verify fetch was NOT called with isUnread parameter
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.objectContaining({
            url: expect.not.stringContaining("isUnread=true"),
            emailAccountId: "test-account-id",
          }),
        );
      });
    });

    it("should disable onlyUnread checkbox while running", async () => {
      // Mock fetch to delay response
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({
                  threads: [],
                  nextPageToken: null,
                }),
              });
            }, 100);
          }),
      );

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Checkbox should be disabled while running
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toHaveProperty("disabled", true);

      // Wait for completion
      await waitFor(() => {
        expect(checkbox).not.toHaveProperty("disabled", true);
      });
    });
  });

  describe("Deduplication", () => {
    it("should not process duplicate threads across pages", async () => {
      // Return same thread IDs on both pages (simulating API behavior)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            threads: [
              { id: "thread1", plan: null },
              { id: "thread2", plan: null },
            ],
            nextPageToken: "page2",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            threads: [
              { id: "thread1", plan: null }, // Duplicate
              { id: "thread3", plan: null },
            ],
            nextPageToken: null,
          }),
        });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      await waitFor(() => {
        // Discovered: 2 + 2 = 4 (counts all fetched, including duplicate)
        expect(screen.getByText(/Discovered: 4 emails/)).toBeTruthy();
      });

      // Processed: 2 + 1 = 3 (deduplicates thread1, so only processes 3 unique threads)
      expect(screen.getByText(/Queued for processing: 3/)).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      const { toastError } = await import("@/components/Toast");

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to fetch emails",
          }),
        );
      });
    });

    it("should stop processing when abort is called", async () => {
      // First call returns nextPageToken, second call should not happen
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          threads: [{ id: "thread1", plan: null }],
          nextPageToken: "page2",
        }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      // Wait for first batch to process
      await waitFor(() => {
        expect(screen.getByText(/Discovered: 1 emails/)).toBeTruthy();
      });

      // Click cancel button
      const cancelButton = screen.getByText("Cancel");
      fireEvent.click(cancelButton);

      // Should not make second API call (only 1 call total)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Date Range Selection", () => {
    it("should include date range in API request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          threads: [],
          nextPageToken: null,
        }),
      });

      render(<BulkRunRules />);

      const dialogTrigger = screen.getByTestId("dialog-trigger");
      fireEvent.click(dialogTrigger);

      // Set both start and end dates
      const startDateButton = screen.getByTestId(
        "date-dropdown-Set start date",
      );
      fireEvent.click(startDateButton);

      const endDateButton = screen.getByTestId(
        "date-dropdown-Set end date (optional)",
      );
      fireEvent.click(endDateButton);

      const processButton = screen.getByText("Process Emails");
      fireEvent.click(processButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.objectContaining({
            url: expect.stringMatching(/after=.*&before=/),
          }),
        );
      });
    });
  });
});
