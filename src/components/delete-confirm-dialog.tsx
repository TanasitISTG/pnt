import { ConfirmDialog } from "@/components/confirm-dialog";

interface DeleteConfirmDialogProps {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending?: boolean;
}

export function DeleteConfirmDialog({
  title,
  description,
  open,
  onOpenChange,
  onConfirm,
  pending = false,
}: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      title={title}
      description={description}
      titleClassName="text-destructive font-semibold"
      confirmText={pending ? "Deleting..." : "Delete"}
      variant="destructive"
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      pending={pending}
    />
  );
}
