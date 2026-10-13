import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import {
  describeReportReason,
  describeReportTarget,
  type ReportDecision,
} from "@/lib/reports/reasons";
import { REPORT_NOTE_MAX_LENGTH } from "@/lib/reports/schemas";
import type { ReportCase } from "@/lib/reports/types";

export interface ReportCaseDecisionSubmission {
  decision: ReportDecision;
  note?: string;
}

export interface ReportContentRemovalSubmission {
  reason: string;
}

export interface ReportCaseDialogProps {
  open: boolean;
  reportCase: ReportCase | null;
  busy: boolean;
  /** In flight while the reported content is being taken down. */
  removing?: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (submission: ReportCaseDecisionSubmission) => void;
  /** Only sent for a comment or review case; a novel is enforced through its own controls. */
  onRemove?: (submission: ReportContentRemovalSubmission) => void;
}

/**
 * One case, end to end: every open report on a target, and the decision that closes all of
 * them at once.
 *
 * The decision is a status and a note, never an enforcement step - the copy says so
 * because an operator who expected the content to come down would otherwise trust a
 * decision that only recorded their intent. Taking a comment or review down is its own
 * deliberate, audited action beside it, and it needs a reason of its own so the author
 * can be told why.
 *
 * The page remounts this per case (keyed by case key), which is how the note starts empty
 * for every case without an effect that clears it.
 */
export function ReportCaseDialog({
  open,
  reportCase,
  busy,
  removing = false,
  onOpenChange,
  onResolve,
  onRemove,
}: ReportCaseDialogProps) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ReportDecision | null>(null);
  const [removalOpen, setRemovalOpen] = useState(false);
  const [removalReason, setRemovalReason] = useState("");

  const trimmed = note.trim();
  const trimmedRemoval = removalReason.trim();
  const target = reportCase?.target ?? null;
  const removable = target !== null && target.type !== "novel" && !target.deleted;
  const alreadyRemoved = target?.removedAt !== null && target?.removedAt !== undefined;

  const submit = (decision: ReportDecision) => {
    setPending(decision);
    onResolve({ decision, note: trimmed ? trimmed : undefined });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPending(null);
          setRemovalOpen(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target
              ? `Reported ${describeReportTarget(target.type).toLowerCase()}`
              : "Reported content"}
          </DialogTitle>
          <DialogDescription>
            {reportCase ? (
              <>
                {reportCase.openCount === 1
                  ? "One open report on"
                  : `${reportCase.openCount} open reports on`}{" "}
                <span className="font-medium text-foreground">{reportCase.target.title}</span>
                {reportCase.target.type === "novel" && reportCase.target.ownerEmail
                  ? ` by ${reportCase.target.ownerEmail}`
                  : null}
                {reportCase.target.type !== "novel" && reportCase.target.authorEmail
                  ? ` — written by ${reportCase.target.authorEmail}`
                  : null}
                . The decision below is recorded on every one of them; it does not suspend the
                account or take the content down.
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
            {reportCase.target.type !== "novel" ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">Reported content</span>
                  {alreadyRemoved ? <Badge variant="muted">Removed</Badge> : null}
                  {reportCase.target.deleted ? <Badge variant="muted">Deleted</Badge> : null}
                </div>
                <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
                  {reportCase.target.excerpt ?? "The reported words are no longer available."}
                </p>
                {reportCase.target.chapterId && reportCase.target.novelId ? (
                  <Link
                    className="text-caption underline underline-offset-4"
                    to="/novels/$novelId/chapters/$chapterId"
                    params={{
                      novelId: reportCase.target.novelId,
                      chapterId: reportCase.target.chapterId,
                    }}
                  >
                    Open the chapter
                  </Link>
                ) : null}

                {removable && onRemove ? (
                  alreadyRemoved ? (
                    <p className="text-caption text-muted-foreground">
                      This content has already been removed; the decision still needs recording.
                    </p>
                  ) : removalOpen ? (
                    <div className="flex flex-col gap-2 pt-1">
                      <Field>
                        <FieldLabel htmlFor="report-removal-reason">Reason for removal</FieldLabel>
                        <Textarea
                          id="report-removal-reason"
                          value={removalReason}
                          maxLength={REPORT_NOTE_MAX_LENGTH}
                          placeholder="What breaks the rules, in a sentence."
                          onChange={(event) => setRemovalReason(event.target.value)}
                        />
                        <FieldDescription>
                          Stored with the author's notice and in the activity trail.
                        </FieldDescription>
                      </Field>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={removing}
                          onClick={() => setRemovalOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={removing || trimmedRemoval.length === 0}
                          onClick={() => {
                            if (trimmedRemoval.length === 0) return;
                            onRemove({ reason: trimmedRemoval });
                          }}
                        >
                          {removing ? <Spinner /> : null}
                          Remove content
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end pt-1">
                      <Button
                        variant="outlineDestructiveStrong"
                        size="sm"
                        onClick={() => setRemovalOpen(true)}
                      >
                        Remove content…
                      </Button>
                    </div>
                  )
                ) : null}
              </div>
            ) : null}

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
          <Button variant="outline" disabled={busy || removing} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" disabled={busy || removing} onClick={() => submit("dismissed")}>
            {busy && pending === "dismissed" ? <Spinner /> : null}
            Dismiss
          </Button>
          <Button
            variant="default"
            disabled={busy || removing || !trimmed}
            onClick={() => submit("upheld")}
          >
            {busy && pending === "upheld" ? <Spinner /> : null}
            Uphold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
