import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHydrated } from "@/lib/use-hydrated";

const THEME_OPTIONS = [
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
  { value: "system", labelKey: "themeSystem", icon: Monitor },
] as const;

/**
 * Appearance, as a choice of three. A bare sun/moon toggle cannot express "follow the
 * system", and it hides which state you are actually in; the trigger shows the current
 * one and the menu names all three.
 */
export function ThemeMenu() {
  const t = useTranslations("shell");
  const { theme, setTheme } = useTheme();
  const mounted = useHydrated();
  // Before hydration the server-rendered icon is the light one, so the first paint
  // matches the markup and the real preference applies on the next render.
  const active = mounted ? (theme ?? "system") : "light";
  const activeLabel = t(
    THEME_OPTIONS.find((option) => option.value === active)?.labelKey ?? "themeSystem",
  );
  const ActiveIcon = THEME_OPTIONS.find((option) => option.value === active)?.icon ?? Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={`${t("themeMenuLabel")}: ${activeLabel}`}
        title={`${t("themeMenuLabel")}: ${activeLabel}`}
      >
        <ActiveIcon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {/* The label is a Base UI group label, so it must be inside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("themeMenuLabel")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={active} onValueChange={(value) => setTheme(value)}>
            {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon className="size-4" aria-hidden="true" />
                {t(labelKey)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
