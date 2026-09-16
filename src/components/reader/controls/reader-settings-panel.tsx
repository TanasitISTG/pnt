import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  ReaderFontSize,
  ReaderSettings,
  ReaderTypeface,
  ReaderViewMode,
} from "@/lib/reader/types";

export interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasTranslation: boolean;
  editing: boolean;
}

export function ReaderSettingsPanel({
  settings,
  update,
  theme,
  setTheme,
  open,
  onOpenChange,
  hasTranslation,
  editing,
}: ReaderSettingsPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" className="size-11" />}
        aria-label="Reading settings"
        title="Reading settings"
      >
        <Settings2 className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>Reading settings</DialogTitle>
          <DialogDescription>Choose how this chapter looks and compares.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          {hasTranslation && !editing ? (
            <ReaderRadioGroup
              label="View"
              value={settings.viewMode}
              options={[
                ["side", "Compare"],
                ["translated", "Translation"],
                ["raw", "Original"],
              ]}
              onChange={(value) => update({ viewMode: value as ReaderViewMode })}
            />
          ) : null}
          <ReaderRadioGroup
            label="Font size"
            value={settings.fontSize}
            options={[
              ["S", "S · 14px"],
              ["M", "M · 16px"],
              ["L", "L · 18px"],
              ["XL", "XL · 20px"],
            ]}
            onChange={(value) => update({ fontSize: value as ReaderFontSize })}
          />
          <ReaderRadioGroup
            label="Typeface"
            value={settings.typeface}
            options={[
              ["default", "Sofia Sans"],
              ["reader", "Sarabun"],
            ]}
            onChange={(value) => update({ typeface: value as ReaderTypeface })}
          />
          <ReaderRadioGroup
            label="Theme"
            value={theme ?? "system"}
            options={[
              ["light", "Light"],
              ["dark", "Dark"],
              ["system", "System"],
            ]}
            onChange={setTheme}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReaderRadioGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2" aria-label={label}>
      <legend className="text-sm font-semibold text-foreground">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
        {options.map(([optionValue, optionLabel]) => (
          <label
            key={optionValue}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted/50"
          >
            <input
              type="radio"
              name={`reader-${label.toLowerCase().replaceAll(" ", "-")}`}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
              className="size-4 accent-primary"
            />
            {optionLabel}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
