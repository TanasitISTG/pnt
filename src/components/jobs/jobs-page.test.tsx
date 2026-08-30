// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JOB_ACTIVITY_QUERY_KEY, JOB_STATS_QUERY_KEY } from "@/lib/job-dashboard-query";

const serverFunctions = vi.hoisted(() => ({
  getJobActivity: vi.fn(),
  getJobStats: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));
vi.mock("@/lib/job-observability.functions", () => serverFunctions);

import { JobsPage } from "@/components/jobs/jobs-page";

const activity = {
  summary: {
    activeTranslationJobs: 0,
    failedTranslationJobs: 0,
    activeImportJobs: 0,
    failedImportJobs: 0,
  },
  translationJobs: [],
  importJobs: [],
};
const stats = {
  avgChunkLatencyMs: 25,
  promptTokens: 100,
  completionTokens: 200,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderJobsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  queryClient.setQueryData(JOB_ACTIVITY_QUERY_KEY, activity);
  queryClient.setQueryData(JOB_STATS_QUERY_KEY, stats);

  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading</p>}>
        <JobsPage />
      </Suspense>
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("JobsPage refresh behavior", () => {
  it("keeps the manual button enabled during automatic activity polling", async () => {
    vi.useFakeTimers();
    const activityRefresh = deferred<typeof activity>();
    serverFunctions.getJobActivity.mockReturnValueOnce(activityRefresh.promise);
    const queryClient = renderJobsPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(serverFunctions.getJobActivity).toHaveBeenCalledOnce();
    expect(serverFunctions.getJobStats).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    activityRefresh.resolve(activity);
    await act(async () => {
      await Promise.resolve();
    });
    queryClient.clear();
  });

  it("starts both manual requests and stays busy until both settle", async () => {
    const activityRefresh = deferred<typeof activity>();
    const statsRefresh = deferred<typeof stats>();
    serverFunctions.getJobActivity.mockReturnValueOnce(activityRefresh.promise);
    serverFunctions.getJobStats.mockReturnValueOnce(statsRefresh.promise);
    const queryClient = renderJobsPage();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(serverFunctions.getJobActivity).toHaveBeenCalledOnce();
      expect(serverFunctions.getJobStats).toHaveBeenCalledOnce();
    });
    expect(
      (screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    statsRefresh.resolve(stats);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      (screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    activityRefresh.resolve(activity);
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    queryClient.clear();
  });
});
