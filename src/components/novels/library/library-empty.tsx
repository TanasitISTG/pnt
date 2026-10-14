import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";

export interface LibraryEmptyProps {
  /** True only in the signed-in workspace (`scope === "mine"`). */
  canManage: boolean;
  signedIn: boolean;
}

/**
 * The empty state doubles as the guest's onboarding: a visitor who lands on a catalog
 * with nothing published yet is the one person who can change that, so the call to
 * action is here rather than only behind the header's account menu.
 *
 * Sign-up and sign-in are localized pages reached from both the catalog and the shelf, so
 * both links carry the language explicitly.
 */
export function LibraryEmpty({ canManage, signedIn }: LibraryEmptyProps) {
  const t = useTranslations("catalog");
  // The two calls to action name actions, not this screen, so they read the shell's words
  // for them: the same labels the header and the drawer use.
  const tShell = useTranslations("shell");
  const localized = useLocalizedParams();

  if (canManage) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title={t("emptyOwnTitle")}
        description={t("emptyOwnDescription")}
      >
        <Button render={<Link to="/novels/new" />}>{t("newNovel")}</Button>
      </EmptyState>
    );
  }

  if (signedIn) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title={t("emptySignedInTitle")}
        description={t("emptySignedInDescription")}
      />
    );
  }

  return (
    <EmptyState
      icon={<BookOpen />}
      title={t("emptyGuestTitle")}
      description={t("emptyGuestDescription")}
    >
      <Button render={<Link to="/{-$locale}/signup" params={localized} />}>
        {tShell("createAccount")}
      </Button>
      <Button variant="outline" render={<Link to="/{-$locale}/login" params={localized} />}>
        {tShell("signIn")}
      </Button>
    </EmptyState>
  );
}
