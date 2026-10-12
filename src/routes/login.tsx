import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { isInvalidCredentialsError } from "@/lib/auth/error-codes";
import { ProviderButtons } from "@/components/auth/provider-buttons";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { signIn } from "@/lib/auth/auth-client";
import { getAuthMethods } from "@/lib/auth/functions";
import { authRedirectSearchSchema } from "@/lib/auth/search.schemas";

const loginFormSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const Route = createFileRoute("/login")({
  validateSearch: authRedirectSearchSchema,
  loader: async () => ({ methods: await getAuthMethods() }),
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      {
        title: "Login | Pnt - Personal Novel Translator",
      },
      {
        name: "robots",
        content: "noindex, nofollow",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect: redirectPath } = Route.useSearch();
  const { methods } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [credentialsRejected, setCredentialsRejected] = useState(false);

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
        const { error: signInError } = await signIn.email(credentials);
        if (signInError) {
          // A suspension arrives through this same call, and it must not read as a
          // wrong password: the account's message stands alone, without the provider
          // hint that only helps someone who got their credentials wrong.
          setCredentialsRejected(isInvalidCredentialsError(signInError.code));
          setError(signInError.message || "Invalid credentials");
          return;
        }

        const isInternal =
          redirectPath && redirectPath.startsWith("/") && !redirectPath.startsWith("//");
        queryClient.clear();
        await router.invalidate();
        await navigate({ to: isInternal ? redirectPath : "/", replace: true });
      } catch {
        setError("Something went wrong. Please try again.");
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
      title="Sign in"
      description="Access your library, or read what others have published."
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="underline underline-offset-4 text-foreground">
            Create an account
          </Link>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup className="gap-4">
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
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Link
                      to="/forgot-password"
                      className="text-caption text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name={field.name}
                    type="password"
                    placeholder="••••••••"
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

          {error && (
            <div className="space-y-1">
              <p role="alert" className="text-caption text-destructive-text">
                {error}
              </p>
              {/* The most common dead end for a public launch: an account created with
                  Google or Discord has no password to enter here. */}
              {credentialsRejected && (methods.google || methods.discord) && (
                <p className="text-caption text-muted-foreground">
                  Signed up with Google or Discord? Use that button below — or reset your password
                  to set one.
                </p>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
            {isSubmitting && <Spinner />}
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
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
