import { useTranslations } from "use-intl";

/**
 * The novel page's pending state. It renders inside the root provider like any other
 * component, so it reads the same catalog the page it stands in for will.
 */
export function NovelPending() {
  const t = useTranslations("novel");

  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4">
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {t("loadingNovel")}
      </div>
    </div>
  );
}
