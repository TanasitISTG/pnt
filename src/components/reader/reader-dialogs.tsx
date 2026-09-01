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
  return (
    <>
      <ConfirmDialog
        open={translation.open}
        onOpenChange={translation.onOpenChange}
        title="Overwrite Edited Translation?"
        description="This chapter was manually edited. Re-translating will overwrite your manual changes with a new machine translation."
        confirmText="Overwrite & Translate"
        onConfirm={translation.onConfirm}
      />

      <Dialog open={sourceEdit.open} onOpenChange={sourceEdit.onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Source Changed</DialogTitle>
            <DialogDescription>
              Keeping the translation marks it as manually edited. Clearing removes the translated
              title and content so the chapter can be retranslated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => sourceEdit.onOpenChange(false)}
              disabled={sourceEdit.saving}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={sourceEdit.onClear} disabled={sourceEdit.saving}>
              Clear Translation
            </Button>
            <Button onClick={sourceEdit.onKeep} disabled={sourceEdit.saving}>
              Keep Translation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discard.open} onOpenChange={discard.onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard Unsaved Changes?</DialogTitle>
            <DialogDescription>
              Your chapter edits are not saved. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={discard.onKeep}>
              Keep Editing
            </Button>
            <Button variant="destructive" onClick={discard.onDiscard}>
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcuts.open} onOpenChange={shortcuts.onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reader shortcuts</DialogTitle>
            <DialogDescription>
              Keyboard controls work when focus is outside form fields.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-caption">
            <ShortcutKeys keys="← / h" label="Previous chapter" />
            <ShortcutKeys keys="→ / l" label="Next chapter" />
            <ShortcutKeys keys="v" label="Cycle view mode" />
            <ShortcutKeys keys="t" label="Toggle theme" />
            {shortcuts.canEdit && <ShortcutKeys keys="e" label="Edit chapter" />}
            {shortcuts.canEdit && <ShortcutKeys keys="Ctrl/⌘+S" label="Save chapter" />}
            <ShortcutKeys keys="Esc" label="Cancel edit or close help" />
            <ShortcutKeys keys="/" label="Show this help" />
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
