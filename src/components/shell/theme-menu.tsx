import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

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
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const THEME_LABELS = Object.fromEntries(THEME_OPTIONS.map((o) => [o.value, o.label]));

/**
 * Appearance, as a choice of three. A bare sun/moon toggle cannot express "follow the
 * system", and it hides which state you are actually in; the trigger shows the current
 * one and the menu names all three.
 */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const mounted = useHydrated();
  // Before hydration the server-rendered icon is the light one, so the first paint
  // matches the markup and the real preference applies on the next render.
  const active = mounted ? (theme ?? "system") : "light";
  const ActiveIcon = THEME_OPTIONS.find((option) => option.value === active)?.icon ?? Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={`Appearance: ${THEME_LABELS[active]}`}
        title={`Appearance: ${THEME_LABELS[active]}`}
      >
        <ActiveIcon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {/* The label is a Base UI group label, so it must be inside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={active} onValueChange={(value) => setTheme(value)}>
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
