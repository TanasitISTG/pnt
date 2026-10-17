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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BAN_DURATION_DAYS, BAN_REASON_MAX_LENGTH } from "@/lib/admin/schemas";

/** The `admin` translator, named so the duration list can be built outside a hook. */
type AdminTranslator = ReturnType<typeof useTranslations<"admin">>;

export interface SuspendSubmission {
  banReason?: string;
  banExpiresInDays?: number;
}

const PERMANENT = "permanent";

/**
 * Durations are offered as whole days; the schema takes a day count and the endpoint
 * converts it to seconds, so nothing here has to know about the wire format. The labels
 * are the catalog's, because "7 days" is two words Thai puts in its own order.
 */
function banDurationItems(t: AdminTranslator): Record<string, string> {
  return Object.fromEntries([
    ...BAN_DURATION_DAYS.map((days) => [String(days), t("suspendDurationDays", { days })]),
    [PERMANENT, t("suspendDurationPermanent")],
  ]);
}

export interface SuspendUserDialogProps {
  open: boolean;
  email: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (submission: SuspendSubmission) => void;
}

/**
 * Collects the two things a suspension needs and today's row menu throws away: what
 * the account is told, and how long it lasts.
 */
export function SuspendUserDialog({
  open,
  email,
  busy = false,
  onOpenChange,
  onConfirm,
}: SuspendUserDialogProps) {
  const t = useTranslations("admin");
  const durationItems = banDurationItems(t);
  // Reset by remounting rather than by an effect: the page keys this dialog on the
  // target and the open state, so a second suspension never inherits the first
  // answer, and no render is cascaded to achieve it.
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<string>(String(BAN_DURATION_DAYS[0]));

  const trimmedReason = reason.trim();
  const expiresInDays = duration === PERMANENT ? undefined : Number(duration);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("suspendTitle")}</DialogTitle>
          <DialogDescription>{t("suspendBody", { email })}</DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="suspend-reason">{t("suspendReasonLabel")}</FieldLabel>
          <Textarea
            id="suspend-reason"
            value={reason}
            maxLength={BAN_REASON_MAX_LENGTH}
            placeholder={t("suspendReasonPlaceholder")}
            onChange={(event) => setReason(event.target.value)}
          />
          <FieldDescription>{t("suspendReasonHint")}</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="suspend-duration">{t("suspendDurationLabel")}</FieldLabel>
          <Select
            value={duration}
            items={durationItems}
            onValueChange={(value) => {
              if (value) setDuration(value);
            }}
          >
            <SelectTrigger
              id="suspend-duration"
              aria-label={t("suspendDurationAria")}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(durationItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("suspendDurationHint")}</FieldDescription>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("suspendCancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              onConfirm({
                banReason: trimmedReason || undefined,
                banExpiresInDays: expiresInDays,
              })
            }
          >
            {busy && <Spinner />}
            {t("suspendConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
