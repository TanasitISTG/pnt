import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Eye, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { stopImpersonation } from "@/lib/admin/functions";
import type { ImpersonationState } from "@/lib/profile/types";

export interface ImpersonationBannerProps {
  impersonation: ImpersonationState;
  /** Display name of the account being viewed, so the notice names both sides. */
  viewedName: string;
}

/**
 * Stands at the top of the shell for as long as an operator is viewing another
 * account. Every mutation in the app refuses an impersonated session, so the only
 * action here is the way back - and if that fails, it says how to get out rather
 * than leaving the operator stuck in someone else's account.
 */
export function ImpersonationBanner({ impersonation, viewedName }: ImpersonationBannerProps) {
  const t = useTranslations("shell");
  const queryClient = useQueryClient();
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const handleReturn = async () => {
    setReturning(true);
    setFailure(null);
    try {
      await stopImpersonation();
      // The whole shell is about to describe a different account, so nothing cached
      // for the viewed account is allowed to survive the switch.
      queryClient.clear();
      await router.invalidate();
      await router.navigate({ to: "/admin" });
    } catch (error: unknown) {
      setFailure(t("impersonationFailure"));
      toast.error(error instanceof Error ? error.message : t("impersonationReturnFailed"));
      setReturning(false);
    }
  };

  return (
    <div role="status" className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Eye className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-body font-medium text-foreground">
              {t("impersonationBanner", { name: viewedName })}
            </p>
            <p className="text-caption text-muted-foreground">
              {t("impersonationSignedInAs", {
                operator: impersonation.operatorName ?? t("impersonationOperatorFallback"),
              })}
            </p>
            {failure && (
              <p role="alert" className="text-caption text-destructive-text">
                {failure}
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 self-start sm:self-auto"
          onClick={handleReturn}
          disabled={returning}
        >
          {returning ? <Spinner /> : <Undo2 className="size-4" aria-hidden="true" />}
          {returning ? t("impersonationReturning") : t("impersonationReturn")}
        </Button>
      </div>
    </div>
  );
}
