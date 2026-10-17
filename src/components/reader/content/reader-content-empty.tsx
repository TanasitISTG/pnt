import { useTranslations } from "use-intl";

export function ReaderEmptyContent() {
  const t = useTranslations("reader");
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <p className="text-muted-foreground">{t("emptyContent")}</p>
    </div>
  );
}

export function ReaderMissingOriginalContent() {
  const t = useTranslations("reader");
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
      {t("missingOriginal")}
    </p>
  );
}

export function ReaderMissingTranslationContent() {
  const t = useTranslations("reader");
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
      {t("missingTranslation")}
    </p>
  );
}
