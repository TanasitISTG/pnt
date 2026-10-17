import { useForm, useStore } from "@tanstack/react-form";
import { useTranslations } from "use-intl";
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
import { languageName } from "@/lib/i18n/language-name";
import { encodeMessage } from "@/lib/i18n/message-code";
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

// A field message is a key (i18n.md §3), so the same sentence is written once and read
// through the catalog of whatever language the form is being filled in. The keys are named
// out rather than built from the field name, so the orphan-key sweep can see them and a
// renamed field cannot silently lose its message.
const INTEGER_FIELD_MESSAGES = {
  chunkSize: {
    required: "validation.chunkSizeRequired",
    whole: "validation.chunkSizeWhole",
    range: "validation.chunkSizeRange",
  },
  contextTailLength: {
    required: "validation.contextTailLengthRequired",
    whole: "validation.contextTailLengthWhole",
    range: "validation.contextTailLengthRange",
  },
} as const;

const integerInputSchema = (
  field: keyof typeof INTEGER_FIELD_MESSAGES,
  minimum: number,
  maximum: number,
) => {
  const messages = INTEGER_FIELD_MESSAGES[field];
  return z
    .string()
    .trim()
    .min(1, encodeMessage(messages.required))
    .regex(/^\d+$/, encodeMessage(messages.whole))
    .refine(
      (value) => {
        const number = Number(value);
        return number >= minimum && number <= maximum;
      },
      encodeMessage(messages.range, { min: minimum, max: maximum }),
    );
};

const novelFormSchema = z
  .object({
    title: z.string().trim().min(1, encodeMessage("validation.titleRequired")).max(500),
    originalTitle: z.string().max(500),
    author: z.string().max(200),
    description: z.string().max(5000),
    sourceLang: z.enum(["en", "zh"]),
    targetLang: z.enum(["en", "th"]),
    customPrompt: z.string().max(10000),
    chunkSize: integerInputSchema("chunkSize", 500, 10000),
    contextTailLength: integerInputSchema("contextTailLength", 100, 2000),
    cover: z.string().max(1_400_000).nullable(),
    coverMime: coverMimeSchema.nullable(),
    removeCover: z.boolean(),
  })
  .refine((data) => !data.cover || !!data.coverMime, {
    message: encodeMessage("validation.coverMimeRequired"),
    path: ["cover"],
  })
  .refine((data) => isSupportedLanguagePair(data.sourceLang, data.targetLang), {
    message: encodeMessage("validation.languagePairUnsupported"),
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
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  // The option's label pairs the language's name in the interface language with the code the
  // pair is stored as, so a Thai owner picks ภาษาอังกฤษ rather than decoding "en".
  const languageOption = (code: "en" | "zh" | "th") =>
    t("langOption", { language: languageName(tRoot, code) ?? code, code: code.toUpperCase() });
  const sourceLangItems: Record<string, string> = {
    en: languageOption("en"),
    zh: languageOption("zh"),
  };
  const targetLangItems: Record<string, string> = {
    th: languageOption("th"),
    en: languageOption("en"),
  };
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
                  <FieldLabel htmlFor="title">{t("fieldTitle")}</FieldLabel>
                  <Input
                    id="title"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t("titlePlaceholder")}
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
                  <FieldLabel htmlFor="originalTitle">{t("fieldOriginalTitle")}</FieldLabel>
                  <Input
                    id="originalTitle"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t("originalTitlePlaceholder")}
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
                  <FieldLabel htmlFor="author">{t("fieldAuthor")}</FieldLabel>
                  <Input
                    id="author"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t("authorPlaceholder")}
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
                <FieldLabel>{t("fieldCover")}</FieldLabel>
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
                <FieldLabel htmlFor="sourceLang">{t("fieldSourceLang")}</FieldLabel>
                <Select
                  name={field.name}
                  value={field.state.value}
                  onValueChange={(value) => value && field.handleChange(value)}
                  items={sourceLangItems}
                >
                  <SelectTrigger
                    id="sourceLang"
                    className="h-10 w-full px-3"
                    onBlur={field.handleBlur}
                    aria-invalid={invalid}
                  >
                    <SelectValue placeholder={t("sourceLangPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent className="min-w-36">
                    <SelectGroup>
                      <SelectItem value="en">{sourceLangItems.en}</SelectItem>
                      <SelectItem value="zh">{sourceLangItems.zh}</SelectItem>
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
                <FieldLabel htmlFor="targetLang">{t("fieldTargetLang")}</FieldLabel>
                <Select
                  name={field.name}
                  value={field.state.value}
                  onValueChange={(value) => value && field.handleChange(value)}
                  items={targetLangItems}
                >
                  <SelectTrigger
                    id="targetLang"
                    className="h-10 w-full px-3"
                    onBlur={field.handleBlur}
                    aria-invalid={invalid}
                  >
                    <SelectValue placeholder={t("targetLangPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent className="min-w-36">
                    <SelectGroup>
                      <SelectItem value="th">{targetLangItems.th}</SelectItem>
                      <SelectItem value="en" disabled={sourceLang === "en"}>
                        {targetLangItems.en}
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
              <FieldLabel htmlFor="description">{t("fieldDescription")}</FieldLabel>
              <Textarea
                id="description"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={t("descriptionPlaceholder")}
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
              <FieldLabel htmlFor="customPrompt">{t("fieldCustomPrompt")}</FieldLabel>
              <Textarea
                id="customPrompt"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={t("customPromptPlaceholder")}
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
                <FieldLabel htmlFor="chunkSize">{t("fieldChunkSize")}</FieldLabel>
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
                <FieldDescription>{t("chunkSizeHint")}</FieldDescription>
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
                <FieldLabel htmlFor="contextTailLength">{t("fieldContextTail")}</FieldLabel>
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
                <FieldDescription>{t("contextTailHint")}</FieldDescription>
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting && <Spinner />}
          {isSubmitting ? tCommon("saving") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
