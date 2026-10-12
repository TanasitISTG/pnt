import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

export interface ConfirmActionDialogProps {
  /** Null keeps the dialog closed, which is how the page tracks a pending target. */
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * The shared confirmation step for the operator actions that cannot be undone from
 * inside the app. It owns no state of its own: the page decides which target, if any,
 * is pending, so two actions can never be queued at once.
 */
export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onOpenChange,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
