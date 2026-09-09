export function ReaderEmptyContent() {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
      This chapter has no readable text.
    </p>
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
