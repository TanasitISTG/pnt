import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { ReportTargetDialog } from "@/components/reports/report-target-dialog";
import type { ReportSubmission } from "@/components/reports/report-target-dialog";
import { Button } from "@/components/ui/button";
import { createNovelReport } from "@/lib/reports/functions";
import { myNovelReportQueryOptions } from "@/lib/reports/query";
import { cn } from "@/lib/utils";

export interface ReportNovelButtonProps {
  novelId: string;
  novelTitle: string;
  className?: string;
}

/**
 * The one reporting control a reader gets, on the novel page itself.
 *
 * It owns the request rather than the dialog, so the busy state and the failure toast sit
 * with the mutation, and it asks the server whether this account already has an open
 * report: the unique index would refuse a second filing, and offering a button whose call
 * is guaranteed to fail would be worse than saying "Reported".
 */
export function ReportNovelButton({ novelId, novelTitle, className }: ReportNovelButtonProps) {
  const t = useTranslations("reports");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const report = useQuery(myNovelReportQueryOptions(novelId));

  const submit = async (submission: ReportSubmission) => {
    setBusy(true);
    try {
      await createNovelReport({
        data: {
          novelId,
          reason: submission.reason,
          details: submission.details,
        },
      });
      toast.success(t("sent"));
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["novelReport", novelId] });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  if (report.data?.report) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className={cn(className)}
        title={t("alreadyOpen")}
      >
        <Flag className="size-4" />
        {tCommon("reported")}
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" className={cn(className)} onClick={() => setOpen(true)}>
        <Flag className="size-4" />
        {tCommon("report")}
      </Button>
      {/* Mounted only while open: a second report starts from empty fields without an
          effect having to reset them. */}
      {open ? (
        <ReportTargetDialog
          open={open}
          title={t("reportNovelTitle")}
          description={t("reportNovelDescription", { title: novelTitle })}
          busy={busy}
          onOpenChange={setOpen}
          onConfirm={(submission) => void submit(submission)}
        />
      ) : null}
    </>
  );
}
