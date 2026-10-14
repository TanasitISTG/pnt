import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, ShieldOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale } from "use-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  authClient,
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from "@/lib/auth/auth-client";
import { localizedPath } from "@/lib/i18n/locales";
import { describeUserAgent } from "./session-label";

export function ActiveSessionsCard() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const sessionsQuery = useQuery({
    queryKey: ["activeSessions"] as const,
    queryFn: async () => {
      const { data, error } = await listSessions();
      if (error) throw new Error(error.message || "Could not load active sessions");
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
        toast.error(error.message || "Could not end that session");
        return;
      }
      toast.success(isCurrent ? "Signed out on this device" : "Session ended");
      // Revoking the session in use clears the cookie, so the shell has to re-read it.
      // This is a whole-document navigation rather than a router one, so the language is
      // spelled into the address: a signed-out reader would otherwise land on the Thai
      // sign-in page from an English session.
      if (isCurrent) window.location.assign(localizedPath("/login", locale));
      else await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not end that session");
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
        toast.error(error.message || "Could not end the other sessions");
        return;
      }
      toast.success("Signed out everywhere else");
      await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not end the other sessions");
    } finally {
      setBusyToken(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Monitor className="size-5 text-muted-foreground" />
          <CardTitle>Active Sessions</CardTitle>
        </div>
        <CardDescription>
          Signing in on another device adds a session here, and ending one takes effect immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionsQuery.isError ? (
          <p role="alert" className="text-caption text-destructive-text">
            {sessionsQuery.error instanceof Error
              ? sessionsQuery.error.message
              : "Could not load active sessions"}
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
                        <span className="ml-2 text-caption text-muted-foreground">This device</span>
                      )}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {session.ipAddress ? `${session.ipAddress} · ` : ""}
                      Started {new Date(session.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyToken !== null}
                    onClick={() => void handleRevoke(session.token, isCurrent)}
                  >
                    {busyToken === session.token ? <Spinner /> : null}
                    {isCurrent ? "Sign out" : "End session"}
                  </Button>
                </li>
              );
            })}
            {!sessionsQuery.isPending && sessions.length === 0 && (
              <li className="py-3 text-caption text-muted-foreground">No other sessions.</li>
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
            Sign out everywhere else
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
