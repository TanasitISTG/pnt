import { Link } from "@tanstack/react-router";
import { Cookie } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConsent } from "@/lib/consent";

export function ConsentBanner() {
  const { consent, setConsent } = useConsent();

  if (consent !== "pending") return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-surface shadow-lg transition-all p-4 md:p-5">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <Cookie className="size-5 shrink-0 text-muted-foreground mt-0.5" />
          <p className="text-body text-foreground">
            We use essential cookies to maintain your session and optional PostHog analytics to
            improve your experience. Read our{" "}
            <Link to="/cookie-policy" className="underline underline-offset-4 text-foreground">
              Cookie Policy
            </Link>{" "}
            to learn more.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-end md:self-auto">
          <Button variant="outline" size="sm" onClick={() => setConsent("denied")}>
            Reject optional
          </Button>
          <Button size="sm" onClick={() => setConsent("granted")}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
