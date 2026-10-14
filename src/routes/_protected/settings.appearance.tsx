import { createFileRoute } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useTranslations } from "use-intl";

import { ReaderAppearanceControls } from "@/components/reader/controls/reader-appearance-controls";
import { SettingsSection } from "@/components/settings/settings-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import { useSwitchLocale } from "@/lib/i18n/use-switch-locale";
import { useReaderSettings } from "@/lib/reader/settings";
import { useHydrated } from "@/lib/use-hydrated";

export const Route = createFileRoute("/_protected/settings/appearance")({
  head: () => ({
    meta: [{ title: "Appearance | Pnt - Personal Novel Translator" }],
  }),
  component: AppearanceSettingsPage,
});

/**
 * Appearance: the language, the app theme and the reader's own typography, in one place.
 *
 * The language belongs here rather than in a section of its own because it is the same kind
 * of choice as the theme — how the app presents itself — and the reader who wants to change
 * it looks where they changed the colors. The control is the shared `useSwitchLocale`, so
 * this page and the header's menu cannot drift apart.
 *
 * The typography rows are the same controls the reader shows in its appearance popover —
 * literally the same component — so a preference cannot mean two different things depending
 * on where it is set. `hasTranslation` is false here because there is no chapter on screen to
 * compare, which drops the Compare/Translation/Original row.
 */
function AppearanceSettingsPage() {
  const t = useTranslations("shell");
  const { theme, setTheme } = useTheme();
  const mounted = useHydrated();
  const { settings, update } = useReaderSettings();

  return (
    <SettingsSection
      title="Appearance"
      description="How the app and the reader look. Reading preferences live in this browser; the language follows your account."
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("language")}</CardTitle>
          <CardDescription>{t("languageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageChoice />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Theme and reading defaults</CardTitle>
          <CardDescription>
            The app theme applies everywhere; the reading settings apply inside a chapter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReaderAppearanceControls
            settings={settings}
            update={update}
            // Before hydration the server has no theme to report, so the row renders
            // unselected for one paint rather than claiming a preference it does not know.
            theme={mounted ? theme : undefined}
            setTheme={setTheme}
            hasTranslation={false}
            editing={false}
          />
        </CardContent>
      </Card>
    </SettingsSection>
  );
}

/**
 * The language choice itself.
 *
 * A segmented control rather than a menu, because a settings page shows its options. Each
 * language names itself in its own language, which is the whole point of the control: a
 * reader who cannot read the current language is who needs it most.
 */
function LanguageChoice() {
  const t = useTranslations("shell");
  const { locale, switchLocale } = useSwitchLocale({ signedIn: true });

  return (
    <SegmentedControl
      label={t("language")}
      value={locale}
      options={SUPPORTED_LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code] }))}
      onValueChange={(next) => void switchLocale(next)}
    />
  );
}
