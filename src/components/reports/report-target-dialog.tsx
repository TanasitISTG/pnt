import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { REPORT_REASON_KEYS, REPORT_REASONS, isReportReason } from "@/lib/reports/reasons";
import type { ReportReason } from "@/lib/reports/reasons";
import { REPORT_DETAILS_MAX_LENGTH } from "@/lib/reports/schemas";

export interface ReportSubmission {
  reason: ReportReason;
  details?: string;
}

const DETAILS_ERROR_ID = "report-details-error";

export interface ReportTargetDialogProps {
  open: boolean;
  /** The dialog heading, e.g. "Report this comment?". */
  title: string;
  /** What an operator does with the report, written for this target. */
  description: ReactNode;
  /** The reported words, quoted above the form; omitted when it is a novel. */
  preview?: string | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (submission: ReportSubmission) => void;
}

/**
 * Collects what a report needs and a bare button cannot express: which rule was broken,
 * and what an operator should look at.
 *
 * One dialog serves every target - a novel, a comment, a review - because the vocabulary
 * and the questions are the same; only the heading, the explanation, and the quoted words
 * differ, and the caller supplies those. The form lives here while the request lives in
 * the component that opens it, so a report that fails to send leaves the dialog open with
 * the answers still in it instead of discarding them behind an error toast.
 */
export function ReportTargetDialog({
  open,
  title,
  description,
  preview,
  busy = false,
  onOpenChange,
  onConfirm,
}: ReportTargetDialogProps) {
  const t = useTranslations("reports");
  const tCommon = useTranslations("common");
  const reasonItems: Record<string, string> = Object.fromEntries(
    REPORT_REASONS.map((entry) => [entry, t(REPORT_REASON_KEYS[entry])]),
  );
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  const chosenReason = isReportReason(reason) ? reason : null;
  const trimmedDetails = details.trim();
  const needsDetails = chosenReason === "other";
  const missingDetails = needsDetails && trimmedDetails.length === 0;
  const canSubmit = !busy && chosenReason !== null && !missingDetails;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {preview ? (
          <blockquote className="rounded-lg border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words text-muted-foreground">
            {preview.length > 500 ? `${preview.slice(0, 497)}...` : preview}
          </blockquote>
        ) : null}

        <Field>
          <FieldLabel htmlFor="report-reason">{t("reasonLabel")}</FieldLabel>
          <Select
            value={reason}
            items={reasonItems}
            onValueChange={(nextValue) => setReason(nextValue ?? "")}
          >
            <SelectTrigger id="report-reason" aria-label={t("reasonLabel")} className="w-full">
              <SelectValue placeholder={t("reasonPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(reasonItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("reasonDescription")}</FieldDescription>
        </Field>

        <Field data-invalid={missingDetails || undefined}>
          <FieldLabel htmlFor="report-details">{t("detailsLabel")}</FieldLabel>
          <Textarea
            id="report-details"
            value={details}
            maxLength={REPORT_DETAILS_MAX_LENGTH}
            placeholder={t("detailsPlaceholder")}
            aria-invalid={missingDetails}
            aria-describedby={missingDetails ? DETAILS_ERROR_ID : undefined}
            onChange={(event) => setDetails(event.target.value)}
          />
          <FieldDescription className="flex items-center justify-between">
            <span>{needsDetails ? t("detailsRequired") : t("detailsOptional")}</span>
            <span className="ml-3 shrink-0 tabular-nums">
              {details.length}/{REPORT_DETAILS_MAX_LENGTH}
            </span>
          </FieldDescription>
          {missingDetails ? (
            <FieldError id={DETAILS_ERROR_ID}>{t("detailsError")}</FieldError>
          ) : null}
        </Field>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit || !chosenReason) return;
              onConfirm({ reason: chosenReason, details: trimmedDetails || undefined });
            }}
          >
            {busy && <Spinner />}
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
