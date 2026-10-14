import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { sendVerificationEmail } from "@/lib/auth/auth-client";
import { verifyEmailSearchSchema } from "@/lib/auth/search.schemas";

const resendFormSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

export const Route = createFileRoute("/verify-email")({
  validateSearch: verifyEmailSearchSchema,
  loader: async ({ context }) => ({
    signedInEmail: context.user?.email ?? null,
    alreadyVerified: context.user?.emailVerified ?? false,
  }),
  head: () => ({
    meta: [
      { title: "Verify your email | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
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
          setError(sendError.message || "Could not send the email. Try again.");
          return;
        }
        setSentTo(email);
      } catch {
        setError("The request did not finish. Try again.");
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
        title="Email confirmed"
        description="Your address is verified. Nothing else is needed."
        footer={
          <Link to="/" className="underline underline-offset-4 text-foreground">
            Go to the library
          </Link>
        }
      >
        <p className="text-body text-muted-foreground">
          A confirmed address means password recovery reaches you reliably.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={linkError ? "That link did not work" : "Confirm your email"}
      description={
        linkError
          ? "The link was already used or has expired."
          : "Verification is optional, but it keeps your account recoverable."
      }
      footer={
        <Link to="/" className="underline underline-offset-4 text-foreground">
          Continue to the library
        </Link>
      }
    >
      {alreadyVerified && !sentTo ? (
        <p className="text-body text-muted-foreground">
          This account&rsquo;s email is already confirmed.
        </p>
      ) : sentTo ? (
        <div className="space-y-3">
          <p className="text-body text-muted-foreground">
            If an account exists for {sentTo}, a fresh confirmation link is on its way. The link
            expires in one hour.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
          >
            Use a different address
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
                    <FieldDescription>
                      {linkError
                        ? "Request a new confirmation link."
                        : "Send a new confirmation link to this address."}
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
              {isSubmitting ? "Sending…" : "Send confirmation link"}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthCard>
  );
}
