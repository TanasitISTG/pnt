import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { useConsent } from "@/lib/consent";

/** The link `consent.message` wraps its policy name in, kept out of the render so the tag
 * function is a stable reference rather than a component minted on every render. */
function PolicyLink({ children }: { children: ReactNode }) {
  return (
    <Link to="/{-$locale}/cookie-policy" className="underline underline-offset-4 text-foreground">
      {children}
    </Link>
  );
}

const MESSAGE_TAGS = {
  policy: (chunks: ReactNode) => <PolicyLink>{chunks}</PolicyLink>,
};

export function ConsentBanner() {
  const t = useTranslations("consent");
  const { consent, setConsent, hydrated } = useConsent();

  if (!hydrated || consent !== "pending") return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-surface p-4 md:p-5">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <Cookie className="size-5 shrink-0 text-muted-foreground mt-0.5" />
          <p className="text-body text-foreground">{t.rich("message", MESSAGE_TAGS)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-end md:self-auto">
          <Button variant="outline" size="sm" onClick={() => setConsent("denied")}>
            {t("reject")}
          </Button>
          <Button size="sm" onClick={() => setConsent("granted")}>
            {t("accept")}
          </Button>
        </div>
      </div>
    </div>
  );
}
