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

export interface SuspendSubmission {
  banReason?: string;
  banExpiresInDays?: number;
}

const PERMANENT = "permanent";

/**
 * Durations are offered as whole days; the schema takes a day count and the endpoint
 * converts it to seconds, so nothing here has to know about the wire format.
 */
const DURATION_ITEMS: Record<string, string> = Object.fromEntries([
  ...BAN_DURATION_DAYS.map((days) => [String(days), `${days} days`]),
  [PERMANENT, "Permanent"],
]);

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
          <DialogTitle>Suspend this account?</DialogTitle>
          <DialogDescription>
            {email} can no longer sign in, and every session it holds is ended. Published novels
            stay public — a suspension targets the account, not the catalog.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="suspend-reason">Reason</FieldLabel>
          <Textarea
            id="suspend-reason"
            value={reason}
            maxLength={BAN_REASON_MAX_LENGTH}
            placeholder="Spam in published chapters"
            onChange={(event) => setReason(event.target.value)}
          />
          <FieldDescription>
            Shown to the account when it next tries to sign in, so keep it factual.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="suspend-duration">Duration</FieldLabel>
          <Select
            value={duration}
            items={DURATION_ITEMS}
            onValueChange={(value) => {
              if (value) setDuration(value);
            }}
          >
            <SelectTrigger
              id="suspend-duration"
              aria-label="Suspension duration"
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DURATION_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            A time-limited suspension lifts on its own; it is cleared the next time the account
            signs in.
          </FieldDescription>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep access
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
            Suspend account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
