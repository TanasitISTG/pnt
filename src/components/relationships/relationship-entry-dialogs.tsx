import { useEffect } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Check, X } from "lucide-react";

import {
  EMPTY_CHARACTER_FORM,
  EMPTY_RELATIONSHIP_FORM,
  characterEntryFormSchema,
  relationshipEntryFormSchema,
  type CharacterFormState,
  type RelationshipFormState,
} from "./relationship-entry-form";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type {
  CharacterProfile,
  Familiarity,
  RelationshipGender,
  SpeakerStatus,
} from "@/lib/relationships/schemas";

const relationshipGenderItems: Record<RelationshipGender, string> = {
  male: "Male",
  female: "Female",
  nonbinary: "Nonbinary",
  unknown: "Unknown",
};

const speakerStatusItems: Record<SpeakerStatus, string> = {
  lower: "Lower",
  peer: "Peer",
  higher: "Higher",
  unknown: "Unknown",
};

const familiarityItems: Record<Familiarity, string> = {
  intimate: "Intimate",
  close: "Close",
  familiar: "Familiar",
  distant: "Distant",
  unknown: "Unknown",
};

const characterFieldIds: Record<keyof CharacterFormState, string> = {
  sourceName: "character-source",
  targetName: "character-target",
  aliases: "character-aliases",
  gender: "character-gender",
  role: "character-role",
  notes: "character-notes",
  evidence: "character-evidence",
};

const relationshipFieldIds: Record<keyof RelationshipFormState, string> = {
  speakerId: "relationship-speaker",
  listenerId: "relationship-listener",
  relationship: "relationship-label",
  speakerStatus: "relationship-status",
  familiarity: "relationship-familiarity",
  selfPronoun: "relationship-self",
  addresseeTerm: "relationship-addressee",
  sentenceParticles: "relationship-particles",
  register: "relationship-register",
  notes: "relationship-notes",
  evidence: "relationship-evidence",
};

function errorIdOf(fieldId: string): string {
  return `${fieldId}-error`;
}

function describedBy(...ids: Array<string | undefined>): string | undefined {
  const joined = ids.filter((id): id is string => Boolean(id)).join(" ");
  return joined === "" ? undefined : joined;
}

export interface CharacterDialogDescriptor {
  id?: string;
  initialValues: CharacterFormState;
}

export interface RelationshipDialogDescriptor {
  id?: string;
  initialValues: RelationshipFormState;
}

interface CharacterFormDialogProps {
  descriptor: CharacterDialogDescriptor | null;
  targetLanguage: string;
  saving: boolean;
  onSubmit: (value: CharacterFormState) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}

export function CharacterFormDialog({
  descriptor,
  targetLanguage,
  saving,
  onSubmit,
  onOpenChange,
}: CharacterFormDialogProps) {
  const form = useForm({
    defaultValues: EMPTY_CHARACTER_FORM,
    validators: { onSubmit: characterEntryFormSchema },
    onSubmitInvalid: ({ formApi, value }) => {
      const result = characterEntryFormSchema.safeParse(value);
      if (result.success) return;
      const invalidNames = result.error.issues
        .map((issue) => issue.path[0])
        .filter(
          (name): name is keyof CharacterFormState =>
            typeof name === "string" && name in characterFieldIds,
        );
      for (const name of invalidNames) {
        formApi.setFieldMeta(name, (previous) => ({ ...previous, isTouched: true }));
      }
      const firstName = invalidNames[0];
      if (firstName) document.getElementById(characterFieldIds[firstName])?.focus();
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const pending = saving || isSubmitting;

  useEffect(() => {
    if (!descriptor) return;
    form.reset(descriptor.initialValues, { keepDefaultValues: true });
  }, [descriptor, form]);

  return (
    <Dialog
      open={descriptor !== null}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {descriptor?.id ? "Edit character profile" : "Add character profile"}
          </DialogTitle>
          <DialogDescription>
            Manual saves are locked so automatic analysis cannot replace them.
          </DialogDescription>
        </DialogHeader>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              aria-label="Close character profile dialog"
              disabled={pending}
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        {descriptor && (
          <form
            noValidate
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="sourceName">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(characterFieldIds.sourceName);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={characterFieldIds.sourceName}>Source name</FieldLabel>
                    <Input
                      id={characterFieldIds.sourceName}
                      name={field.name}
                      value={field.state.value}
                      maxLength={120}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="targetName">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const hintId = "character-target-hint";
                const errorId = errorIdOf(characterFieldIds.targetName);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={characterFieldIds.targetName}>
                      {targetLanguage} name
                    </FieldLabel>
                    <Input
                      id={characterFieldIds.targetName}
                      name={field.name}
                      value={field.state.value}
                      maxLength={120}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={describedBy(hintId, invalid ? errorId : undefined)}
                    />
                    <FieldDescription id={hintId}>
                      An approved character glossary mapping wins at translation time.
                    </FieldDescription>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="aliases">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const hintId = "character-aliases-hint";
                const errorId = errorIdOf(characterFieldIds.aliases);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={characterFieldIds.aliases}>Aliases</FieldLabel>
                    <Input
                      id={characterFieldIds.aliases}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={describedBy(hintId, invalid ? errorId : undefined)}
                    />
                    <FieldDescription id={hintId}>Comma-separated; up to eight.</FieldDescription>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="gender">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(characterFieldIds.gender);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={characterFieldIds.gender}>Gender</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value}
                      items={relationshipGenderItems}
                      onValueChange={(value) =>
                        value && field.handleChange(value as RelationshipGender)
                      }
                    >
                      <SelectTrigger
                        id={characterFieldIds.gender}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="nonbinary">Nonbinary</SelectItem>
                          <SelectItem value="unknown">Unknown</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="role">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(characterFieldIds.role);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={characterFieldIds.role}>Role</FieldLabel>
                    <Input
                      id={characterFieldIds.role}
                      name={field.name}
                      value={field.state.value}
                      maxLength={160}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="notes">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(characterFieldIds.notes);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={characterFieldIds.notes}>Notes</FieldLabel>
                    <Textarea
                      id={characterFieldIds.notes}
                      name={field.name}
                      value={field.state.value}
                      maxLength={500}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="evidence">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const hintId = "character-evidence-hint";
                const errorId = errorIdOf(characterFieldIds.evidence);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={characterFieldIds.evidence}>Evidence</FieldLabel>
                    <Textarea
                      id={characterFieldIds.evidence}
                      name={field.name}
                      value={field.state.value}
                      maxLength={300}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={describedBy(hintId, invalid ? errorId : undefined)}
                    />
                    <FieldDescription id={hintId}>
                      Optional source excerpt for the fact.
                    </FieldDescription>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : <Check className="size-4" />}
                {pending ? "Saving…" : "Save character"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RelationshipFormDialogProps {
  descriptor: RelationshipDialogDescriptor | null;
  characters: CharacterProfile[];
  saving: boolean;
  onSubmit: (value: RelationshipFormState) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}

export function RelationshipFormDialog({
  descriptor,
  characters,
  saving,
  onSubmit,
  onOpenChange,
}: RelationshipFormDialogProps) {
  const form = useForm({
    defaultValues: EMPTY_RELATIONSHIP_FORM,
    validators: { onSubmit: relationshipEntryFormSchema },
    onSubmitInvalid: ({ formApi, value }) => {
      const result = relationshipEntryFormSchema.safeParse(value);
      if (result.success) return;
      const invalidNames = result.error.issues
        .map((issue) => issue.path[0])
        .filter(
          (name): name is keyof RelationshipFormState =>
            typeof name === "string" && name in relationshipFieldIds,
        );
      for (const name of invalidNames) {
        formApi.setFieldMeta(name, (previous) => ({ ...previous, isTouched: true }));
      }
      const firstName = invalidNames[0];
      if (firstName) document.getElementById(relationshipFieldIds[firstName])?.focus();
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const pending = saving || isSubmitting;

  useEffect(() => {
    if (!descriptor) return;
    form.reset(descriptor.initialValues, { keepDefaultValues: true });
  }, [descriptor, form]);

  return (
    <Dialog
      open={descriptor !== null}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {descriptor?.id ? "Edit directed relationship" : "Add directed relationship"}
          </DialogTitle>
          <DialogDescription>
            Choose the speaker and listener first; pronouns and particles are directional.
          </DialogDescription>
        </DialogHeader>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              aria-label="Close directed relationship dialog"
              disabled={pending}
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        {descriptor && (
          <form
            noValidate
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="speakerId">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(relationshipFieldIds.speakerId);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={relationshipFieldIds.speakerId}>Speaker</FieldLabel>
                    <CharacterSelect
                      id={relationshipFieldIds.speakerId}
                      name={field.name}
                      value={field.state.value}
                      characters={characters}
                      onBlur={field.handleBlur}
                      onValueChange={field.handleChange}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="listenerId">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(relationshipFieldIds.listenerId);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={relationshipFieldIds.listenerId}>Listener</FieldLabel>
                    <CharacterSelect
                      id={relationshipFieldIds.listenerId}
                      name={field.name}
                      value={field.state.value}
                      characters={characters}
                      onBlur={field.handleBlur}
                      onValueChange={field.handleChange}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="relationship">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(relationshipFieldIds.relationship);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={relationshipFieldIds.relationship}>
                      Relationship
                    </FieldLabel>
                    <Input
                      id={relationshipFieldIds.relationship}
                      name={field.name}
                      value={field.state.value}
                      maxLength={160}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="speakerStatus">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(relationshipFieldIds.speakerStatus);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={relationshipFieldIds.speakerStatus}>
                      Speaker status
                    </FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value}
                      items={speakerStatusItems}
                      onValueChange={(value) => value && field.handleChange(value as SpeakerStatus)}
                    >
                      <SelectTrigger
                        id={relationshipFieldIds.speakerStatus}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="lower">Lower</SelectItem>
                          <SelectItem value="peer">Peer</SelectItem>
                          <SelectItem value="higher">Higher</SelectItem>
                          <SelectItem value="unknown">Unknown</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="familiarity">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = errorIdOf(relationshipFieldIds.familiarity);
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor={relationshipFieldIds.familiarity}>Familiarity</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value}
                      items={familiarityItems}
                      onValueChange={(value) => value && field.handleChange(value as Familiarity)}
                    >
                      <SelectTrigger
                        id={relationshipFieldIds.familiarity}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="intimate">Intimate</SelectItem>
                          <SelectItem value="close">Close</SelectItem>
                          <SelectItem value="familiar">Familiar</SelectItem>
                          <SelectItem value="distant">Distant</SelectItem>
                          <SelectItem value="unknown">Unknown</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Field name="selfPronoun">
              {(field) => (
                <TextEntryField
                  id={relationshipFieldIds.selfPronoun}
                  label="Preferred self-pronoun"
                  field={field}
                  maxLength={80}
                />
              )}
            </form.Field>
            <form.Field name="addresseeTerm">
              {(field) => (
                <TextEntryField
                  id={relationshipFieldIds.addresseeTerm}
                  label="Addressee term / title"
                  field={field}
                  maxLength={80}
                />
              )}
            </form.Field>
            <form.Field name="sentenceParticles">
              {(field) => (
                <TextEntryField
                  id={relationshipFieldIds.sentenceParticles}
                  label="Sentence particles"
                  field={field}
                  maxLength={80}
                />
              )}
            </form.Field>
            <form.Field name="register">
              {(field) => (
                <TextEntryField
                  id={relationshipFieldIds.register}
                  label="Register"
                  field={field}
                  maxLength={160}
                />
              )}
            </form.Field>
            <form.Field name="notes">
              {(field) => (
                <TextareaEntryField
                  id={relationshipFieldIds.notes}
                  label="Notes"
                  field={field}
                  maxLength={500}
                />
              )}
            </form.Field>
            <form.Field name="evidence">
              {(field) => (
                <TextareaEntryField
                  id={relationshipFieldIds.evidence}
                  label="Evidence"
                  field={field}
                  maxLength={300}
                />
              )}
            </form.Field>
            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || characters.length < 2}>
                {pending ? <Spinner /> : <Check className="size-4" />}
                {pending ? "Saving…" : "Save relationship"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface StringFieldAdapter {
  name: string;
  state: {
    value: string;
    meta: {
      isTouched: boolean;
      isValid: boolean;
      errors: ({ message?: string } | undefined)[];
    };
  };
  handleBlur: () => void;
  handleChange: (value: string) => void;
}

function TextEntryField({
  id,
  label,
  field,
  maxLength,
}: {
  id: string;
  label: string;
  field: StringFieldAdapter;
  maxLength: number;
}) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const errorId = errorIdOf(id);
  return (
    <Field data-invalid={invalid || undefined} className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={field.name}
        value={field.state.value}
        maxLength={maxLength}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
      />
      {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
    </Field>
  );
}

function TextareaEntryField({
  id,
  label,
  field,
  maxLength,
}: {
  id: string;
  label: string;
  field: StringFieldAdapter;
  maxLength: number;
}) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const errorId = errorIdOf(id);
  return (
    <Field data-invalid={invalid || undefined} className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={field.name}
        value={field.state.value}
        maxLength={maxLength}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
      />
      {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
    </Field>
  );
}

function CharacterSelect({
  id,
  name,
  value,
  characters,
  onValueChange,
  onBlur,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  name: string;
  value: string;
  characters: CharacterProfile[];
  onValueChange: (value: string) => void;
  onBlur: () => void;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <Select
      name={name}
      value={value}
      items={Object.fromEntries(
        characters.map((character) => [
          character.id,
          `${character.sourceName}${character.targetName ? ` · ${character.targetName}` : ""}`,
        ]),
      )}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
    >
      <SelectTrigger
        id={id}
        onBlur={onBlur}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      >
        <SelectValue placeholder="Select character" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {characters.map((character) => (
            <SelectItem key={character.id} value={character.id}>
              {character.sourceName}
              {character.targetName ? ` · ${character.targetName}` : ""}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
