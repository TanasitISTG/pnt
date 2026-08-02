import { HelpCircle, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";

interface GlossaryDialogsProps {
  deleteOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
  onDeleteConfirm: () => void;
  deletingTerm: boolean;
  deleteAllOpen: boolean;
  onDeleteAllOpenChange: (open: boolean) => void;
  onDeleteAllConfirm: () => void;
  deletingAllTerms: boolean;
  replaceConfirm: { chapterCount: number; occurrences: number } | null;
  onReplaceOpenChange: (open: boolean) => void;
  originalTarget: string | undefined;
  onReplaceConfirm: (apply: boolean) => void;
  savingEdit: boolean;
  importOpen: boolean;
  onImportOpenChange: (open: boolean) => void;
  tsvText: string;
  onTsvTextChange: (value: string) => void;
  onImport: () => void;
  importing: boolean;
}

export function GlossaryDialogs({
  deleteOpen,
  onDeleteOpenChange,
  onDeleteConfirm,
  deletingTerm,
  deleteAllOpen,
  onDeleteAllOpenChange,
  onDeleteAllConfirm,
  deletingAllTerms,
  replaceConfirm,
  onReplaceOpenChange,
  originalTarget,
  onReplaceConfirm,
  savingEdit,
  importOpen,
  onImportOpenChange,
  tsvText,
  onTsvTextChange,
  onImport,
  importing,
}: GlossaryDialogsProps) {
  return (
    <>
      {/* Delete Dialog */}
      <DeleteConfirmDialog
        title="Delete Glossary Term"
        description="Are you sure you want to delete this term? This action cannot be undone."
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
        onConfirm={onDeleteConfirm}
        pending={deletingTerm}
      />

      {/* Delete All Dialog */}
      <DeleteConfirmDialog
        title="Delete All Glossary Terms"
        description="This permanently deletes every approved, pending, and rejected glossary term for this novel. Existing translated chapter text will not be changed."
        open={deleteAllOpen}
        onOpenChange={onDeleteAllOpenChange}
        onConfirm={onDeleteAllConfirm}
        pending={deletingAllTerms}
      />

      {/* Replace-in-chapters Confirm Dialog */}
      <Dialog open={replaceConfirm !== null} onOpenChange={onReplaceOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace in translated chapters?</DialogTitle>
            <DialogDescription>
              The old target{" "}
              <span className="font-semibold text-foreground">“{originalTarget}”</span> appears in{" "}
              {replaceConfirm?.chapterCount ?? 0} translated chapter(s) (
              {replaceConfirm?.occurrences ?? 0} occurrence(s)).
            </DialogDescription>
          </DialogHeader>
          <p className="text-caption text-muted-foreground">
            Replacement is an exact, case-sensitive match and may also match inside longer words.
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onReplaceConfirm(false)} disabled={savingEdit}>
              Save glossary only
            </Button>
            <Button onClick={() => onReplaceConfirm(true)} disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Replace & Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={importOpen} onOpenChange={onImportOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bulk Import Glossary Terms (TSV)</DialogTitle>
            <DialogDescription>
              Paste tab-separated text containing one term per line. Format: <br />
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">
                source &lt;tab&gt; target &lt;tab&gt; category &lt;tab&gt; note
              </code>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <HelpCircle className="size-3.5" />
              <span>Example TSV format:</span>
            </div>
            <pre className="text-xs bg-muted p-3 rounded-md font-mono text-muted-foreground overflow-x-auto select-all">
              {`Lin Fan\tหลินฟาน\tcharacter\tProtagonist
Sun Peak\tยอดเขาอาทิตย์\tplace\tSect location
Solar Slash\tเพลงดาบสุริยะ\tskill`}
            </pre>

            <Label htmlFor="tsv-input">TSV Content</Label>
            <Textarea
              id="tsv-input"
              rows={8}
              placeholder="Paste TSV data here..."
              value={tsvText}
              onChange={(e) => onTsvTextChange(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onImportOpenChange(false);
                onTsvTextChange("");
              }}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button onClick={onImport} disabled={importing || !tsvText.trim()}>
              <Upload className="size-4" />
              {importing ? "Importing..." : "Import Terms"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
