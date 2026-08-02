import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReaderFontSize, ReaderSettings, ReaderTypeface } from "@/lib/reader/types";

export interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  setTheme: (theme: string) => void;
}

export function ReaderSettingsPanel({
  settings,
  update,
  theme,
  setTheme,
}: ReaderSettingsPanelProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="size-8" />}
        aria-label="Reading settings"
        title="Reading settings"
      >
        <Settings2 className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Font size</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.fontSize}
            onValueChange={(v) => update({ fontSize: v as ReaderFontSize })}
          >
            {(["S", "M", "L", "XL"] as const).map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {s}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Typeface</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.typeface}
            onValueChange={(v) => update({ typeface: v as ReaderTypeface })}
          >
            <DropdownMenuRadioItem value="default">Sofia Sans</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="reader">Sarabun</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
