import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { captchaFetchOptions } from "@/lib/auth/captcha";
import { requestPasswordReset } from "@/lib/auth/auth-client";
import { getAuthMethods } from "@/lib/auth/functions";
import { encodeMessage } from "@/lib/i18n/message-code";
import { localeParam } from "@/lib/i18n/locales";
import { headTranslator } from "@/lib/i18n/route-head";

const forgotPasswordFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, encodeMessage("validation.emailRequired"))
    .email(encodeMessage("validation.emailInvalid")),
});

export const Route = createFileRoute("/{-$locale}/forgot-password")({
  loader: async () => ({ methods: await getAuthMethods() }),
  beforeLoad: ({ context, params }) => {
    if (context.user) {
      throw redirect({
        to: "/{-$locale}",
        params: { locale: localeParam(params.locale) },
      });
    }
  },
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [
        { title: `${t("auth.resetPasswordTitle")} | ${t("meta.siteName")}` },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const { methods } = Route.useLoaderData();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const challengeRequired = methods.turnstileSiteKey !== null;
  const challengeSatisfied = !challengeRequired || captchaToken !== null;

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onSubmit: forgotPasswordFormSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { email } = forgotPasswordFormSchema.parse(value);
        const { error: resetError } = await requestPasswordReset(
          { email, redirectTo: "/reset-password" },
          captchaFetchOptions(captchaToken),
        );
        // A challenge cannot be replayed, so every attempt needs a fresh one.
        setCaptchaToken(null);
        if (resetError) {
          setError(resetError.message || t("sendResetFailed"));
          return;
        }
        setSubmitted(true);
      } catch {
        setCaptchaToken(null);
        setError(t("requestFailed"));
      }
    },
  });

  const [canSubmit, isSubmitting] = useStore(
    form.store,
    (state) => [state.canSubmit, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  if (submitted) {
    return (
      <AuthCard
        title={t("resetLinkSentTitle")}
        description={t("resetLinkSentDescription")}
        footer={
          <Link to="/{-$locale}/login" className="underline underline-offset-4 text-foreground">
            {t("backToSignIn")}
          </Link>
        }
      >
        {/* Deliberately identical whether or not the address exists, so this screen
            cannot be used to enumerate accounts. */}
        <p className="text-body text-muted-foreground">{t("resetLinkSentBody")}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("resetPasswordTitle")}
      description={t("resetPasswordDescription")}
      footer={
        <Link to="/{-$locale}/login" className="underline underline-offset-4 text-foreground">
          {t("backToSignIn")}
        </Link>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!challengeSatisfied) return;
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
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          {methods.turnstileSiteKey ? (
            <TurnstileWidget
              siteKey={methods.turnstileSiteKey}
              onToken={setCaptchaToken}
              className="w-full"
            />
          ) : null}

          {error && (
            <p role="alert" className="text-caption text-destructive-text">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={!canSubmit || isSubmitting || !challengeSatisfied}
          >
            {isSubmitting && <Spinner />}
            {isSubmitting ? t("sending") : t("sendResetLink")}
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
