import { AlertTriangle, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { deleteUser } from "@/lib/auth/auth-client";

/** The address the link went to, and the one to type out: module scope, so the tags hold. */
const RENDER_STRONG = (chunks: ReactNode) => <strong>{chunks}</strong>;
const RENDER_MONO = (chunks: ReactNode) => <span className="font-mono">{chunks}</span>;

export interface DeleteAccountCardProps {
  email: string;
}

/**
 * Account deletion.
 *
 * Two gates stand between a click and an erased workspace: the address has to be typed
 * out, and Better Auth then mails a confirmation link to it. A stolen session alone is
 * therefore not enough, which matters because deletion is the one action here that no
 * support request can reverse.
 */
export function DeleteAccountCard({ email }: DeleteAccountCardProps) {
  const t = useTranslations("settings");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const matches = confirmation.trim().toLowerCase() === email.trim().toLowerCase();

  const handleDelete = async () => {
    setError(null);
    setPending(true);
    try {
      const { error: deleteError } = await deleteUser({ callbackURL: "/" });
      if (deleteError) {
        setError(deleteError.message || t("deleteStartFailed"));
        return;
      }
      setSent(true);
    } catch {
      setError(t("deleteStartFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-destructive-text" aria-hidden="true" />
          <CardTitle>{t("deleteTitle")}</CardTitle>
        </div>
        <CardDescription>{t("deleteDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent ? (
          <p className="text-body text-muted-foreground">
            {t.rich("deleteSent", { email, strong: RENDER_STRONG })}
          </p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="deleteConfirmation">
                {t.rich("typeToConfirm", { email, mono: RENDER_MONO })}
              </FieldLabel>
              <Input
                id="deleteConfirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
              <FieldDescription>{t("deleteEmailDescription")}</FieldDescription>
            </Field>

            {error && (
              <p role="alert" className="text-caption text-destructive-text">
                {error}
              </p>
            )}

            <Button
              variant="destructive"
              disabled={!matches || pending}
              onClick={() => void handleDelete()}
            >
              {pending ? <Spinner /> : <Trash2 className="size-4" aria-hidden="true" />}
              {pending ? t("deleteStarting") : t("deleteMyAccount")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
