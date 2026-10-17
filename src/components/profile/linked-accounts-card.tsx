import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { linkSocial, listAccounts, unlinkAccount } from "@/lib/auth/auth-client";
import type { AuthMethods } from "@/lib/auth/functions";

type SocialProvider = "google" | "discord";

/**
 * The providers' own names, which are the same in both languages - the same reason the
 * scrape registry's service names are the same. The credential row is not a brand, so its
 * label is copy and comes from the catalog.
 */
const PROVIDER_NAMES: Record<string, string> = {
  google: "Google",
  discord: "Discord",
};

/** Social providers this deployment offers, in the order they are described. */
export function configuredProviders(methods: AuthMethods): SocialProvider[] {
  return [
    ...(methods.google ? (["google"] as const) : []),
    ...(methods.discord ? (["discord"] as const) : []),
  ];
}

/** A provider's own name, or its id when the deployment offered something unlisted. */
function providerName(providerId: string): string {
  return PROVIDER_NAMES[providerId] ?? providerId;
}

export interface LinkedAccountsCardProps {
  methods: AuthMethods;
}

/**
 * Which sign-in methods reach this account.
 *
 * The last remaining method can never be unlinked: removing it would leave an account
 * with no way back in, and the server would then have to explain a lockout it caused.
 */
export function LinkedAccountsCard({ methods }: LinkedAccountsCardProps) {
  const t = useTranslations("settings");
  const queryClient = useQueryClient();
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const accountsQuery = useQuery({
    queryKey: ["linkedAccounts"] as const,
    queryFn: async () => {
      const { data, error } = await listAccounts();
      if (error) throw new Error(error.message || t("accountsLoadFailed"));
      return data ?? [];
    },
  });

  const accounts = accountsQuery.data ?? [];
  const linkedByProvider = new Map(accounts.map((account) => [account.providerId, account]));
  const rows: { id: string; label: string; social: SocialProvider | null }[] = [
    { id: "credential", label: t("methodCredential"), social: null },
    ...configuredProviders(methods).map((provider) => ({
      id: provider,
      label: PROVIDER_NAMES[provider] ?? provider,
      social: provider,
    })),
  ];
  // One method has to survive, so unlinking is only offered while a second exists.
  const canUnlink = accounts.length > 1;

  const handleLink = async (provider: SocialProvider) => {
    setBusyProvider(provider);
    try {
      const { error } = await linkSocial({ provider, callbackURL: "/settings/account" });
      if (error) {
        toast.error(error.message || t("connectFailed", { provider: providerName(provider) }));
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("connectFailedGeneric"));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleUnlink = async (providerId: string, accountId: string) => {
    setBusyProvider(providerId);
    try {
      // The endpoint identifies the link by its account row, not by provider name.
      const { error } = await unlinkAccount({ accountId });
      if (error) {
        toast.error(error.message || t("disconnectFailed"));
        return;
      }
      toast.success(t("disconnected", { provider: providerName(providerId) }));
      await queryClient.invalidateQueries({ queryKey: ["linkedAccounts"] });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("disconnectFailed"));
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Link2 className="size-5 text-muted-foreground" />
          <CardTitle>{t("methodsTitle")}</CardTitle>
        </div>
        <CardDescription>{t("methodsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {accountsQuery.isError ? (
          <p role="alert" className="text-caption text-destructive-text">
            {accountsQuery.error instanceof Error
              ? accountsQuery.error.message
              : t("accountsLoadFailed")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const account = linkedByProvider.get(row.id);
              // A local const, so the narrowing that rules out the credential row still
              // holds inside the click handler's closure.
              const social = row.social;
              const busy = busyProvider === row.id;
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-body text-foreground">{row.label}</span>
                    <span className="text-caption text-muted-foreground">
                      {account ? t("connected") : t("notConnected")}
                    </span>
                  </div>
                  {social === null ? (
                    <span className="text-caption text-muted-foreground">
                      {t("changePasswordInSecurity")}
                    </span>
                  ) : account ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !canUnlink}
                      title={canUnlink ? undefined : t("onlyMethodHint")}
                      onClick={() => void handleUnlink(row.id, account.id)}
                    >
                      {busy ? <Spinner /> : <Unlink className="size-4" aria-hidden="true" />}
                      {t("disconnect")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleLink(social)}
                    >
                      {busy && <Spinner />}
                      {t("connect")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
