import { useTranslations } from "use-intl";

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
  const t = useTranslations("common");
  return (
    <ConfirmDialog
      title={title}
      description={description}
      titleClassName="text-destructive-text font-semibold"
      confirmText={pending ? t("deleting") : t("delete")}
      variant="destructive"
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      pending={pending}
    />
  );
}
