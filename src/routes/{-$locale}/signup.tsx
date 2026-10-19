import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { captchaFetchOptions } from "@/lib/auth/captcha";
import { authErrorMessage } from "@/lib/auth/error-codes";
import { signUp } from "@/lib/auth/auth-client";
import { getAuthMethods } from "@/lib/auth/functions";
import { encodeMessage } from "@/lib/i18n/message-code";
import { localeParam, localizedHref } from "@/lib/i18n/locales";
import { headTranslator } from "@/lib/i18n/route-head";
import { translateServerError } from "@/lib/i18n/server-error";
import { authRedirectSearchSchema } from "@/lib/auth/search.schemas";

// Field messages are keys (i18n.md §3): `FieldError` resolves them through the catalog of the
// page they are shown on, so a validation error is written once and read in either language.
const signupFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, encodeMessage("validation.displayNameRequired"))
      .max(80, encodeMessage("validation.displayNameMax")),
    email: z
      .string()
      .trim()
      .min(1, encodeMessage("validation.emailRequired"))
      .email(encodeMessage("validation.emailInvalid")),
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

export const Route = createFileRoute("/{-$locale}/signup")({
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
        { title: `${t("auth.createAccountTitle")} | ${t("meta.siteName")}` },
        // A signup form has nothing to index and should not compete with the library.
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: SignupPage,
});

/** The two links `auth.termsAgreement` wraps its policy names in. */
function TermsLink({ children }: { children: ReactNode }) {
  return (
    <Link to="/{-$locale}/terms" className="underline underline-offset-4 text-foreground">
      {children}
    </Link>
  );
}

function PrivacyLink({ children }: { children: ReactNode }) {
  return (
    <Link to="/{-$locale}/privacy" className="underline underline-offset-4 text-foreground">
      {children}
    </Link>
  );
}

/** Both tag functions at module scope, so they are stable references. */
const AGREEMENT_TAGS = {
  terms: (chunks: ReactNode) => <TermsLink>{chunks}</TermsLink>,
  privacy: (chunks: ReactNode) => <PrivacyLink>{chunks}</PrivacyLink>,
};

function SignupPage() {
  const t = useTranslations("auth");
  const tRoot = useTranslations();
  // The language this page is being read in, which the layout derives from the URL.
  // Every navigation out of here carries it, including the whole-document one after
  // sign-up, which the router would not rewrite on its own.
  const locale = useLocale();
  const { redirect: redirectPath } = Route.useSearch();
  const { methods } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const challengeRequired = methods.turnstileSiteKey !== null;
  const challengeSatisfied = !challengeRequired || captchaToken !== null;

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: signupFormSchema,
    },
    onSubmit: async ({ value }) => {
      setError(null);

      try {
        const parsed = signupFormSchema.parse(value);
        const { error: signUpError } = await signUp.email(
          {
            name: parsed.name,
            email: parsed.email,
            password: parsed.password,
          },
          captchaFetchOptions(captchaToken),
        );

        if (signUpError) {
          setError(authErrorMessage(signUpError, "auth.createAccountFailed"));
          // A consumed challenge cannot be replayed, so a failed attempt needs a new one.
          setCaptchaToken(null);
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

  const submitDisabled = !canSubmit || isSubmitting || !acceptedTerms || !challengeSatisfied;

  return (
    <AuthCard
      title={t("createAccountTitle")}
      description={t("createAccountDescription")}
      footer={
        <>
          {t("createAccountFooter")}{" "}
          <Link to="/{-$locale}/login" className="underline underline-offset-4 text-foreground">
            {t("signInSubmit")}
          </Link>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (submitDisabled) return;
          void form.handleSubmit();
        }}
      >
        {/* 16px between fields rather than the field system's 20px: four stacked
            fields plus a consent row and a challenge is the tallest form in the app,
            and the label/input pairing already groups each field on its own. */}
        <FieldGroup className="gap-4">
          <form.Field name="name">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="name">{t("displayNameLabel")}</FieldLabel>
                  <Input
                    id="name"
                    name={field.name}
                    type="text"
                    placeholder={t("displayNamePlaceholder")}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                    autoComplete="name"
                    required
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

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
                  <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
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
                  <FieldLabel htmlFor="confirmPassword">{t("confirmPasswordLabel")}</FieldLabel>
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

          <label
            htmlFor="accept-terms"
            className="flex items-start gap-3 text-caption text-muted-foreground"
          >
            <input
              id="accept-terms"
              name="acceptTerms"
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              required
            />
            <span>{t.rich("termsAgreement", AGREEMENT_TAGS)}</span>
          </label>

          {methods.turnstileSiteKey ? (
            <TurnstileWidget
              siteKey={methods.turnstileSiteKey}
              onToken={setCaptchaToken}
              className="w-full"
            />
          ) : null}

          {error && (
            <p role="alert" className="text-caption text-destructive-text">
              {translateServerError(error, tRoot)}
            </p>
          )}

          {/* The hint belongs to the button it explains, and is worded as a status
              rather than an instruction: the challenge is normally satisfied with the
              widget hidden, so telling the reader to complete something "above" would
              point at a box they may never see. */}
          <div className="flex flex-col gap-2">
            <Button type="submit" className="w-full" disabled={submitDisabled}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? t("createAccountSubmitting") : t("createAccountSubmit")}
            </Button>

            {challengeRequired && !challengeSatisfied && (
              <p className="text-center text-caption text-muted-foreground">
                {t("challengePending")}
              </p>
            )}
          </div>
        </FieldGroup>
      </form>

      {/* Below the credentials form, so the primary route is what the reader meets
          first and the separator above these buttons reads as "or continue with". */}
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

/**
 * Turns a sign-up failure into something a reader can act on.
 *
 * Signing up with an address that already exists is reported plainly rather than
 * masked: the alternative (`autoSignIn: false`) hides it, but then nobody gets a
 * session on signup. The message points at the two real remedies instead.
 */
