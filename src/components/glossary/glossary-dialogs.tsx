import { useEffect } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { HelpCircle, Upload } from "lucide-react";
import { z } from "zod";

import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { bulkImportTermsSchema } from "@/lib/glossary/schemas";

interface GlossaryDialogsProps {
  deleteOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
  onDeleteConfirm: () => void;
  deletingTerm: boolean;
  deleteAllOpen: boolean;
  onDeleteAllOpenChange: (open: boolean) => void;
  onDeleteAllConfirm: () => void;
  deletingAllTerms: boolean;
  importOpen: boolean;
  onImportOpenChange: (open: boolean) => void;
  onImport: (tsv: string) => Promise<unknown>;
  importing: boolean;
}

const tsvImportFormSchema = z.object({
  tsv: bulkImportTermsSchema.shape.tsv,
});

export function GlossaryDialogs({
  deleteOpen,
  onDeleteOpenChange,
  onDeleteConfirm,
  deletingTerm,
  deleteAllOpen,
  onDeleteAllOpenChange,
  onDeleteAllConfirm,
  deletingAllTerms,
  importOpen,
  onImportOpenChange,
  onImport,
  importing,
}: GlossaryDialogsProps) {
  const form = useForm({
    defaultValues: { tsv: "" },
    validators: { onSubmit: tsvImportFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = tsvImportFormSchema.parse(value);
      try {
        await onImport(parsed.tsv);
        form.reset({ tsv: "" }, { keepDefaultValues: true });
        onImportOpenChange(false);
      } catch {
        // The mutation owns the error toast and the draft remains available for correction.
      }
    },
  });
  const [tsv, isSubmitting] = useStore(
    form.store,
    (state) => [state.values.tsv, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  useEffect(() => {
    if (importOpen) form.reset({ tsv: "" }, { keepDefaultValues: true });
  }, [form, importOpen]);

  return (
    <>
      <DeleteConfirmDialog
        title="Delete Glossary Term"
        description="Are you sure you want to delete this term? This action cannot be undone."
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
        onConfirm={onDeleteConfirm}
        pending={deletingTerm}
      />

      <DeleteConfirmDialog
        title="Delete All Glossary Terms"
        description="This permanently deletes every approved, pending, and rejected glossary term for this novel. Existing translated chapter text will not be changed."
        open={deleteAllOpen}
        onOpenChange={onDeleteAllOpenChange}
        onConfirm={onDeleteAllConfirm}
        pending={deletingAllTerms}
      />

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (importing || form.state.isSubmitting) return;
          if (!open) form.reset({ tsv: "" }, { keepDefaultValues: true });
          onImportOpenChange(open);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-5"
          >
            <DialogHeader>
              <DialogTitle>Bulk Import Glossary Terms (TSV)</DialogTitle>
              <DialogDescription>
                Paste tab-separated text containing one term per line. Format: <br />
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  source &lt;tab&gt; target &lt;tab&gt; category &lt;tab&gt; note
                </code>
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <HelpCircle className="size-3.5" />
                <span>Example TSV format:</span>
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground select-all">
                {`Lin Fan\tหลินฟาน\tcharacter\tProtagonist
Sun Peak\tยอดเขาอาทิตย์\tplace\tSect location
Solar Slash\tเพลงดาบสุริยะ\tskill`}
              </pre>

              <form.Field name="tsv">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="tsv-input">TSV Content</FieldLabel>
                      <Textarea
                        id="tsv-input"
                        name={field.name}
                        rows={8}
                        placeholder="Paste TSV data here..."
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        className="font-mono text-xs"
                      />
                      {invalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  form.reset({ tsv: "" }, { keepDefaultValues: true });
                  onImportOpenChange(false);
                }}
                disabled={importing || isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={importing || isSubmitting || !tsv.trim()}>
                {importing || isSubmitting ? <Spinner /> : <Upload className="size-4" />}
                {importing || isSubmitting ? "Importing..." : "Import Terms"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
