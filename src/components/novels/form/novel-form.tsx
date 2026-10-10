import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";

import { CoverUpload } from "@/components/novels/form/cover-upload";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { coverMimeSchema, createNovelSchema } from "@/lib/content/novel/novel.schemas";
import { isSupportedLanguagePair } from "@/lib/language-pair";

type NovelFormData = z.input<typeof createNovelSchema> & {
  removeCover?: boolean;
};

type NovelFormValues = {
  title: string;
  originalTitle: string;
  author: string;
  description: string;
  sourceLang: "en" | "zh";
  targetLang: "en" | "th";
  customPrompt: string;
  chunkSize: string;
  contextTailLength: string;
  cover: string | null;
  coverMime: z.infer<typeof coverMimeSchema> | null;
  removeCover: boolean;
};

interface NovelFormProps {
  defaultValues?: Partial<NovelFormData> & { id?: string; hasCover?: boolean };
  onSubmit: (data: NovelFormData) => Promise<void>;
  submitLabel: string;
}

const SOURCE_LANG_ITEMS: Record<string, string> = {
  en: "English (EN)",
  zh: "Chinese (ZH)",
};

const TARGET_LANG_ITEMS: Record<string, string> = {
  th: "Thai (TH)",
  en: "English (EN)",
};

const integerInputSchema = (label: string, minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(/^\d+$/, `${label} must be a whole number`)
    .refine((value) => {
      const number = Number(value);
      return number >= minimum && number <= maximum;
    }, `${label} must be between ${minimum} and ${maximum}`);

const novelFormSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(500),
    originalTitle: z.string().max(500),
    author: z.string().max(200),
    description: z.string().max(5000),
    sourceLang: z.enum(["en", "zh"]),
    targetLang: z.enum(["en", "th"]),
    customPrompt: z.string().max(10000),
    chunkSize: integerInputSchema("Chunk size", 500, 10000),
    contextTailLength: integerInputSchema("Context tail length", 100, 2000),
    cover: z.string().max(1_400_000).nullable(),
    coverMime: coverMimeSchema.nullable(),
    removeCover: z.boolean(),
  })
  .refine((data) => !data.cover || !!data.coverMime, {
    message: "Cover MIME type is required when cover image is provided",
    path: ["cover"],
  })
  .refine((data) => isSupportedLanguagePair(data.sourceLang, data.targetLang), {
    message: "Unsupported language pair — use EN→TH, ZH→EN, or ZH→TH",
    path: ["targetLang"],
  });

function createInitialNovelForm(defaultValues: NovelFormProps["defaultValues"]): NovelFormValues {
  return {
    title: defaultValues?.title || "",
    originalTitle: defaultValues?.originalTitle || "",
    author: defaultValues?.author || "",
    description: defaultValues?.description || "",
    sourceLang: defaultValues?.sourceLang || "en",
    targetLang: defaultValues?.targetLang || "th",
    customPrompt: defaultValues?.customPrompt || "",
    chunkSize: String(defaultValues?.chunkSize ?? 4000),
    contextTailLength: String(defaultValues?.contextTailLength ?? 500),
    cover: defaultValues?.cover ?? null,
    coverMime: defaultValues?.coverMime ?? null,
    removeCover: false,
  };
}

export function NovelForm({ defaultValues, onSubmit, submitLabel }: NovelFormProps) {
  const form = useForm({
    defaultValues: createInitialNovelForm(defaultValues),
    validators: {
      onSubmit: novelFormSchema,
    },
    onSubmit: async ({ value }) => {
      const parsed = novelFormSchema.parse(value);
      const novel = createNovelSchema.parse({
        ...parsed,
        chunkSize: Number(parsed.chunkSize),
        contextTailLength: Number(parsed.contextTailLength),
      });
      try {
        await onSubmit({ ...novel, removeCover: parsed.removeCover });
      } catch {
        // The caller owns the error toast; keep the form intact for another attempt.
      }
    },
  });
  const [canSubmit, isSubmitting] = useStore(
    form.store,
    (state) => [state.canSubmit, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );
  const sourceLang = useStore(form.store, (state) => state.values.sourceLang);
  const coverMime = useStore(form.store, (state) => state.values.coverMime);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex max-w-2xl flex-col gap-6 rounded-xl border border-border bg-card p-6"
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto]">
        <FieldGroup className="flex-1 gap-4">
          <form.Field name="title">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="title">Title *</FieldLabel>
                  <Input
                    id="title"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="e.g. Solo Leveling"
                    required
                    maxLength={500}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="originalTitle">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="originalTitle">Original Title</FieldLabel>
                  <Input
                    id="originalTitle"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="e.g. 나 혼자만 레벨업"
                    maxLength={500}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="author">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="author">Author</FieldLabel>
                  <Input
                    id="author"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="e.g. Chugong"
                    maxLength={200}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>

        <form.Field name="cover">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined} className="shrink-0">
                <FieldLabel>Cover Image</FieldLabel>
                <CoverUpload
                  existingNovelId={defaultValues?.id}
                  hasExistingCover={defaultValues?.hasCover}
                  coverMime={coverMime}
                  cover={field.state.value}
                  onChange={(base64, mimeType) => {
                    const validatedMime = coverMimeSchema.safeParse(mimeType);
                    field.handleChange(base64);
                    form.setFieldValue(
                      "coverMime",
                      validatedMime.success ? validatedMime.data : null,
                    );
                    form.setFieldValue("removeCover", false);
                  }}
                  onRemoveCover={() => {
                    field.handleChange(null);
                    form.setFieldValue("coverMime", null);
                    form.setFieldValue("removeCover", true);
                  }}
                />
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.Field name="sourceLang">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="sourceLang">Source Language</FieldLabel>
                <Select
                  name={field.name}
                  value={field.state.value}
                  onValueChange={(value) => value && field.handleChange(value)}
                  items={SOURCE_LANG_ITEMS}
                >
                  <SelectTrigger
                    id="sourceLang"
                    className="h-10 w-full px-3"
                    onBlur={field.handleBlur}
                    aria-invalid={invalid}
                  >
                    <SelectValue placeholder="Select source language" />
                  </SelectTrigger>
                  <SelectContent className="min-w-36">
                    <SelectGroup>
                      <SelectItem value="en">English (EN)</SelectItem>
                      <SelectItem value="zh">Chinese (ZH)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="targetLang">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="targetLang">Target Language</FieldLabel>
                <Select
                  name={field.name}
                  value={field.state.value}
                  onValueChange={(value) => value && field.handleChange(value)}
                  items={TARGET_LANG_ITEMS}
                >
                  <SelectTrigger
                    id="targetLang"
                    className="h-10 w-full px-3"
                    onBlur={field.handleBlur}
                    aria-invalid={invalid}
                  >
                    <SelectValue placeholder="Select target language" />
                  </SelectTrigger>
                  <SelectContent className="min-w-36">
                    <SelectGroup>
                      <SelectItem value="th">Thai (TH)</SelectItem>
                      <SelectItem value="en" disabled={sourceLang === "en"}>
                        English (EN)
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <form.Field name="description">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Enter a brief description of the novel..."
                rows={4}
                maxLength={5000}
                aria-invalid={invalid}
              />
              {invalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          );
        }}
      </form.Field>

      <form.Field name="customPrompt">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="customPrompt">Custom AI Prompt Override</FieldLabel>
              <Textarea
                id="customPrompt"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Optional: Custom instructions for the AI translator. E.g. 'Use formal language for elder characters...'"
                rows={4}
                maxLength={10000}
                aria-invalid={invalid}
              />
              {invalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          );
        }}
      </form.Field>

      <div className="grid grid-cols-1 gap-4 border-t border-border/50 pt-2 sm:grid-cols-2">
        <form.Field name="chunkSize">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="chunkSize">Chunk Size (chars)</FieldLabel>
                <Input
                  id="chunkSize"
                  name={field.name}
                  type="number"
                  min={500}
                  max={10000}
                  step={100}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                />
                <FieldDescription>Target char count per chunk (default: 4,000)</FieldDescription>
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="contextTailLength">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="contextTailLength">Context Tail Length (chars)</FieldLabel>
                <Input
                  id="contextTailLength"
                  name={field.name}
                  type="number"
                  min={100}
                  max={2000}
                  step={50}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                />
                <FieldDescription>
                  Length of previous chunk tail passed as context (default: 500)
                </FieldDescription>
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting && <Spinner />}
          {isSubmitting ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
