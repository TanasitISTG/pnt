import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/query-error-state";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveReportCase } from "@/lib/reports/functions";
import { reportCaseQueueQueryOptions, reportHistoryQueryOptions } from "@/lib/reports/query";
import { REPORT_CASE_PAGE_SIZE, type ReportQueueSearch } from "@/lib/reports/schemas";
import type { ReportCase } from "@/lib/reports/types";

import { ReportCaseDialog, type ReportCaseDecisionSubmission } from "./report-case-dialog";
import { ReportCaseTable } from "./report-case-table";
import { ReportHistoryTable } from "./report-history-table";

export interface ReportsPageProps {
  search: ReportQueueSearch;
  onSearchChange: (patch: Partial<ReportQueueSearch>) => void;
}

/**
 * The reporting queue.
 *
 * Work is grouped into one case per novel, so an operator decides once and every open
 * report on that novel moves with them. Only the visible tab is fetched: the queue and
 * the trail are different questions, and nothing on this page needs both at once.
 */
export function ReportsPage({ search, onSearchChange }: ReportsPageProps) {
  const queryClient = useQueryClient();
  const tab = search.tab ?? "open";
  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? REPORT_CASE_PAGE_SIZE;

  const queueQuery = useQuery({ ...reportCaseQueueQueryOptions(search), enabled: tab === "open" });
  const historyQuery = useQuery({
    ...reportHistoryQueryOptions(search),
    enabled: tab === "history",
  });

  const [pendingCase, setPendingCase] = useState<ReportCase | null>(null);
  const [busy, setBusy] = useState(false);

  const resolve = async (submission: ReportCaseDecisionSubmission) => {
    const target = pendingCase;
    if (!target) return;

    setBusy(true);
    try {
      await resolveReportCase({
        data: {
          caseKey: target.caseKey,
          decision: submission.decision,
          note: submission.note,
        },
      });
      toast.success(submission.decision === "upheld" ? "Case upheld." : "Case dismissed.");
      // The decision also writes an audit row and moves cases between the two tabs, so
      // the whole report key is refreshed rather than the queue alone.
      await queryClient.invalidateQueries({ queryKey: ["reportQueue"] });
      setPendingCase(null);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "That decision did not go through");
    } finally {
      setBusy(false);
    }
  };

  const changePage = (next: number) => {
    onSearchChange({ page: next <= 1 ? undefined : next });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-sub font-semibold tracking-tight text-foreground sm:text-section">
            Reports
          </h1>
          <p className="mt-1 text-body text-muted-foreground">
            Member reports, grouped into one case per novel. A decision closes every open report on
            the case and is recorded in the activity trail.
          </p>
        </div>
        <div className="relative sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            type="search"
            value={search.q ?? ""}
            placeholder="Search novel or owner"
            aria-label="Search reports"
            onChange={(event) =>
              // Any change to the query invalidates the current offset, so paging
              // resets with the search rather than pointing past the new result set.
              onSearchChange({ q: event.target.value || undefined, page: undefined })
            }
          />
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(next) =>
          onSearchChange({
            tab: next === "open" ? undefined : "history",
            page: undefined,
          })
        }
      >
        <TabsList aria-label="Report views">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="history">Decided</TabsTrigger>
        </TabsList>

        <TabsContent value="open">
          {queueQuery.isError ? (
            <QueryErrorState
              title="Failed to load reports"
              error={queueQuery.error}
              onRetry={() => void queueQuery.refetch()}
              className="min-h-[40vh]"
            />
          ) : (
            <ReportCaseTable
              cases={queueQuery.data?.cases ?? []}
              rowCount={queueQuery.data?.rowCount ?? 0}
              page={page}
              pageSize={pageSize}
              isPending={queueQuery.isPending}
              searching={Boolean(search.q)}
              onPageChange={changePage}
              onReview={(reportCase) => setPendingCase(reportCase)}
            />
          )}
        </TabsContent>

        <TabsContent value="history">
          {historyQuery.isError ? (
            <QueryErrorState
              title="Failed to load reports"
              error={historyQuery.error}
              onRetry={() => void historyQuery.refetch()}
              className="min-h-[40vh]"
            />
          ) : (
            <ReportHistoryTable
              rows={historyQuery.data?.rows ?? []}
              rowCount={historyQuery.data?.rowCount ?? 0}
              page={page}
              pageSize={pageSize}
              isPending={historyQuery.isPending}
              searching={Boolean(search.q)}
              onPageChange={changePage}
            />
          )}
        </TabsContent>
      </Tabs>

      <ReportCaseDialog
        // Remounted per case and per opening, which is how its note starts empty every
        // time without an effect to reset it.
        key={`case-${pendingCase?.caseKey ?? "none"}-${pendingCase ? "open" : "closed"}`}
        open={pendingCase !== null}
        reportCase={pendingCase}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setPendingCase(null);
        }}
        onResolve={(submission) => void resolve(submission)}
      />
    </div>
  );
}
