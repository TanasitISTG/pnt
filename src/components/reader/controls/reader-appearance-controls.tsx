import { useTranslations } from "use-intl";

import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type {
  ReaderFontSize,
  ReaderLineHeight,
  ReaderMeasure,
  ReaderPageTheme,
  ReaderSettings,
  ReaderTypeface,
  ReaderViewMode,
} from "@/lib/reader/types";

export interface ReaderAppearanceControlsProps {
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  hasTranslation: boolean;
  editing: boolean;
}

/**
 * Every reading preference in one list.
 *
 * These were seven radio groups in a modal dialog: a full-screen interruption, behind a
 * scrim that hid the prose the change applies to. Segmented controls are the right
 * primitive for a small set of mutually exclusive choices that take effect immediately,
 * and the container decides whether the list opens as a popover or as a sheet.
 */
export function ReaderAppearanceControls({
  settings,
  update,
  theme,
  setTheme,
  hasTranslation,
  editing,
}: ReaderAppearanceControlsProps) {
  const t = useTranslations("reader");
  const tShell = useTranslations("shell");

  return (
    <div className="flex flex-col gap-3.5">
      {hasTranslation && !editing ? (
        <AppearanceRow<ReaderViewMode>
          label={t("view")}
          value={settings.viewMode}
          options={[
            { value: "side", label: t("viewCompare") },
            { value: "translated", label: t("viewTranslation") },
            { value: "raw", label: t("viewOriginal") },
          ]}
          onChange={(viewMode) => update({ viewMode })}
        />
      ) : null}
      <AppearanceRow<ReaderFontSize>
        label={t("fontSize")}
        value={settings.fontSize}
        options={[
          { value: "S", label: "S", srLabel: "· 14px" },
          { value: "M", label: "M", srLabel: "· 16px" },
          { value: "L", label: "L", srLabel: "· 18px" },
          { value: "XL", label: "XL", srLabel: "· 20px" },
        ]}
        onChange={(fontSize) => update({ fontSize })}
      />
      <AppearanceRow<ReaderLineHeight>
        label={t("lineHeight")}
        value={settings.lineHeight}
        options={[
          { value: "compact", label: t("lineHeightCompact"), srLabel: "· 1.5" },
          { value: "normal", label: t("lineHeightNormal"), srLabel: "· 1.75" },
          { value: "relaxed", label: t("lineHeightRelaxed"), srLabel: "· 2.0" },
        ]}
        onChange={(lineHeight) => update({ lineHeight })}
      />
      <AppearanceRow<ReaderMeasure>
        label={t("textWidth")}
        value={settings.measure}
        options={[
          { value: "narrow", label: t("widthNarrow") },
          { value: "medium", label: t("widthMedium") },
          { value: "wide", label: t("widthWide") },
        ]}
        onChange={(measure) => update({ measure })}
      />
      <AppearanceRow<ReaderTypeface>
        label={t("typeface")}
        value={settings.typeface}
        options={[
          { value: "default", label: "Sofia Sans" },
          { value: "reader", label: "Sarabun" },
        ]}
        onChange={(typeface) => update({ typeface })}
      />
      <AppearanceRow<ReaderPageTheme>
        label={t("pageTheme")}
        value={settings.pageTheme}
        options={[
          { value: "app", label: t("pageDefault") },
          { value: "sepia", label: t("pageSepia") },
          { value: "paper", label: t("pagePaper") },
        ]}
        onChange={(pageTheme) => update({ pageTheme })}
      />
      <AppearanceRow
        label={t("appTheme")}
        value={theme ?? "system"}
        options={[
          { value: "light", label: tShell("themeLight") },
          { value: "dark", label: tShell("themeDark") },
          { value: "system", label: tShell("themeSystem") },
        ]}
        onChange={setTheme}
      />
    </div>
  );
}

interface AppearanceRowProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
}

function AppearanceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: AppearanceRowProps<T>) {
  return (
    // `justify-between` supplies the visible spacing; the gap is only the minimum that
    // decides whether the row can still hold both, so it is kept tight on purpose.
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      {/* `compact` so the label keeps the choice on its own line down to 320px. */}
      <SegmentedControl
        label={label}
        value={value}
        options={options}
        size="compact"
        onValueChange={onChange}
        className="max-w-full"
      />
    </div>
  );
}
