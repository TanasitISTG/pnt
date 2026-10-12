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
import { REPORT_REASONS, describeReportReason, isReportReason } from "@/lib/reports/reasons";
import type { ReportReason } from "@/lib/reports/reasons";
import { REPORT_DETAILS_MAX_LENGTH } from "@/lib/reports/schemas";

export interface ReportSubmission {
  reason: ReportReason;
  details?: string;
}

/** The select reads the same vocabulary the operator queue filters on, so they cannot drift. */
const REASON_ITEMS: Record<string, string> = Object.fromEntries(
  REPORT_REASONS.map((reason) => [reason, describeReportReason(reason)]),
);

const DETAILS_ERROR_ID = "report-details-error";

export interface ReportNovelDialogProps {
  open: boolean;
  novelTitle: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (submission: ReportSubmission) => void;
}

/**
 * Collects what a report needs and a bare button cannot express: which rule was broken,
 * and what an operator should look at.
 *
 * The form lives here while the request lives in the button that opens it, so a report
 * that fails to send leaves the dialog open with the answers still in it instead of
 * discarding them behind an error toast.
 */
export function ReportNovelDialog({
  open,
  novelTitle,
  busy = false,
  onOpenChange,
  onConfirm,
}: ReportNovelDialogProps) {
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
          <DialogTitle>Report this novel?</DialogTitle>
          <DialogDescription>
            An operator reviews every report about “{novelTitle}”. The report records which account
            filed it, the author is not shown who reported it, and nothing about the novel changes
            until an operator decides.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="report-reason">Reason</FieldLabel>
          <Select
            value={reason}
            items={REASON_ITEMS}
            onValueChange={(nextValue) => setReason(nextValue ?? "")}
          >
            <SelectTrigger id="report-reason" aria-label="Reason" className="w-full">
              <SelectValue placeholder="Choose a reason" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(REASON_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Pick the closest match; the field below carries the detail.
          </FieldDescription>
        </Field>

        <Field data-invalid={missingDetails || undefined}>
          <FieldLabel htmlFor="report-details">What is wrong?</FieldLabel>
          <Textarea
            id="report-details"
            value={details}
            maxLength={REPORT_DETAILS_MAX_LENGTH}
            placeholder="Describe the problem — a chapter number or a source link helps."
            aria-invalid={missingDetails}
            aria-describedby={missingDetails ? DETAILS_ERROR_ID : undefined}
            onChange={(event) => setDetails(event.target.value)}
          />
          <FieldDescription className="flex items-center justify-between">
            <span>
              {needsDetails
                ? "Required when the reason is “Something else”."
                : "Optional. Anything an operator should check first."}
            </span>
            <span className="ml-3 shrink-0 tabular-nums">
              {details.length}/{REPORT_DETAILS_MAX_LENGTH}
            </span>
          </FieldDescription>
          {missingDetails ? (
            <FieldError id={DETAILS_ERROR_ID}>
              Tell us what is wrong so an operator can act on it
            </FieldError>
          ) : null}
        </Field>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit || !chosenReason) return;
              onConfirm({ reason: chosenReason, details: trimmedDetails || undefined });
            }}
          >
            {busy && <Spinner />}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
