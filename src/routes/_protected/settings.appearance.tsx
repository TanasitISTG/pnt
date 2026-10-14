import { createFileRoute } from "@tanstack/react-router";
import { useTheme } from "next-themes";

import { ReaderAppearanceControls } from "@/components/reader/controls/reader-appearance-controls";
import { SettingsSection } from "@/components/settings/settings-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useReaderSettings } from "@/lib/reader/settings";
import { useHydrated } from "@/lib/use-hydrated";

export const Route = createFileRoute("/_protected/settings/appearance")({
  head: () => ({
    meta: [{ title: "Appearance | Pnt - Personal Novel Translator" }],
  }),
  component: AppearanceSettingsPage,
});

/**
 * Appearance: the app theme and the reader's own typography, in one place.
 *
 * These are the same controls the reader shows in its appearance popover — literally the
 * same component — so a preference cannot mean two different things depending on where it
 * is set. `hasTranslation` is false here because there is no chapter on screen to compare,
 * which drops the Compare/Translation/Original row; everything else is a reading default,
 * and the copy says plainly that it is stored on this device rather than with the account.
 */
function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme();
  const mounted = useHydrated();
  const { settings, update } = useReaderSettings();

  return (
    <SettingsSection
      title="Appearance"
      description="How the app and the reader look. Stored in this browser, so a second device keeps its own choices."
    >
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
