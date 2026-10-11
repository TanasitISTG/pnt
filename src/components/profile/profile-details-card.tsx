import { useForm, useStore } from "@tanstack/react-form";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  PROFILE_NAME_MAX_LENGTH,
  updateProfileNameSchema,
  type UpdateProfileNameInput,
} from "@/lib/profile/schemas";

export interface ProfileDetailsCardProps {
  initialName: string;
  email: string;
  onSubmit: (data: UpdateProfileNameInput) => Promise<boolean>;
}

export function ProfileDetailsCard({ initialName, email, onSubmit }: ProfileDetailsCardProps) {
  const form = useForm({
    defaultValues: { name: initialName } satisfies UpdateProfileNameInput,
    validators: { onSubmit: updateProfileNameSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(updateProfileNameSchema.parse(value));
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserRound className="size-5 text-muted-foreground" />
          <CardTitle>Profile Details</CardTitle>
        </div>
        <CardDescription>The name other readers will see beside your novels.</CardDescription>
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
          <form.Field name="name">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="displayName">Display Name</FieldLabel>
                  <Input
                    id="displayName"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    // The stored limit is also a typing limit: a name the schema would
                    // refuse should never get as far as being typed and rejected.
                    maxLength={PROFILE_NAME_MAX_LENGTH}
                    aria-invalid={invalid}
                    autoComplete="nickname"
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <Field>
            <FieldLabel htmlFor="profileEmail" variant="mutedCaption">
              Email
            </FieldLabel>
            <Input id="profileEmail" value={email} readOnly disabled />
            <FieldDescription>Used to sign in. Change it in the email card below.</FieldDescription>
          </Field>
          <div className="pt-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              {isSubmitting ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
