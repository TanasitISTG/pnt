import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { isInvalidCredentialsError } from "@/lib/auth/error-codes";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { captchaFetchOptions } from "@/lib/auth/captcha";
import { signIn } from "@/lib/auth/auth-client";
import { getAuthMethods } from "@/lib/auth/functions";
import { authRedirectSearchSchema } from "@/lib/auth/search.schemas";
import { encodeMessage } from "@/lib/i18n/message-code";
import { localeParam, localizedHref } from "@/lib/i18n/locales";
import { headTranslator } from "@/lib/i18n/route-head";

// The messages are keys, not sentences: a field error is rendered through the catalog of the
// page it appears on, which is the only place that knows the reader's language.
const loginFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, encodeMessage("validation.emailRequired"))
    .email(encodeMessage("validation.emailInvalid")),
  password: z.string().min(1, encodeMessage("validation.passwordRequired")),
});

export const Route = createFileRoute("/{-$locale}/login")({
  validateSearch: authRedirectSearchSchema,
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
        {
          title: `${t("auth.signInTitle")} | ${t("meta.siteName")}`,
        },
        {
          name: "robots",
          content: "noindex, nofollow",
        },
      ],
    };
  },
  component: LoginPage,
});

function LoginPage() {
  const t = useTranslations("auth");
  const { redirect: redirectPath } = Route.useSearch();
  const { methods } = Route.useLoaderData();
  // The language this page is being read in, which the layout derives from the URL.
  // Every navigation out of here carries it, including the whole-document one after
  // sign-in, which the router would not rewrite on its own.
  const locale = useLocale();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [credentialsRejected, setCredentialsRejected] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  // The captcha plugin verifies /sign-in/email as well as signup, so the widget has to
  // be rendered here too: without it every sign-in on a Turnstile deployment fails
  // with "Missing CAPTCHA response".
  const challengeRequired = methods.turnstileSiteKey !== null;
  const challengeSatisfied = !challengeRequired || captchaToken !== null;

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onSubmit: loginFormSchema,
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setCredentialsRejected(false);

      try {
        const credentials = loginFormSchema.parse(value);
        const { error: signInError } = await signIn.email(
          credentials,
          captchaFetchOptions(captchaToken),
        );
        if (signInError) {
          // A challenge cannot be replayed, so a failed attempt needs a fresh one.
          setCaptchaToken(null);
          // A suspension arrives through this same call, and it must not read as a
          // wrong password: the account's message stands alone, without the provider
          // hint that only helps someone who got their credentials wrong.
          setCredentialsRejected(isInvalidCredentialsError(signInError.code));
          setError(signInError.message || t("signInFailed"));
          return;
        }

        const isInternal =
          redirectPath && redirectPath.startsWith("/") && !redirectPath.startsWith("//");
        queryClient.clear();
        await router.invalidate();
        await navigate({
          href: localizedHref(isInternal ? (redirectPath as string) : "/", locale),
          replace: true,
        });
      } catch {
        setError(t("requestFailed"));
        setCaptchaToken(null);
      }
    },
  });
  const [canSubmit, isSubmitting] = useStore(
    form.store,
    (state) => [state.canSubmit, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  return (
    <AuthCard
      title={t("signInTitle")}
      description={t("signInDescription")}
      footer={
        <>
          {t("signInFooter")}{" "}
          <Link to="/{-$locale}/signup" className="underline underline-offset-4 text-foreground">
            {t("createAccountLink")}
          </Link>
        </>
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
        <FieldGroup className="gap-4">
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

          <form.Field name="password">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
                    <Link
                      to="/{-$locale}/forgot-password"
                      className="text-caption text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      {t("forgotPasswordLink")}
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name={field.name}
                    type="password"
                    placeholder={t("passwordPlaceholder")}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                    autoComplete="current-password"
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
            <div className="space-y-1">
              <p role="alert" className="text-caption text-destructive-text">
                {error}
              </p>
              {/* The most common dead end for a public launch: an account created with
                  Google or Discord has no password to enter here. */}
              {credentialsRejected && (methods.google || methods.discord) && (
                <p className="text-caption text-muted-foreground">{t("oauthPasswordHint")}</p>
              )}
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={!canSubmit || isSubmitting || !challengeSatisfied}
          >
            {isSubmitting && <Spinner />}
            {isSubmitting ? t("signInSubmitting") : t("signInSubmit")}
          </Button>

          {challengeRequired && !challengeSatisfied && (
            <p className="text-center text-caption text-muted-foreground">
              {t("challengePending")}
            </p>
          )}
        </FieldGroup>
      </form>

      <ProviderButtons
        google={methods.google}
        discord={methods.discord}
        callbackURL="/"
        disabled={isSubmitting}
        onError={setError}
      />
    </AuthCard>
  );
}
