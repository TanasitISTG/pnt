import { useForm, useStore } from "@tanstack/react-form";
import { MailCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { changeEmail } from "@/lib/auth/auth-client";

/** The address the confirmation went to, emphasized. Module scope, so the tag is stable. */
const RENDER_STRONG = (chunks: ReactNode) => <strong>{chunks}</strong>;

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
  const t = useTranslations("settings");
  // The address example is the app's one wording of it (`auth.emailPlaceholder`), not a second
  // copy of it written here: an address looks the same wherever a field asks for one.
  const tAuth = useTranslations("auth");
  const tc = useTranslations("common");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The field messages are the reader's own language, so the rules are built here.
  const changeEmailSchema = z.object({
    newEmail: z.string().trim().min(1, t("emailRequired")).email(t("emailInvalid")),
  });

  const form = useForm({
    defaultValues: { newEmail: "" },
    validators: { onSubmit: changeEmailSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { newEmail } = changeEmailSchema.parse(value);
        const { error: changeError } = await changeEmail({
          newEmail,
          callbackURL: "/settings/account",
        });
        if (changeError) {
          setError(changeError.message || t("emailChangeFailed"));
          return;
        }
        setSentTo(newEmail);
        form.reset();
      } catch {
        setError(tc("requestFailed"));
      }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MailCheck className="size-5 text-muted-foreground" />
          <CardTitle>{t("emailTitle")}</CardTitle>
        </div>
        <CardDescription>{t("emailDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sentTo ? (
          <div className="space-y-3">
            <p className="text-body text-muted-foreground">
              {t.rich("emailSent", {
                email,
                newEmail: sentTo,
                strong: RENDER_STRONG,
              })}
            </p>
            <Button variant="outline" onClick={() => setSentTo(null)}>
              {t("useDifferentAddress")}
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
                    <FieldLabel htmlFor="newEmail">{t("newEmailLabel")}</FieldLabel>
                    <Input
                      id="newEmail"
                      name={field.name}
                      type="email"
                      placeholder={tAuth("emailPlaceholder")}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      autoComplete="email"
                    />
                    <FieldDescription>{t("newEmailDescription", { email })}</FieldDescription>
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
              {isSubmitting ? t("sending") : t("sendConfirmation")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
