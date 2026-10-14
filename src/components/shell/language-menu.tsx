import { Languages } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";
import { useSwitchLocale } from "@/lib/i18n/use-switch-locale";

/**
 * The switcher, in its own menu next to the theme.
 *
 * What a switch does — the cookie, the account's remembered choice, the URL — lives in
 * `useSwitchLocale`, which the appearance settings render as well, so this is only the menu
 * around it. A language names itself in the menu, because the reader who needs it is exactly
 * the one who cannot read the current language.
 *
 * `signedIn` is passed in rather than read from the router context: the shell already knows
 * who the viewer is, and a presentational menu that reaches for the route context cannot be
 * rendered in a test at all.
 */
export interface LanguageMenuProps {
  signedIn: boolean;
}

export function LanguageMenu({ signedIn }: LanguageMenuProps) {
  const t = useTranslations("shell");
  const { locale: active, switching, switchLocale } = useSwitchLocale({ signedIn });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={`${t("languageMenuLabel")}: ${LOCALE_LABELS[active]}`}
        title={`${t("languageMenuLabel")}: ${LOCALE_LABELS[active]}`}
        disabled={switching}
      >
        {switching ? (
          <Spinner className="size-4" />
        ) : (
          <Languages className="size-4" aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={active}
            onValueChange={(value) => void switchLocale(value as Locale)}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <DropdownMenuRadioItem key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
