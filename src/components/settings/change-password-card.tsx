import { useForm, useStore } from "@tanstack/react-form";
import { Key } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/settings/schemas";

const emptyPasswordForm: ChangePasswordInput = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const passwordFieldIds: Record<keyof ChangePasswordInput, string> = {
  currentPassword: "currentPassword",
  newPassword: "newPassword",
  confirmPassword: "confirmPassword",
};

export interface ChangePasswordCardProps {
  onSubmit: (data: ChangePasswordInput) => Promise<boolean>;
}

export function ChangePasswordCard({ onSubmit }: ChangePasswordCardProps) {
  const form = useForm({
    defaultValues: emptyPasswordForm,
    validators: { onSubmit: changePasswordSchema },
    onSubmitInvalid: ({ formApi, value }) => {
      const result = changePasswordSchema.safeParse(value);
      if (result.success) return;
      const invalidNames = result.error.issues
        .map((issue) => issue.path[0])
        .filter(
          (name): name is keyof ChangePasswordInput =>
            typeof name === "string" && name in passwordFieldIds,
        );
      for (const name of invalidNames) {
        formApi.setFieldMeta(name, (previous) => ({ ...previous, isTouched: true }));
      }
      const firstName = invalidNames[0];
      if (firstName) document.getElementById(passwordFieldIds[firstName])?.focus();
    },
    onSubmit: async ({ value }) => {
      if (await onSubmit(changePasswordSchema.parse(value))) form.reset();
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="size-5 text-muted-foreground" />
          <CardTitle>Account & Security</CardTitle>
        </div>
        <CardDescription>Update your admin account password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="max-w-md space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="currentPassword">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="currentPassword">Current Password</FieldLabel>
                  <Input
                    id="currentPassword"
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="newPassword">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="newPassword">New Password</FieldLabel>
                  <Input
                    id="newPassword"
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
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
                  <FieldLabel htmlFor="confirmPassword">Confirm New Password</FieldLabel>
                  <Input
                    id="confirmPassword"
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <div className="pt-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? "Updating…" : "Update Password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
