import { useTranslations } from "use-intl";

/**
 * The first thing a keyboard reaches: it jumps past the header into `<main>`, so
 * tabbing to the content of a long page never walks the navigation. It appears
 * instantly on focus — animating a keyboard-initiated control reads as lag.
 */
export function SkipLink() {
  const t = useTranslations("shell");

  return (
    <a href="#main" className="skip-link no-underline">
      {t("skipToContent")}
    </a>
  );
}
