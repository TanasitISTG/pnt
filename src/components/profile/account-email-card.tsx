import { useForm, useStore } from "@tanstack/react-form";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { changeEmail } from "@/lib/auth/auth-client";

const changeEmailSchema = z.object({
  newEmail: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

export interface AccountEmailCardProps {
  /** The address in force right now; the change only lands after it is confirmed. */
  email: string;
}

/**
 * Moving an account's address.
 *
 * Better Auth confirms the change at the *current* address, so a hijacked session
 * cannot migrate the account to an address the attacker controls. The card therefore
 * describes a two-step flow rather than an instant save.
 */
export function AccountEmailCard({ email }: AccountEmailCardProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { newEmail: "" },
    validators: { onSubmit: changeEmailSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { newEmail } = changeEmailSchema.parse(value);
        const { error: changeError } = await changeEmail({ newEmail, callbackURL: "/profile" });
        if (changeError) {
          setError(changeError.message || "Could not start the email change.");
          return;
        }
        setSentTo(newEmail);
        form.reset();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MailCheck className="size-5 text-muted-foreground" />
          <CardTitle>Email Address</CardTitle>
        </div>
        <CardDescription>
          Used to sign in and to recover your account. Changing it needs confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sentTo ? (
          <div className="space-y-3">
            <p className="text-body text-muted-foreground">
              A confirmation link is on its way to <strong>{email}</strong>. Open it to finish
              moving this account to {sentTo}.
            </p>
            <Button variant="outline" onClick={() => setSentTo(null)}>
              Use a different address
            </Button>
          </div>
        ) : (
          <form
            noValidate
            className="max-w-md space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="newEmail">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="newEmail">New Email</FieldLabel>
                    <Input
                      id="newEmail"
                      name={field.name}
                      type="email"
                      placeholder="you@example.com"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      autoComplete="email"
                    />
                    <FieldDescription>
                      We send the confirmation to {email}, then this account signs in with the new
                      address.
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            {error && (
              <p role="alert" className="text-caption text-destructive-text">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? "Sending…" : "Send confirmation"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
