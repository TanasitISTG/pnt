import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, ShieldOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  authClient,
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from "@/lib/auth/auth-client";
import { formatDateTime } from "@/lib/i18n/format";
import { localizedPath } from "@/lib/i18n/locales";
import { describeUserAgent } from "./session-label";

export function ActiveSessionsCard() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const sessionsQuery = useQuery({
    queryKey: ["activeSessions"] as const,
    queryFn: async () => {
      const { data, error } = await listSessions();
      if (error) throw new Error(error.message || t("sessionsLoadFailed"));
      return data ?? [];
    },
  });
  const { data: current } = authClient.useSession();
  const currentToken = current?.session?.token ?? null;
  const sessions = sessionsQuery.data ?? [];

  const refresh = (): Promise<unknown> =>
    queryClient.invalidateQueries({ queryKey: ["activeSessions"] });

  const handleRevoke = async (token: string, isCurrent: boolean) => {
    setBusyToken(token);
    try {
      const { error } = await revokeSession({ token });
      if (error) {
        toast.error(error.message || t("sessionEndFailed"));
        return;
      }
      toast.success(isCurrent ? t("signedOutThisDevice") : t("sessionEnded"));
      // Revoking the session in use clears the cookie, so the shell has to re-read it.
      // This is a whole-document navigation rather than a router one, so the language is
      // spelled into the address: a signed-out reader would otherwise land on the Thai
      // sign-in page from an English session.
      if (isCurrent) window.location.assign(localizedPath("/login", locale));
      else await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("sessionEndFailed"));
    } finally {
      setBusyToken(null);
    }
  };

  const handleRevokeOthers = async () => {
    setBusyToken("others");
    try {
      // Not `revokeSessions`: that one includes this device and would sign the operator
      // out of the page they are standing on.
      const { error } = await revokeOtherSessions();
      if (error) {
        toast.error(error.message || t("othersEndFailed"));
        return;
      }
      toast.success(t("signedOutEverywhereElse"));
      await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("othersEndFailed"));
    } finally {
      setBusyToken(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Monitor className="size-5 text-muted-foreground" />
          <CardTitle>{t("sessionsTitle")}</CardTitle>
        </div>
        <CardDescription>{t("sessionsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionsQuery.isError ? (
          <p role="alert" className="text-caption text-destructive-text">
            {sessionsQuery.error instanceof Error
              ? sessionsQuery.error.message
              : t("sessionsLoadFailed")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((session) => {
              const isCurrent = session.token === currentToken;
              return (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex flex-col">
                    <span className="text-body text-foreground">
                      {describeUserAgent(session.userAgent)}
                      {isCurrent && (
                        <span className="ml-2 text-caption text-muted-foreground">
                          {t("thisDevice")}
                        </span>
                      )}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {session.ipAddress ? `${session.ipAddress} · ` : ""}
                      {t("startedAt", { when: formatDateTime(session.createdAt, locale) })}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyToken !== null}
                    onClick={() => void handleRevoke(session.token, isCurrent)}
                  >
                    {busyToken === session.token ? <Spinner /> : null}
                    {isCurrent ? t("signOut") : t("endSession")}
                  </Button>
                </li>
              );
            })}
            {!sessionsQuery.isPending && sessions.length === 0 && (
              <li className="py-3 text-caption text-muted-foreground">{t("noOtherSessions")}</li>
            )}
          </ul>
        )}

        {sessions.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            disabled={busyToken !== null}
            onClick={() => void handleRevokeOthers()}
          >
            {busyToken === "others" ? (
              <Spinner />
            ) : (
              <ShieldOff className="size-4" aria-hidden="true" />
            )}
            {t("signOutEverywhereElse")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
