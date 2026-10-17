import { useMemo, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Cpu, ExternalLink, ShieldCheck, Zap } from "lucide-react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { ProviderSelectionSection } from "./provider-selection-section";
import { TestResultBanner } from "./test-result-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import {
  saveProviderSettingsSchema,
  testProviderConnectionSchema,
  type ProviderSettings,
  type SaveProviderSettingsInput,
  type TestProviderConnectionInput,
} from "@/lib/settings/schemas";
import { isOpenCodeLunaModel } from "@/lib/translation/providers/provider-compatibility";
import type { ProviderType, ReasoningEffort } from "@/lib/providers/types";

type ReasoningEffortLabelKey =
  | "reasoningEffortDefault"
  | "reasoningEffortNone"
  | "reasoningEffortMinimal"
  | "reasoningEffortLow"
  | "reasoningEffortMedium"
  | "reasoningEffortHigh"
  | "reasoningEffortXHigh"
  | "reasoningEffortMax";

const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort | "default";
  labelKey: ReasoningEffortLabelKey;
}> = [
  { value: "default", labelKey: "reasoningEffortDefault" },
  { value: "none", labelKey: "reasoningEffortNone" },
  { value: "minimal", labelKey: "reasoningEffortMinimal" },
  { value: "low", labelKey: "reasoningEffortLow" },
  { value: "medium", labelKey: "reasoningEffortMedium" },
  { value: "high", labelKey: "reasoningEffortHigh" },
  { value: "xhigh", labelKey: "reasoningEffortXHigh" },
  { value: "max", labelKey: "reasoningEffortMax" },
];

/** The handful of sentences this form says about its own fields. */
type ProviderMessageKey =
  | "baseUrlInvalid"
  | "modelRequired"
  | "timeoutInvalid"
  | "priceNegative"
  | "temperatureMin"
  | "temperatureMax";

type ProviderMessage = (key: ProviderMessageKey) => string;

/**
 * The form's own rules, with their messages in the reader's language.
 *
 * A factory rather than a module constant, so the spend and timeout sentences can be
 * translated: a schema built at import time could only ever say them in one language. The
 * rules themselves are unchanged, and the two the server also enforces keep the same bounds.
 */
function buildProviderSettingsFormSchema(t: ProviderMessage) {
  const optionalTimeoutSchema = z.string().superRefine((value, context) => {
    if (value === "") return;
    const timeout = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(timeout) || timeout < 10 || timeout > 600) {
      context.addIssue({ code: "custom", message: t("timeoutInvalid") });
    }
  });

  const optionalPriceSchema = z.string().superRefine((value, context) => {
    if (value === "") return;
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) {
      context.addIssue({ code: "custom", message: t("priceNegative") });
    }
  });

  return z
    .object({
      provider: z.enum(["openai", "gemini"]),
      baseUrl: z.url(t("baseUrlInvalid")).or(z.literal("")),
      apiKey: z.string().max(4096),
      model: z.string().trim().min(1, t("modelRequired")),
      fastModel: z.string(),
      reasoningEffort: z
        .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
        .nullable(),
      temperature: z.number().min(0, t("temperatureMin")).max(2, t("temperatureMax")),
      requestTimeoutSec: optionalTimeoutSchema,
      inputPrice: z.string(),
      outputPrice: z.string(),
      action: z.enum(["save", "test"]),
    })
    .superRefine((value, context) => {
      if (value.action !== "save") return;
      for (const name of ["inputPrice", "outputPrice"] as const) {
        const result = optionalPriceSchema.safeParse(value[name]);
        if (result.success) continue;
        for (const issue of result.error.issues) {
          context.addIssue({ ...issue, path: [name] });
        }
      }
    })
    .transform((value): SaveProviderSettingsInput => ({
      provider: value.provider,
      baseUrl: value.baseUrl,
      apiKey: value.apiKey.trim() || undefined,
      model: value.model.trim(),
      fastModel: value.fastModel.trim() || null,
      reasoningEffort: value.reasoningEffort,
      temperature: value.temperature,
      requestTimeoutSec: value.requestTimeoutSec === "" ? null : Number(value.requestTimeoutSec),
      inputPricePer1M: value.inputPrice === "" ? null : Number(value.inputPrice),
      outputPricePer1M: value.outputPrice === "" ? null : Number(value.outputPrice),
    }));
}

type ProviderSettingsFormValues = z.input<ReturnType<typeof buildProviderSettingsFormSchema>>;
type ProviderSettingsFieldName = Exclude<keyof ProviderSettingsFormValues, "action">;

const providerFieldIds: Record<ProviderSettingsFieldName, string> = {
  provider: "provider",
  baseUrl: "baseUrl",
  apiKey: "apiKey",
  model: "model",
  fastModel: "fastModel",
  reasoningEffort: "reasoningEffort",
  temperature: "temperature",
  requestTimeoutSec: "requestTimeoutSec",
  inputPrice: "inputPrice",
  outputPrice: "outputPrice",
};

function computeProviderSwitch(
  newProvider: ProviderType,
  current: { baseUrl: string; model: string },
): { baseUrl: string; model: string } {
  if (newProvider === "gemini") {
    const baseUrl = "https://generativelanguage.googleapis.com";
    const model = ["gpt-4o", "deepseek/deepseek-r1", "deepseek-chat"].includes(current.model)
      ? "gemini-2.5-flash"
      : current.model;
    return { baseUrl, model };
  }
  const baseUrl =
    current.baseUrl === "https://generativelanguage.googleapis.com" || !current.baseUrl
      ? "https://api.openai.com/v1"
      : current.baseUrl;
  const model = current.model.startsWith("gemini") ? "gpt-4o" : current.model;
  return { baseUrl, model };
}

export interface ProviderTestResult {
  success: boolean;
  latencyMs?: number;
  sample?: string;
  error?: string;
}

export interface ProviderSettingsCardProps {
  initialSettings: ProviderSettings;
  onSave: (data: SaveProviderSettingsInput) => Promise<boolean>;
  onTest: (data: TestProviderConnectionInput) => Promise<ProviderTestResult>;
}

export function ProviderSettingsCard({
  initialSettings,
  onSave,
  onTest,
}: ProviderSettingsCardProps) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [hasApiKey, setHasApiKey] = useState(initialSettings.hasApiKey);
  const [apiKeyMasked, setApiKeyMasked] = useState(initialSettings.apiKeyMasked);
  const [showFullError, setShowFullError] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  // One schema per language, so the messages under the fields follow the reader.
  const providerSettingsFormSchema = useMemo(() => buildProviderSettingsFormSchema(t), [t]);
  const reasoningEffortItems = Object.fromEntries(
    REASONING_EFFORT_OPTIONS.map((option) => [option.value, t(option.labelKey)]),
  ) as Record<ReasoningEffort | "default", string>;
  const form = useForm({
    defaultValues: {
      provider: initialSettings.provider,
      baseUrl: initialSettings.baseUrl,
      apiKey: "",
      model: initialSettings.model,
      fastModel: initialSettings.fastModel ?? "",
      reasoningEffort: initialSettings.reasoningEffort,
      temperature: initialSettings.temperature,
      requestTimeoutSec: initialSettings.requestTimeoutSec?.toString() ?? "",
      inputPrice: initialSettings.inputPricePer1M?.toString() ?? "",
      outputPrice: initialSettings.outputPricePer1M?.toString() ?? "",
      action: "save" as "save" | "test",
    } satisfies ProviderSettingsFormValues,
    validators: { onSubmit: providerSettingsFormSchema },
    onSubmitInvalid: ({ formApi, value }) => {
      const result = providerSettingsFormSchema.safeParse(value);
      if (result.success) return;
      const invalidNames = result.error.issues
        .map((issue) => issue.path[0])
        .filter(
          (name): name is ProviderSettingsFieldName =>
            typeof name === "string" && name in providerFieldIds,
        );
      for (const name of invalidNames) {
        formApi.setFieldMeta(name, (previous) => ({ ...previous, isTouched: true }));
      }
      const firstName = invalidNames[0];
      if (firstName) document.getElementById(providerFieldIds[firstName])?.focus();
    },
    onSubmit: async ({ value }) => {
      setTestResult(null);
      const apiKey = value.apiKey.trim();
      const parsed = providerSettingsFormSchema.parse(value);

      if (value.action === "test") {
        setTestResult(await onTest(testProviderConnectionSchema.parse(parsed)));
        return;
      }

      const saved = await onSave(saveProviderSettingsSchema.parse(parsed));
      if (saved && apiKey) {
        setHasApiKey(true);
        setApiKeyMasked(`${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`);
        form.setFieldValue("apiKey", "");
      }
    },
  });
  const provider = useStore(form.store, (state) => state.values.provider);
  const model = useStore(form.store, (state) => state.values.model);
  const baseUrl = useStore(form.store, (state) => state.values.baseUrl);
  const [action, isSubmitting] = useStore(
    form.store,
    (state) => [state.values.action, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );
  const savePending = isSubmitting && action === "save";
  const testPending = isSubmitting && action === "test";
  const isTemperatureDisabled = provider === "openai" && isOpenCodeLunaModel(model, baseUrl);

  const handleProviderChange = (newProvider: ProviderType) => {
    setTestResult(null);
    const next = computeProviderSwitch(newProvider, { baseUrl, model });
    form.setFieldValue("provider", newProvider);
    form.setFieldValue("baseUrl", next.baseUrl);
    form.setFieldValue("model", next.model);
  };

  const applyPreset = (
    presetProvider: ProviderType,
    presetBaseUrl: string,
    presetModel: string,
  ) => {
    setTestResult(null);
    form.setFieldValue("provider", presetProvider);
    form.setFieldValue("baseUrl", presetBaseUrl);
    form.setFieldValue("model", presetModel);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Cpu className="size-5 text-muted-foreground" />
          <CardTitle>{t("providerSettingsTitle")}</CardTitle>
        </div>
        <CardDescription>{t("providerSettingsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement | null;
            form.setFieldValue("action", submitter?.dataset.action === "test" ? "test" : "save", {
              dontUpdateMeta: true,
            });
            void form.handleSubmit().finally(() => {
              form.setFieldValue("action", "save", { dontUpdateMeta: true });
            });
          }}
        >
          <form.Field name="provider">
            {(field) => (
              <ProviderSelectionSection
                provider={field.state.value}
                onProviderChange={handleProviderChange}
                onApplyPreset={applyPreset}
              />
            )}
          </form.Field>

          <form.Field name="baseUrl">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="baseUrl">{t("baseUrlLabel")}</FieldLabel>
                  <Input
                    id="baseUrl"
                    name={field.name}
                    type="url"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={
                      provider === "gemini"
                        ? "https://generativelanguage.googleapis.com"
                        : "https://api.openai.com/v1"
                    }
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="model">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="model">{t("modelNameLabel")}</FieldLabel>
                  <Input
                    id="model"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o"}
                    aria-invalid={invalid}
                  />
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="fastModel">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="fastModel">{t("fastModelLabel")}</FieldLabel>
                  <Input
                    id="fastModel"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini"}
                    aria-invalid={invalid}
                  />
                  <FieldDescription>{t("fastModelDescription")}</FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="apiKey">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <FieldLabel htmlFor="apiKey">
                        {provider === "gemini" ? t("googleApiKeyLabel") : t("apiKeyLabel")}
                      </FieldLabel>
                      {provider === "gemini" && (
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-caption text-primary hover:underline"
                        >
                          {t("getKey")}
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    {hasApiKey && (
                      <span className="flex items-center gap-1 text-caption text-success">
                        <ShieldCheck className="size-3.5" />
                        {t("keySaved", { masked: apiKeyMasked })}
                      </span>
                    )}
                  </div>
                  <Input
                    id="apiKey"
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={
                      hasApiKey
                        ? t("apiKeyKeepHint", { masked: apiKeyMasked })
                        : provider === "gemini"
                          ? "AIzaSy…"
                          : "sk-proj-…"
                    }
                    aria-invalid={invalid}
                  />
                  <FieldDescription>{t("apiKeyDescription")}</FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          {provider === "openai" && (
            <form.Field name="reasoningEffort">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="reasoningEffort">{t("reasoningEffortLabel")}</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value ?? "default"}
                      items={reasoningEffortItems}
                      onValueChange={(value) =>
                        field.handleChange(
                          !value || value === "default" ? null : (value as ReasoningEffort),
                        )
                      }
                    >
                      <SelectTrigger
                        id="reasoningEffort"
                        className="h-10 w-full px-3 sm:max-w-md"
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="sm:max-w-md">
                        <SelectGroup>
                          {REASONING_EFFORT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription className="max-w-2xl">
                      {t("reasoningEffortDescription")}
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
          )}

          <form.Field name="temperature">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="temperature">{t("temperatureLabel")}</FieldLabel>
                    <span className="font-mono text-body text-foreground">
                      {field.state.value.toFixed(1)}
                    </span>
                  </div>
                  <Slider
                    id="temperature"
                    aria-label={t("temperatureLabel")}
                    min={0}
                    max={2}
                    step={0.1}
                    value={[field.state.value]}
                    disabled={isTemperatureDisabled}
                    onValueChange={(nextValue) =>
                      field.handleChange(
                        typeof nextValue === "number" ? nextValue : (nextValue[0] ?? 0),
                      )
                    }
                    onValueCommitted={field.handleBlur}
                  />
                  <FieldDescription>
                    {isTemperatureDisabled ? t("temperatureLocked") : t("temperatureDescription")}
                  </FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="requestTimeoutSec">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="requestTimeoutSec">{t("timeoutLabel")}</FieldLabel>
                  <Input
                    id="requestTimeoutSec"
                    name={field.name}
                    type="number"
                    min="10"
                    max="600"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="240"
                    aria-invalid={invalid}
                  />
                  <FieldDescription>{t("timeoutDescription")}</FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <FieldSet>
            <FieldLegend variant="label">{t("currencyLegend")}</FieldLegend>
            <div className="grid grid-cols-2 gap-4">
              <form.Field name="inputPrice">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <Input
                        id="inputPrice"
                        name={field.name}
                        type="number"
                        min="0"
                        step="any"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        placeholder={t("inputPricePlaceholder")}
                        aria-label={t("inputPriceAria")}
                        aria-invalid={invalid}
                      />
                      <FieldDescription>{t("inputPriceLabel")}</FieldDescription>
                      {invalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="outputPrice">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <Input
                        id="outputPrice"
                        name={field.name}
                        type="number"
                        min="0"
                        step="any"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        placeholder={t("outputPricePlaceholder")}
                        aria-label={t("outputPriceAria")}
                        aria-invalid={invalid}
                      />
                      <FieldDescription>{t("outputPriceLabel")}</FieldDescription>
                      {invalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>
            </div>
            <FieldDescription>{t("pricesDescription")}</FieldDescription>
          </FieldSet>

          {testResult && (
            <TestResultBanner
              testResult={testResult}
              showFullError={showFullError}
              onToggleFullError={() => setShowFullError((previous) => !previous)}
            />
          )}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Button type="submit" data-action="save" disabled={isSubmitting}>
              {savePending && <Spinner />}
              {savePending ? tc("saving") : t("saveSettings")}
            </Button>
            <Button type="submit" data-action="test" variant="outline" disabled={isSubmitting}>
              {testPending ? <Spinner /> : <Zap className="size-4" />}
              {testPending ? t("testing") : t("testConnection")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
