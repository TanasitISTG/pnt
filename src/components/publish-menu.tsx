import { useEffect, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { ChevronDown, Globe } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { publishState } from "@/lib/content/publish";
import { formatLocalDateTime } from "@/lib/date-time";
import { useHydrated } from "@/lib/use-hydrated";

interface PublishMenuProps {
  publishedAt: Date | string | null | undefined;
  onChange: (publishedAt: Date | null) => void | Promise<void>;
  pending?: boolean;
  ariaLabel?: string;
}

const scheduleFormSchema = z.object({
  publishAt: z
    .string()
    .min(1, "Publish time is required")
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid publish time"),
});

// datetime-local values are local time with no timezone suffix.
function pad(number: number) {
  return String(number).padStart(2, "0");
}

function toLocalInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PublishMenu({
  publishedAt,
  onChange,
  pending = false,
  ariaLabel = "Publishing options",
}: PublishMenuProps) {
  const state = publishState(publishedAt);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Locale-dependent formatting waits for hydration so server and client snapshots agree.
  const mounted = useHydrated();
  const form = useForm({
    defaultValues: {
      publishAt: "",
    },
    validators: {
      onSubmit: scheduleFormSchema,
    },
    onSubmit: async ({ value }) => {
      const parsed = scheduleFormSchema.parse(value);
      await onChange(new Date(parsed.publishAt));
      setScheduleOpen(false);
    },
  });
  const [canSubmit, isSubmitting] = useStore(
    form.store,
    (formState) => [formState.canSubmit, formState.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  useEffect(() => {
    if (!scheduleOpen) return;
    const base = publishedAt ? new Date(publishedAt) : new Date();
    form.reset({ publishAt: toLocalInputValue(base) });
  }, [form, publishedAt, scheduleOpen]);

  const label =
    state === "draft"
      ? "Draft"
      : state === "live"
        ? "Live"
        : mounted
          ? `Scheduled ${formatLocalDateTime(publishedAt as string)}`
          : "Scheduled";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" disabled={pending} />}
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          {pending ? <Spinner /> : <Globe className="size-4" />}
          <span className="max-w-64 truncate">{label}</span>
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onChange(new Date())}>Publish now</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setScheduleOpen(true)}>Schedule…</DropdownMenuItem>
            {state !== "draft" && (
              <DropdownMenuItem onClick={() => onChange(null)}>Unpublish</DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={scheduleOpen}
        onOpenChange={(open) => {
          if (!open && (pending || form.state.isSubmitting)) return;
          setScheduleOpen(open);
        }}
      >
        <DialogContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <div className="flex flex-col gap-5">
              <DialogHeader>
                <DialogTitle>Schedule publish</DialogTitle>
                <DialogDescription>
                  Guests can see it once this time passes. Leave as-is to keep the current schedule.
                </DialogDescription>
              </DialogHeader>

              <form.Field name="publishAt">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="publish-at">Publish at</FieldLabel>
                      <Input
                        id="publish-at"
                        name={field.name}
                        type="datetime-local"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={invalid}
                        required
                      />
                      {invalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>

              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={pending} />}>
                  Cancel
                </DialogClose>
                <Button type="submit" disabled={!canSubmit || isSubmitting || pending}>
                  {(isSubmitting || pending) && <Spinner />}
                  Schedule
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
