import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { deleteUser } from "@/lib/auth/auth-client";

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
        setError(deleteError.message || "Could not start the deletion process.");
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-destructive-text" aria-hidden="true" />
          <CardTitle>Delete Account</CardTitle>
        </div>
        <CardDescription>
          Removes the account and everything in it: novels, chapters, translations, glossary, and
          reader state.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sent ? (
          <p className="text-body text-muted-foreground">
            A confirmation link is on its way to <strong>{email}</strong>. Open it to finish
            deleting this account; the link expires in one hour.
          </p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="deleteConfirmation">
                Type <span className="font-mono">{email}</span> to confirm
              </FieldLabel>
              <Input
                id="deleteConfirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
              <FieldDescription>
                We email a final confirmation link before anything is deleted.
              </FieldDescription>
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
              {pending ? "Starting…" : "Delete my account"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
