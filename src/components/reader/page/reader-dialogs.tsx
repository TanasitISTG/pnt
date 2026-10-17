import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReaderDialogsProps {
  translation: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  };
  sourceEdit: {
    open: boolean;
    saving: boolean;
    onOpenChange: (open: boolean) => void;
    onClear: () => void;
    onKeep: () => void;
  };
  discard: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onKeep: () => void;
    onDiscard: () => void;
  };
  shortcuts: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    canEdit: boolean;
  };
}

export function ReaderDialogs({ translation, sourceEdit, discard, shortcuts }: ReaderDialogsProps) {
  const t = useTranslations("reader");
  const tCommon = useTranslations("common");

  return (
    <>
      <ConfirmDialog
        open={translation.open}
        onOpenChange={translation.onOpenChange}
        title={t("retranslateTitle")}
        description={t("retranslateDescription")}
        confirmText={t("retranslateConfirm")}
        onConfirm={translation.onConfirm}
        contentClassName="z-[60]"
      />
      <Dialog open={sourceEdit.open} onOpenChange={sourceEdit.onOpenChange}>
        <DialogContent className="z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto overscroll-contain sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("sourceChangedTitle")}</DialogTitle>
            <DialogDescription>{t("sourceChangedDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => sourceEdit.onOpenChange(false)}
              disabled={sourceEdit.saving}
            >
              {tCommon("cancel")}
            </Button>
            <Button variant="destructive" onClick={sourceEdit.onClear} disabled={sourceEdit.saving}>
              {t("clearTranslation")}
            </Button>
            <Button onClick={sourceEdit.onKeep} disabled={sourceEdit.saving}>
              {t("keepTranslation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discard.open} onOpenChange={discard.onOpenChange}>
        <DialogContent className="z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>{t("discardTitle")}</DialogTitle>
            <DialogDescription>{t("discardDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={discard.onKeep}>
              {t("keepEditing")}
            </Button>
            <Button variant="destructive" onClick={discard.onDiscard}>
              {t("discardChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcuts.open} onOpenChange={shortcuts.onOpenChange}>
        <DialogContent className="z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>{t("shortcutsTitle")}</DialogTitle>
            <DialogDescription>{t("shortcutsDescription")}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-caption">
            <ShortcutKeys keys="← / h" label={t("previousChapter")} />
            <ShortcutKeys keys="→ / l" label={t("nextChapter")} />
            <ShortcutKeys keys="v" label={t("shortcutCycleView")} />
            <ShortcutKeys keys="t" label={t("shortcutTheme")} />
            <ShortcutKeys keys="Ctrl/⌘+F" label={t("findInChapter")} />
            <ShortcutKeys keys="Enter / ⇧+Enter" label={t("shortcutMatches")} />
            <ShortcutKeys keys="f" label={t("shortcutFocus")} />
            {shortcuts.canEdit && <ShortcutKeys keys="e" label={t("editChapter")} />}
            {shortcuts.canEdit && <ShortcutKeys keys="Ctrl/⌘+S" label={t("shortcutSave")} />}
            <ShortcutKeys keys="Esc" label={t("shortcutEscape")} />
            <ShortcutKeys keys="?" label={t("shortcutHelp")} />
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShortcutKeys({ keys, label }: { keys: string; label: string }) {
  return (
    <>
      <dt>
        <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-semibold text-foreground">
          {keys}
        </kbd>
      </dt>
      <dd className="text-muted-foreground">{label}</dd>
    </>
  );
}
