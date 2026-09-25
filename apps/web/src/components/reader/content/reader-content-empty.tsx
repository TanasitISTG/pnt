import { Button } from "@/components/ui/button";

interface ReaderEmptyContentProps {
  isAdmin?: boolean;
  onEditRequest?: () => void;
}

export function ReaderEmptyContent({ isAdmin = false, onEditRequest }: ReaderEmptyContentProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <p className="text-muted-foreground">This chapter has no readable text.</p>
      {isAdmin && onEditRequest ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={onEditRequest}>
          Edit chapter
        </Button>
      ) : null}
    </div>
  );
}

export function ReaderMissingOriginalContent() {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
      No original text is available.
    </p>
  );
}

export function ReaderMissingTranslationContent() {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
      No translated text is available.
    </p>
  );
}
