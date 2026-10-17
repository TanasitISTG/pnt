import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";

import { reportReasonLabel } from "@/components/admin/reports/report-labels";
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
import { formatDateTime } from "@/lib/i18n/format";
import type { ReportDecision } from "@/lib/reports/reasons";
import { REPORT_NOTE_MAX_LENGTH } from "@/lib/reports/schemas";
import type { ReportCase } from "@/lib/reports/types";

/**
 * The emphasis a case description puts on the target's title. It is a module-level function
 * rather than one per render because it closes over nothing: a tag renderer that is rebuilt
 * every render is a new function identity for `t.rich` to resolve.
 */
function nameTag(chunks: ReactNode) {
  return <span className="font-medium text-foreground">{chunks}</span>;
}

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
  const t = useTranslations("admin");
  const tReports = useTranslations("reports");
  const tCommon = useTranslations("common");
  const locale = useLocale();
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

  // The heading names the kind of content this case is about, which is three sentences
  // rather than one sentence with a noun dropped into it: Thai does not lowercase a noun,
  // and "Reported novel" is not a sentence any language assembles.
  const title = !target
    ? t("caseFallbackTitle")
    : target.type === "novel"
      ? t("caseTitleNovel")
      : target.type === "comment"
        ? t("caseTitleComment")
        : t("caseTitleReview");

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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {reportCase ? (
              <>
                {reportCase.target.type === "novel"
                  ? t.rich("caseDescriptionNovel", {
                      count: reportCase.openCount,
                      title: reportCase.target.title,
                      owner: reportCase.target.ownerEmail ?? t("casesAccountRemoved"),
                      name: nameTag,
                    })
                  : t.rich(
                      reportCase.target.type === "comment"
                        ? "caseDescriptionComment"
                        : "caseDescriptionReview",
                      {
                        count: reportCase.openCount,
                        title: reportCase.target.title,
                        author: reportCase.target.authorEmail ?? t("casesAccountRemoved"),
                        name: nameTag,
                      },
                    )}
                {reportCase.target.novelId ? (
                  <>
                    {" "}
                    <Link
                      to="/{-$locale}/novels/$novelId"
                      params={{ novelId: reportCase.target.novelId }}
                    >
                      {t("caseOpenNovel")}
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
                  <span className="text-sm font-medium text-foreground">
                    {t("caseReportedContent")}
                  </span>
                  {alreadyRemoved ? <Badge variant="muted">{t("caseRemoved")}</Badge> : null}
                  {reportCase.target.deleted ? (
                    <Badge variant="muted">{t("caseDeleted")}</Badge>
                  ) : null}
                </div>
                <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
                  {reportCase.target.excerpt ?? t("caseExcerptMissing")}
                </p>
                {reportCase.target.chapterId && reportCase.target.novelId ? (
                  <Link
                    className="text-caption underline underline-offset-4"
                    to="/{-$locale}/novels/$novelId/chapters/$chapterId"
                    params={{
                      novelId: reportCase.target.novelId,
                      chapterId: reportCase.target.chapterId,
                    }}
                  >
                    {t("caseOpenChapter")}
                  </Link>
                ) : null}

                {removable && onRemove ? (
                  alreadyRemoved ? (
                    <p className="text-caption text-muted-foreground">{t("caseAlreadyRemoved")}</p>
                  ) : removalOpen ? (
                    <div className="flex flex-col gap-2 pt-1">
                      <Field>
                        <FieldLabel htmlFor="report-removal-reason">
                          {t("caseRemovalReasonLabel")}
                        </FieldLabel>
                        <Textarea
                          id="report-removal-reason"
                          value={removalReason}
                          maxLength={REPORT_NOTE_MAX_LENGTH}
                          placeholder={t("caseRemovalReasonPlaceholder")}
                          onChange={(event) => setRemovalReason(event.target.value)}
                        />
                        <FieldDescription>{t("caseRemovalReasonHint")}</FieldDescription>
                      </Field>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={removing}
                          onClick={() => setRemovalOpen(false)}
                        >
                          {tCommon("cancel")}
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
                          {t("caseRemoveContent")}
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
                        {t("caseRemoveContentAction")}
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
                      {reportReasonLabel(tReports, entry.reason)}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {formatDateTime(entry.createdAt, locale)}
                    </span>
                  </div>
                  {entry.details ? (
                    <p className="text-sm whitespace-normal text-muted-foreground">
                      {entry.details}
                    </p>
                  ) : (
                    <p className="text-caption text-muted-foreground">{t("caseNoExplanation")}</p>
                  )}
                  <span className="text-caption text-muted-foreground">
                    {t("caseReportedBy", {
                      who: entry.reporterEmail ?? t("casesAccountRemoved"),
                    })}
                  </span>
                </li>
              ))}
            </ul>
            {reportCase.truncated ? (
              <p className="text-caption text-muted-foreground">{t("caseTruncated")}</p>
            ) : null}

            <Field>
              <FieldLabel htmlFor="report-decision-note">{t("caseNoteLabel")}</FieldLabel>
              <Textarea
                id="report-decision-note"
                value={note}
                maxLength={REPORT_NOTE_MAX_LENGTH}
                placeholder={t("caseNotePlaceholder")}
                onChange={(event) => setNote(event.target.value)}
              />
              <FieldDescription>{t("caseNoteHint")}</FieldDescription>
              <span className="text-caption text-muted-foreground">
                {note.length}/{REPORT_NOTE_MAX_LENGTH}
              </span>
            </Field>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy || removing} onClick={() => onOpenChange(false)}>
            {tCommon("close")}
          </Button>
          <Button variant="outline" disabled={busy || removing} onClick={() => submit("dismissed")}>
            {busy && pending === "dismissed" ? <Spinner /> : null}
            {t("caseDismiss")}
          </Button>
          <Button
            variant="default"
            disabled={busy || removing || !trimmed}
            onClick={() => submit("upheld")}
          >
            {busy && pending === "upheld" ? <Spinner /> : null}
            {t("caseUphold")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
