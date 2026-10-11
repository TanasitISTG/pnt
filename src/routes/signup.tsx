import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { captchaFetchOptions } from "@/lib/auth/captcha";
import { signUp } from "@/lib/auth/auth-client";
import { getAuthMethods } from "@/lib/auth/functions";
import { authRedirectSearchSchema } from "@/lib/auth/search.schemas";

const signupFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Display name is required")
      .max(80, "Keep your display name under 80 characters"),
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(128, "Keep your password under 128 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const Route = createFileRoute("/signup")({
  validateSearch: authRedirectSearchSchema,
  loader: async () => ({ methods: await getAuthMethods() }),
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Create account | Pnt - Personal Novel Translator" },
      // A signup form has nothing to index and should not compete with the library.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
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
          setError(signUpErrorMessage(signUpError.message, signUpError.code));
          // A consumed challenge cannot be replayed, so a failed attempt needs a new one.
          setCaptchaToken(null);
          return;
        }

        const isInternal =
          redirectPath && redirectPath.startsWith("/") && !redirectPath.startsWith("//");
        queryClient.clear();
        await router.invalidate();
        await navigate({ to: isInternal ? redirectPath : "/", replace: true });
      } catch {
        setError("Something went wrong. Please try again.");
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
      title="Create your account"
      description="Start translating and publishing your own novels."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="underline underline-offset-4 text-foreground">
            Sign in
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
                  <FieldLabel htmlFor="name">Display name</FieldLabel>
                  <Input
                    id="name"
                    name={field.name}
                    type="text"
                    placeholder="The name readers will see"
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
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name={field.name}
                    type="email"
                    placeholder="you@example.com"
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
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    name={field.name}
                    type="password"
                    placeholder="At least 8 characters"
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
                  <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
                  <Input
                    id="confirmPassword"
                    name={field.name}
                    type="password"
                    placeholder="Repeat your password"
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
            <span>
              I agree to the{" "}
              <Link to="/terms" className="underline underline-offset-4 text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="underline underline-offset-4 text-foreground">
                Privacy Policy
              </Link>
              .
            </span>
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
              {error}
            </p>
          )}

          {/* The hint belongs to the button it explains, and is worded as a status
              rather than an instruction: the challenge is normally satisfied with the
              widget hidden, so telling the reader to complete something "above" would
              point at a box they may never see. */}
          <div className="flex flex-col gap-2">
            <Button type="submit" className="w-full" disabled={submitDisabled}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? "Creating account…" : "Create account"}
            </Button>

            {challengeRequired && !challengeSatisfied && (
              <p className="text-center text-caption text-muted-foreground">
                Waiting for the verification check to finish.
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
function signUpErrorMessage(message: string | undefined, code: string | undefined): string {
  const normalized = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (normalized.includes("exist")) {
    return "An account with this email already exists. Sign in instead, or reset your password if you have forgotten it.";
  }
  if (normalized.includes("password")) {
    return "That password is not accepted. Use at least 8 characters.";
  }
  if (normalized.includes("captcha") || normalized.includes("verification")) {
    return "The verification challenge failed. Reload the page and try again.";
  }
  return message || "Could not create your account. Please try again.";
}
