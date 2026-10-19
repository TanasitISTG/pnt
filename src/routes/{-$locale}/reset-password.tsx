import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";
import { toast } from "sonner";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authErrorMessage } from "@/lib/auth/error-codes";
import { resetPassword } from "@/lib/auth/auth-client";
import { resetPasswordSearchSchema } from "@/lib/auth/search.schemas";
import { encodeMessage } from "@/lib/i18n/message-code";
import { localeParam } from "@/lib/i18n/locales";
import { headTranslator } from "@/lib/i18n/route-head";
import { translateServerError } from "@/lib/i18n/server-error";

const resetFormSchema = z
  .object({
    password: z
      .string()
      .min(8, encodeMessage("validation.passwordMin"))
      .max(128, encodeMessage("validation.passwordMax")),
    confirmPassword: z.string().min(1, encodeMessage("validation.confirmPasswordRequired")),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: encodeMessage("validation.passwordsDoNotMatch"),
  });

export const Route = createFileRoute("/{-$locale}/reset-password")({
  validateSearch: resetPasswordSearchSchema,
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [
        { title: `${t("auth.newPasswordTitle")} | ${t("meta.siteName")}` },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: ResetPasswordPage,
});

/**
 * Reached from the reset email. Better Auth appends `?token=` on success and
 * `?error=INVALID_TOKEN` when the link is spent or expired; both land here so the
 * reader gets an explanation rather than a raw JSON error page.
 */
function ResetPasswordPage() {
  const t = useTranslations("auth");
  const tRoot = useTranslations();
  const { token, error: linkError } = Route.useSearch();
  // The language this page is being read in, which the layout derives from the URL.
  const locale = useLocale();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { password: "", confirmPassword: "" },
    validators: { onSubmit: resetFormSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const parsed = resetFormSchema.parse(value);
        const { error: resetError } = await resetPassword({
          newPassword: parsed.password,
          token: token ?? "",
        });

        if (resetError) {
          setError(authErrorMessage(resetError, "auth.linkInvalid"));
          return;
        }

        // Resetting revokes every existing session, so the reader has to sign in again.
        toast.success(t("passwordUpdated"));
        await navigate({
          to: "/{-$locale}/login",
          params: { locale: localeParam(locale) },
          replace: true,
        });
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

  if (!token || linkError) {
    return (
      <AuthCard
        title={t("expiredLinkTitle")}
        description={t("expiredLinkDescription")}
        footer={
          <Link to="/{-$locale}/login" className="underline underline-offset-4 text-foreground">
            {t("backToSignIn")}
          </Link>
        }
      >
        <p className="text-body text-muted-foreground">{t("expiredLinkBody")}</p>
        <Button className="mt-5 w-full" render={<Link to="/{-$locale}/forgot-password" />}>
          {t("requestNewLink")}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("newPasswordTitle")}
      description={t("newPasswordDescription")}
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
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field name="password">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="password">{t("newPasswordLabel")}</FieldLabel>
                  <Input
                    id="password"
                    name={field.name}
                    type="password"
                    placeholder={t("newPasswordPlaceholder")}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                    autoComplete="new-password"
                    required
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="confirmPassword">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="confirmPassword">{t("confirmNewPasswordLabel")}</FieldLabel>
                  <Input
                    id="confirmPassword"
                    name={field.name}
                    type="password"
                    placeholder={t("confirmPasswordPlaceholder")}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                    autoComplete="new-password"
                    required
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          {error && (
            <p role="alert" className="text-caption text-destructive-text">
              {translateServerError(error, tRoot)}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
            {isSubmitting && <Spinner />}
            {isSubmitting ? t("updating") : t("updatePassword")}
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
