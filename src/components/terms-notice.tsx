import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { acceptCurrentTerms } from "@/lib/account/terms.functions";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export interface TermsNoticeProps {
  /** True while the account is recorded under a version older than the current one. */
  stale: boolean;
}

/**
 * A standing notice, not a gate.
 *
 * The account's terms version is only ever written by the server, so the way to clear
 * this is to accept the current one here. Reading, exports, and browsing stay open
 * either way - a reader in the middle of a chapter is not the person to interrupt.
 */
export function TermsNotice({ stale }: TermsNoticeProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);

  if (!stale) return null;

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await acceptCurrentTerms();
      // The notice is driven by the viewer the router context holds, so the context
      // has to be refetched before the band can disappear.
      queryClient.clear();
      await router.invalidate();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Could not record your acceptance. Try again.",
      );
      setAccepting(false);
    }
  };

  return (
    // A labelled landmark rather than a live region: the notice is already on the
    // page when it renders, so nothing about it is an announcement of a change.
    <section aria-label="Updated terms" className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-body text-foreground">
            Our terms and privacy policy have changed. Accept the current version (
            {CURRENT_TERMS_VERSION}) to record it on your account —{" "}
            <Link to="/terms" className="underline underline-offset-4 text-foreground">
              read the terms
            </Link>
            .
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 self-start sm:self-auto"
          onClick={handleAccept}
          disabled={accepting}
        >
          {accepting && <Spinner />}
          {accepting ? "Recording…" : "I accept"}
        </Button>
      </div>
    </section>
  );
}
