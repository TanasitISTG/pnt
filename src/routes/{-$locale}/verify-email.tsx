import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { sendVerificationEmail } from "@/lib/auth/auth-client";
import { verifyEmailSearchSchema } from "@/lib/auth/search.schemas";
import { encodeMessage } from "@/lib/i18n/message-code";
import { headTranslator } from "@/lib/i18n/route-head";

const resendFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, encodeMessage("validation.emailRequired"))
    .email(encodeMessage("validation.emailInvalid")),
});

export const Route = createFileRoute("/{-$locale}/verify-email")({
  validateSearch: verifyEmailSearchSchema,
  loader: async ({ context }) => ({
    signedInEmail: context.user?.email ?? null,
    alreadyVerified: context.user?.emailVerified ?? false,
  }),
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [
        { title: `${t("auth.verifyEmailTitle")} | ${t("meta.siteName")}` },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const t = useTranslations("auth");
  const { verified, error: linkError } = Route.useSearch();
  const { signedInEmail, alreadyVerified } = Route.useLoaderData();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: signedInEmail ?? "" },
    validators: { onSubmit: resendFormSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { email } = resendFormSchema.parse(value);
        const { error: sendError } = await sendVerificationEmail({
          email,
          callbackURL: "/verify-email?verified=1",
        });
        if (sendError) {
          setError(sendError.message || t("sendEmailFailed"));
          return;
        }
        setSentTo(email);
      } catch {
        setError(t("requestFailed"));
      }
    },
  });

  const [canSubmit, isSubmitting] = useStore(
    form.store,
    (state) => [state.canSubmit, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  if (verified) {
    return (
      <AuthCard
        title={t("emailConfirmedTitle")}
        description={t("emailConfirmedDescription")}
        footer={
          <Link to="/{-$locale}" className="underline underline-offset-4 text-foreground">
            {t("goToLibrary")}
          </Link>
        }
      >
        <p className="text-body text-muted-foreground">{t("emailConfirmedBody")}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={linkError ? t("verifyFailedTitle") : t("verifyEmailTitle")}
      description={linkError ? t("verifyFailedDescription") : t("verifyEmailDescription")}
      footer={
        <Link to="/{-$locale}" className="underline underline-offset-4 text-foreground">
          {t("continueToLibrary")}
        </Link>
      }
    >
      {alreadyVerified && !sentTo ? (
        <p className="text-body text-muted-foreground">{t("alreadyConfirmed")}</p>
      ) : sentTo ? (
        <div className="space-y-3">
          <p className="text-body text-muted-foreground">{t("verifySentTo", { email: sentTo })}</p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
          >
            {t("useDifferentAddress")}
          </Button>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="email">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="email">{t("emailLabel")}</FieldLabel>
                    <Input
                      id="email"
                      name={field.name}
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      autoComplete="email"
                      required
                    />
                    <FieldDescription>
                      {linkError ? t("requestLinkHint") : t("sendLinkHint")}
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

            <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? t("sending") : t("sendConfirmationLink")}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthCard>
  );
}
