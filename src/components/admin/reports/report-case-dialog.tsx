import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { describeReportReason, type ReportDecision } from "@/lib/reports/reasons";
import { REPORT_NOTE_MAX_LENGTH } from "@/lib/reports/schemas";
import type { ReportCase } from "@/lib/reports/types";

export interface ReportCaseDecisionSubmission {
  decision: ReportDecision;
  note?: string;
}

export interface ReportCaseDialogProps {
  open: boolean;
  reportCase: ReportCase | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (submission: ReportCaseDecisionSubmission) => void;
}

/**
 * One case, end to end: every open report on a novel, and the decision that closes all
 * of them at once.
 *
 * The decision is a status and a note, never an enforcement step - the copy says so
 * because an operator who expected the novel to come down would otherwise trust a
 * decision that only recorded their intent.
 *
 * The page remounts this per case (keyed by case key), which is how the note starts
 * empty for every case without an effect that clears it.
 */
export function ReportCaseDialog({
  open,
  reportCase,
  busy,
  onOpenChange,
  onResolve,
}: ReportCaseDialogProps) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ReportDecision | null>(null);

  const trimmed = note.trim();

  const submit = (decision: ReportDecision) => {
    setPending(decision);
    onResolve({ decision, note: trimmed ? trimmed : undefined });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPending(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reported novel</DialogTitle>
          <DialogDescription>
            {reportCase ? (
              <>
                {reportCase.openCount === 1
                  ? "One open report on"
                  : `${reportCase.openCount} open reports on`}{" "}
                <span className="font-medium text-foreground">{reportCase.target.title}</span>
                {reportCase.target.ownerEmail ? ` by ${reportCase.target.ownerEmail}` : ""}. The
                decision below is recorded on every one of them; it does not suspend the account or
                unpublish the novel.
                {reportCase.target.novelId ? (
                  <>
                    {" "}
                    <Link to="/novels/$novelId" params={{ novelId: reportCase.target.novelId }}>
                      Open the novel
                    </Link>
                  </>
                ) : null}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {reportCase ? (
          <div className="flex flex-col gap-3">
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {reportCase.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {describeReportReason(entry.reason)}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {entry.details ? (
                    <p className="text-sm whitespace-normal text-muted-foreground">
                      {entry.details}
                    </p>
                  ) : (
                    <p className="text-caption text-muted-foreground">No explanation given.</p>
                  )}
                  <span className="text-caption text-muted-foreground">
                    Reported by {entry.reporterEmail ?? "an account that has been removed"}
                  </span>
                </li>
              ))}
            </ul>
            {reportCase.truncated ? (
              <p className="text-caption text-muted-foreground">
                Older reports in this case are not listed, but the decision applies to all of them.
              </p>
            ) : null}

            <Field>
              <FieldLabel htmlFor="report-decision-note">Decision note</FieldLabel>
              <Textarea
                id="report-decision-note"
                value={note}
                maxLength={REPORT_NOTE_MAX_LENGTH}
                placeholder="What you found, and what you decided."
                onChange={(event) => setNote(event.target.value)}
              />
              <FieldDescription>
                A note is required to uphold a case. It is stored with the decision and shown with
                it afterwards.
              </FieldDescription>
              <span className="text-caption text-muted-foreground">
                {note.length}/{REPORT_NOTE_MAX_LENGTH}
              </span>
            </Field>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => submit("dismissed")}>
            {busy && pending === "dismissed" ? <Spinner /> : null}
            Dismiss
          </Button>
          <Button variant="default" disabled={busy || !trimmed} onClick={() => submit("upheld")}>
            {busy && pending === "upheld" ? <Spinner /> : null}
            Uphold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
