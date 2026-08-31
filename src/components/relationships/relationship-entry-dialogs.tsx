import { Check, Loader2, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  CharacterProfile,
  Familiarity,
  RelationshipGender,
  SpeakerStatus,
} from "@/lib/relationships/schemas";

export type CharacterFormState = {
  id?: string;
  sourceName: string;
  targetName: string;
  aliases: string;
  gender: RelationshipGender;
  role: string;
  notes: string;
  evidence: string;
};

export type RelationshipFormState = {
  id?: string;
  speakerId: string;
  listenerId: string;
  relationship: string;
  speakerStatus: SpeakerStatus;
  familiarity: Familiarity;
  selfPronoun: string;
  addresseeTerm: string;
  sentenceParticles: string;
  register: string;
  notes: string;
  evidence: string;
};

export const EMPTY_CHARACTER_FORM: CharacterFormState = {
  sourceName: "",
  targetName: "",
  aliases: "",
  gender: "unknown",
  role: "",
  notes: "",
  evidence: "",
};

export const EMPTY_RELATIONSHIP_FORM: RelationshipFormState = {
  speakerId: "",
  listenerId: "",
  relationship: "",
  speakerStatus: "unknown",
  familiarity: "unknown",
  selfPronoun: "",
  addresseeTerm: "",
  sentenceParticles: "",
  register: "",
  notes: "",
  evidence: "",
};

const relationshipGenderItems: Record<string, string> = {
  male: "Male",
  female: "Female",
  nonbinary: "Nonbinary",
  unknown: "Unknown",
};

const speakerStatusItems: Record<string, string> = {
  lower: "Lower",
  peer: "Peer",
  higher: "Higher",
  unknown: "Unknown",
};

const familiarityItems: Record<string, string> = {
  intimate: "Intimate",
  close: "Close",
  familiar: "Familiar",
  distant: "Distant",
  unknown: "Unknown",
};

interface CharacterFormDialogProps {
  form: CharacterFormState | null;
  errors: Record<string, string>;
  saving: boolean;
  onChange: (form: CharacterFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenChange: (open: boolean) => void;
}

export function CharacterFormDialog({
  form,
  errors,
  saving,
  onChange,
  onSubmit,
  onOpenChange,
}: CharacterFormDialogProps) {
  const open = form !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{form?.id ? "Edit character profile" : "Add character profile"}</DialogTitle>
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
              disabled={saving}
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        {form && (
          <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
            <FormField id="character-source" label="Source name" error={errors.sourceName}>
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.sourceName}
                  maxLength={120}
                  onChange={(event) => onChange({ ...form, sourceName: event.target.value })}
                />
              )}
            </FormField>
            <FormField
              id="character-target"
              label="Thai name"
              hint="An approved character glossary mapping wins at translation time."
              error={errors.targetName}
            >
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.targetName}
                  maxLength={120}
                  onChange={(event) => onChange({ ...form, targetName: event.target.value })}
                />
              )}
            </FormField>
            <FormField
              id="character-aliases"
              label="Aliases"
              hint="Comma-separated; up to eight."
              error={errors.aliases}
            >
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.aliases}
                  onChange={(event) => onChange({ ...form, aliases: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="character-gender" label="Gender" error={errors.gender}>
              {({ id, ...fieldProps }) => (
                <Select
                  value={form.gender}
                  items={relationshipGenderItems}
                  onValueChange={(value) =>
                    onChange({ ...form, gender: value as RelationshipGender })
                  }
                >
                  <SelectTrigger {...fieldProps} id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="nonbinary">Nonbinary</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField id="character-role" label="Role" error={errors.role}>
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.role}
                  maxLength={160}
                  onChange={(event) => onChange({ ...form, role: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="character-notes" label="Notes" error={errors.notes}>
              {({ id, ...fieldProps }) => (
                <Textarea
                  {...fieldProps}
                  id={id}
                  value={form.notes}
                  maxLength={500}
                  onChange={(event) => onChange({ ...form, notes: event.target.value })}
                />
              )}
            </FormField>
            <FormField
              id="character-evidence"
              label="Evidence"
              hint="Optional source excerpt for the fact."
              error={errors.evidence}
            >
              {({ id, ...fieldProps }) => (
                <Textarea
                  {...fieldProps}
                  id={id}
                  value={form.evidence}
                  maxLength={300}
                  onChange={(event) => onChange({ ...form, evidence: event.target.value })}
                />
              )}
            </FormField>
            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
                {!saving && <Check className="size-4" />}
                {saving ? "Saving…" : "Save character"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RelationshipFormDialogProps {
  form: RelationshipFormState | null;
  characters: CharacterProfile[];
  errors: Record<string, string>;
  saving: boolean;
  onChange: (form: RelationshipFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenChange: (open: boolean) => void;
}

export function RelationshipFormDialog({
  form,
  characters,
  errors,
  saving,
  onChange,
  onSubmit,
  onOpenChange,
}: RelationshipFormDialogProps) {
  const open = form !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {form?.id ? "Edit directed relationship" : "Add directed relationship"}
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
              disabled={saving}
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        {form && (
          <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
            <FormField id="relationship-speaker" label="Speaker" error={errors.speakerId}>
              {({ id, ...fieldProps }) => (
                <CharacterSelect
                  id={id}
                  {...fieldProps}
                  value={form.speakerId}
                  characters={characters}
                  onValueChange={(value) => onChange({ ...form, speakerId: value })}
                />
              )}
            </FormField>
            <FormField id="relationship-listener" label="Listener" error={errors.listenerId}>
              {({ id, ...fieldProps }) => (
                <CharacterSelect
                  id={id}
                  {...fieldProps}
                  value={form.listenerId}
                  characters={characters}
                  onValueChange={(value) => onChange({ ...form, listenerId: value })}
                />
              )}
            </FormField>
            <FormField id="relationship-label" label="Relationship" error={errors.relationship}>
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.relationship}
                  maxLength={160}
                  onChange={(event) => onChange({ ...form, relationship: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="relationship-status" label="Speaker status" error={errors.speakerStatus}>
              {({ id, ...fieldProps }) => (
                <Select
                  value={form.speakerStatus}
                  items={speakerStatusItems}
                  onValueChange={(value) =>
                    onChange({ ...form, speakerStatus: value as SpeakerStatus })
                  }
                >
                  <SelectTrigger {...fieldProps} id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lower">Lower</SelectItem>
                    <SelectItem value="peer">Peer</SelectItem>
                    <SelectItem value="higher">Higher</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField id="relationship-familiarity" label="Familiarity" error={errors.familiarity}>
              {({ id, ...fieldProps }) => (
                <Select
                  value={form.familiarity}
                  items={familiarityItems}
                  onValueChange={(value) =>
                    onChange({ ...form, familiarity: value as Familiarity })
                  }
                >
                  <SelectTrigger {...fieldProps} id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="intimate">Intimate</SelectItem>
                    <SelectItem value="close">Close</SelectItem>
                    <SelectItem value="familiar">Familiar</SelectItem>
                    <SelectItem value="distant">Distant</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField
              id="relationship-self"
              label="Preferred self-pronoun"
              error={errors.selfPronoun}
            >
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.selfPronoun}
                  maxLength={80}
                  onChange={(event) => onChange({ ...form, selfPronoun: event.target.value })}
                />
              )}
            </FormField>
            <FormField
              id="relationship-addressee"
              label="Addressee term / title"
              error={errors.addresseeTerm}
            >
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.addresseeTerm}
                  maxLength={80}
                  onChange={(event) => onChange({ ...form, addresseeTerm: event.target.value })}
                />
              )}
            </FormField>
            <FormField
              id="relationship-particles"
              label="Sentence particles"
              error={errors.sentenceParticles}
            >
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.sentenceParticles}
                  maxLength={80}
                  onChange={(event) => onChange({ ...form, sentenceParticles: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="relationship-register" label="Register" error={errors.register}>
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={form.register}
                  maxLength={160}
                  onChange={(event) => onChange({ ...form, register: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="relationship-notes" label="Notes" error={errors.notes}>
              {({ id, ...fieldProps }) => (
                <Textarea
                  {...fieldProps}
                  id={id}
                  value={form.notes}
                  maxLength={500}
                  onChange={(event) => onChange({ ...form, notes: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="relationship-evidence" label="Evidence" error={errors.evidence}>
              {({ id, ...fieldProps }) => (
                <Textarea
                  {...fieldProps}
                  id={id}
                  value={form.evidence}
                  maxLength={300}
                  onChange={(event) => onChange({ ...form, evidence: event.target.value })}
                />
              )}
            </FormField>
            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || characters.length < 2}>
                {saving && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
                {!saving && <Check className="size-4" />}
                {saving ? "Saving…" : "Save relationship"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CharacterSelect({
  id,
  value,
  characters,
  onValueChange,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: {
  id: string;
  value: string;
  characters: CharacterProfile[];
  onValueChange: (value: string) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <Select
      value={value}
      items={Object.fromEntries(
        characters.map((character) => [
          character.id,
          `${character.sourceName}${character.targetName ? ` · ${character.targetName}` : ""}`,
        ]),
      )}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
    >
      <SelectTrigger id={id} aria-describedby={ariaDescribedby} aria-invalid={ariaInvalid}>
        <SelectValue placeholder="Select character" />
      </SelectTrigger>
      <SelectContent>
        {characters.map((character) => (
          <SelectItem key={character.id} value={character.id}>
            {character.sourceName}
            {character.targetName ? ` · ${character.targetName}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid": boolean;
};

function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter((value): value is string => Boolean(value)).join(" ") || undefined;

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error),
      })}
      {hint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function splitAliases(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export function toFieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field !== undefined && fieldErrors[String(field)] === undefined) {
      fieldErrors[String(field)] = issue.message;
    }
  }
  return fieldErrors;
}
