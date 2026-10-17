import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { ChapterImportStatus } from "@/components/chapters/import/chapter-import-status";
import type { ImportJobController } from "@/components/chapters/import/use-import-job";
import { Button } from "@/components/ui/button";
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
import { encodeMessage } from "@/lib/i18n/message-code";
import { SCRAPE_PROVIDERS, SUPPORTED_SITES_LABEL } from "@/lib/scrape";
import { importChapter, scrapeChapter } from "@/lib/scrape/functions";
import type { ScrapeProvider } from "@/lib/scrape/types";

interface ScrapeImportSectionProps {
  novelId: string;
  invalidateChapters: () => void;
  importController: ImportJobController;
  bulkStartDisabled: boolean;
  onChapterFetched: (chapter: {
    number: string;
    title: string;
    content: string;
    sourceUrl: string;
  }) => void;
  otherImportActive: boolean;
}

const scrapeProviderSchema = z.enum(["auto", "direct", "zenrows", "scrapingbee", "firecrawl"]);
const scrapeImportFormSchema = z
  .object({
    sourceUrl: z
      .string()
      .trim()
      .min(1, encodeMessage("validation.scrapeUrlRequired"))
      .url(encodeMessage("validation.scrapeUrlInvalid")),
    provider: scrapeProviderSchema,
    rangeFrom: z.string(),
    rangeTo: z.string(),
    action: z.enum(["preview", "add", "range"]),
  })
  .superRefine((value, context) => {
    if (value.action !== "range") return;
    const from = Number(value.rangeFrom);
    const to = Number(value.rangeTo);
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 1 ||
      from > to ||
      to - from + 1 > 500
    ) {
      context.addIssue({
        code: "custom",
        message: encodeMessage("validation.scrapeRangeInvalid"),
        path: ["rangeTo"],
      });
    }
  });

export function ScrapeImportSection({
  novelId,
  invalidateChapters,
  importController,
  bulkStartDisabled,
  onChapterFetched,
  otherImportActive,
}: ScrapeImportSectionProps) {
  const t = useTranslations("studio");
  const [actionError, setActionError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      sourceUrl: "",
      provider: "auto" as ScrapeProvider,
      rangeFrom: "",
      rangeTo: "",
      action: "preview" as "preview" | "add" | "range",
    },
    validators: {
      onSubmit: scrapeImportFormSchema,
    },
    onSubmit: async ({ value }) => {
      setActionError(null);
      const parsed = scrapeImportFormSchema.parse(value);

      if (parsed.action === "range") {
        if (
          bulkStartDisabled ||
          importController.importActive ||
          importController.startPending ||
          otherImportActive
        ) {
          return;
        }
        await importController.startImport(
          parsed.sourceUrl,
          Number(parsed.rangeFrom),
          Number(parsed.rangeTo),
          parsed.provider,
        );
        return;
      }

      try {
        if (parsed.action === "preview") {
          const result = await scrapeChapter({
            data: { url: parsed.sourceUrl, provider: parsed.provider },
          });
          onChapterFetched({
            number: result.number === null ? "" : String(result.number),
            title: result.title,
            content: result.content,
            sourceUrl: parsed.sourceUrl,
          });
          if (result.nextUrl) form.setFieldValue("sourceUrl", result.nextUrl);
          toast.success(
            result.number === null
              ? t("fetchedChapter", { title: result.title })
              : t("fetchedChapterNumber", { number: result.number, title: result.title }),
          );
          return;
        }

        const result = await importChapter({
          data: { novelId, url: parsed.sourceUrl, provider: parsed.provider },
        });
        if (result.created) {
          invalidateChapters();
          toast.success(t("addedChapterNumber", { number: result.number, title: result.title }));
        } else {
          toast.info(t("chapterAlreadyExists", { number: result.number }));
        }
        if (result.nextUrl) form.setFieldValue("sourceUrl", result.nextUrl);
      } catch (error: unknown) {
        const fallback = parsed.action === "preview" ? t("fetchFailed") : t("importFailed");
        setActionError(error instanceof Error ? error.message : fallback);
      }
    },
  });
  const [sourceUrl, action, isSubmitting] = useStore(
    form.store,
    (state) => [state.values.sourceUrl, state.values.action, state.isSubmitting] as const,
    (previous, next) =>
      previous[0] === next[0] && previous[1] === next[1] && previous[2] === next[2],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{t("urlHeading")}</h3>
        <p className="text-sm text-muted-foreground">{t("urlLead")}</p>
      </header>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const submitter = (event.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement | null;
          const submittedAction = submitter?.dataset.action;
          form.setFieldValue(
            "action",
            submittedAction === "add" || submittedAction === "range" ? submittedAction : "preview",
            { dontUpdateMeta: true },
          );
          void form.handleSubmit().finally(() => {
            form.setFieldValue("action", "preview", { dontUpdateMeta: true });
          });
        }}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-5">
          <form.Field name="sourceUrl">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="scrapeUrl">{t("urlLabel")}</FieldLabel>
                  <Input
                    id="scrapeUrl"
                    name={field.name}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="https://www.quanben.io/n/.../30.html"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      setActionError(null);
                      field.handleChange(event.target.value);
                    }}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? "scrape-url-error" : undefined}
                  />
                  {invalid && <FieldError id="scrape-url-error" errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <form.Field name="provider">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const selectedProvider =
                  SCRAPE_PROVIDERS.find((provider) => provider.id === field.state.value) ??
                  SCRAPE_PROVIDERS[0];
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="scrapeProviderSelect">{t("fetchMethodLabel")}</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value}
                      onValueChange={(value) => {
                        if (!value) return;
                        setActionError(null);
                        field.handleChange(value as ScrapeProvider);
                      }}
                    >
                      <SelectTrigger
                        id="scrapeProviderSelect"
                        className="w-full"
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                      >
                        <SelectValue>{t(selectedProvider.labelKey)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SCRAPE_PROVIDERS.map((provider) => (
                            <SelectItem key={provider.id} value={provider.id}>
                              {t(provider.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>{t(selectedProvider.descriptionKey)}</FieldDescription>
                    <FieldDescription>
                      {t("supportedSites", { sites: SUPPORTED_SITES_LABEL })}
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
          </div>
        </div>

        <section
          className="flex flex-col gap-4 border-t border-border pt-5"
          aria-labelledby="single-chapter-heading"
        >
          <div className="flex flex-col gap-1">
            <h4 id="single-chapter-heading" className="text-base font-semibold text-foreground">
              {t("singleChapterHeading")}
            </h4>
            <p className="text-sm text-muted-foreground">{t("singleChapterLead")}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button type="submit" data-action="preview" disabled={!sourceUrl || isSubmitting}>
              {isSubmitting && action === "preview" && <Spinner />}
              {isSubmitting && action === "preview" ? t("fetchingChapter") : t("previewChapter")}
            </Button>
            <Button
              type="submit"
              data-action="add"
              variant="outline"
              disabled={!sourceUrl || isSubmitting}
            >
              {isSubmitting && action === "add" && <Spinner />}
              {isSubmitting && action === "add" ? t("addingChapter") : t("addWithoutPreview")}
            </Button>
          </div>
          {actionError ? (
            <div
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-text"
              role="alert"
            >
              {actionError}
            </div>
          ) : null}
        </section>

        <section
          className="flex flex-col gap-4 border-t border-border pt-5"
          aria-labelledby="chapter-range-heading"
        >
          <div className="flex flex-col gap-1">
            <h4 id="chapter-range-heading" className="text-base font-semibold text-foreground">
              {t("rangeHeading")}
            </h4>
            <p className="text-sm text-muted-foreground">{t("rangeLead")}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-end">
            <form.Field name="rangeFrom">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="importRangeFrom">{t("rangeFromLabel")}</FieldLabel>
                    <Input
                      type="number"
                      min="1"
                      id="importRangeFrom"
                      name={field.name}
                      autoComplete="off"
                      placeholder={t("rangeFromPlaceholder")}
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
            <form.Field name="rangeTo">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="importRangeTo">{t("rangeToLabel")}</FieldLabel>
                    <Input
                      type="number"
                      min="1"
                      id="importRangeTo"
                      name={field.name}
                      autoComplete="off"
                      placeholder={t("rangeToPlaceholder")}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? "import-range-error" : undefined}
                    />
                    {invalid && (
                      <FieldError id="import-range-error" errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>
            <Button
              type="submit"
              data-action="range"
              variant="outline"
              disabled={
                !sourceUrl ||
                isSubmitting ||
                bulkStartDisabled ||
                importController.importActive ||
                importController.startPending ||
                otherImportActive
              }
            >
              {(importController.importActive || (isSubmitting && action === "range")) && (
                <Spinner />
              )}
              {importController.importActive || (isSubmitting && action === "range")
                ? t("importingChapters")
                : t("startRangeImport")}
            </Button>
          </div>

          {otherImportActive ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("finishEpubImport")}
            </p>
          ) : null}

          <ChapterImportStatus
            label={t("importLabelUrlRange")}
            job={importController.importJob}
            active={importController.importActive}
            statusError={importController.importStatusError}
            onRetryStatus={importController.retryImportStatus}
          />

          {importController.importActive ? (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={importController.cancelImport}
            >
              {t("cancelImport")}
            </Button>
          ) : null}

          {importController.canRetryImport &&
          importController.importJob &&
          (importController.importJob.status === "error" ||
            importController.importJob.status === "cancelled") ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-muted-foreground">
                {importController.importJob.status === "error"
                  ? t("importStopped")
                  : t("importCancelled")}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void importController.retryImport()}
                disabled={bulkStartDisabled || otherImportActive || importController.startPending}
              >
                {t("retryRangeImport")}
              </Button>
            </div>
          ) : null}
        </section>
      </form>
    </div>
  );
}
