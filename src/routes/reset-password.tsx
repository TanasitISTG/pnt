import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { resetPassword } from "@/lib/auth/auth-client";
import { resetPasswordSearchSchema } from "@/lib/auth/search.schemas";

const resetFormSchema = z
  .object({
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

export const Route = createFileRoute("/reset-password")({
  validateSearch: resetPasswordSearchSchema,
  head: () => ({
    meta: [
      { title: "Choose a new password | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

/**
 * Reached from the reset email. Better Auth appends `?token=` on success and
 * `?error=INVALID_TOKEN` when the link is spent or expired; both land here so the
 * reader gets an explanation rather than a raw JSON error page.
 */
function ResetPasswordPage() {
  const { token, error: linkError } = Route.useSearch();
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
          setError(
            resetError.message ||
              "That reset link is no longer valid. Request a new one and try again.",
          );
          return;
        }

        // Resetting revokes every existing session, so the reader has to sign in again.
        toast.success("Password updated. Sign in with your new password.");
        await navigate({ to: "/login", replace: true });
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

  if (!token || linkError) {
    return (
      <AuthCard
        title="This link has expired"
        description="Reset links last one hour and can only be used once."
        footer={
          <Link to="/login" className="underline underline-offset-4 text-foreground">
            Back to sign in
          </Link>
        }
      >
        <p className="text-body text-muted-foreground">
          Request a new link and it will arrive in a moment.
        </p>
        <Button className="mt-5 w-full" render={<Link to="/forgot-password" />}>
          Request a new link
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Signing in everywhere else will be required afterwards."
      footer={
        <Link to="/login" className="underline underline-offset-4 text-foreground">
          Back to sign in
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
                  <FieldLabel htmlFor="password">New password</FieldLabel>
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
                  <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
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

          {error && (
            <p role="alert" className="text-caption text-destructive-text">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
            {isSubmitting && <Spinner />}
            {isSubmitting ? "Updating…" : "Update password"}
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
