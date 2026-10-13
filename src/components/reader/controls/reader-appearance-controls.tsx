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
  return (
    <div className="flex flex-col gap-3.5">
      {hasTranslation && !editing ? (
        <AppearanceRow<ReaderViewMode>
          label="View"
          value={settings.viewMode}
          options={[
            { value: "side", label: "Compare" },
            { value: "translated", label: "Translation" },
            { value: "raw", label: "Original" },
          ]}
          onChange={(viewMode) => update({ viewMode })}
        />
      ) : null}
      <AppearanceRow<ReaderFontSize>
        label="Font size"
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
        label="Line height"
        value={settings.lineHeight}
        options={[
          { value: "compact", label: "Compact", srLabel: "· 1.5" },
          { value: "normal", label: "Normal", srLabel: "· 1.75" },
          { value: "relaxed", label: "Relaxed", srLabel: "· 2.0" },
        ]}
        onChange={(lineHeight) => update({ lineHeight })}
      />
      <AppearanceRow<ReaderMeasure>
        label="Text width"
        value={settings.measure}
        options={[
          { value: "narrow", label: "Narrow" },
          { value: "medium", label: "Medium" },
          { value: "wide", label: "Wide" },
        ]}
        onChange={(measure) => update({ measure })}
      />
      <AppearanceRow<ReaderTypeface>
        label="Typeface"
        value={settings.typeface}
        options={[
          { value: "default", label: "Sofia Sans" },
          { value: "reader", label: "Sarabun" },
        ]}
        onChange={(typeface) => update({ typeface })}
      />
      <AppearanceRow<ReaderPageTheme>
        label="Page"
        value={settings.pageTheme}
        options={[
          { value: "app", label: "Default" },
          { value: "sepia", label: "Sepia" },
          { value: "paper", label: "Paper" },
        ]}
        onChange={(pageTheme) => update({ pageTheme })}
      />
      <AppearanceRow
        label="App theme"
        value={theme ?? "system"}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
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
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <SegmentedControl
        label={label}
        value={value}
        options={options}
        onValueChange={onChange}
        className="max-w-full"
      />
    </div>
  );
}
