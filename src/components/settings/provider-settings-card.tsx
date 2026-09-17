import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Cpu, ExternalLink, ShieldCheck, Zap } from "lucide-react";
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

const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort | "default";
  label: string;
}> = [
  { value: "default", label: "Provider default" },
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Maximum" },
];

const reasoningEffortItems = Object.fromEntries(
  REASONING_EFFORT_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ReasoningEffort | "default", string>;

const optionalTimeoutSchema = z.string().superRefine((value, context) => {
  if (value === "") return;
  const timeout = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(timeout) || timeout < 10 || timeout > 600) {
    context.addIssue({
      code: "custom",
      message: "Request timeout must be a whole number from 10 to 600",
    });
  }
});

const optionalPriceSchema = z.string().superRefine((value, context) => {
  if (value === "") return;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    context.addIssue({ code: "custom", message: "Price must be zero or greater" });
  }
});

const providerSettingsFormSchema = z
  .object({
    provider: z.enum(["openai", "gemini"]),
    baseUrl: z.url("Base URL must be a valid URL").or(z.literal("")),
    apiKey: z.string().max(4096),
    model: z.string().trim().min(1, "Model name is required"),
    fastModel: z.string(),
    reasoningEffort: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
      .nullable(),
    temperature: z.number().min(0, "Min temperature is 0").max(2, "Max temperature is 2"),
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
  .transform(
    (value): SaveProviderSettingsInput => ({
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
    }),
  );

type ProviderSettingsFormValues = z.input<typeof providerSettingsFormSchema>;
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
  const [hasApiKey, setHasApiKey] = useState(initialSettings.hasApiKey);
  const [apiKeyMasked, setApiKeyMasked] = useState(initialSettings.apiKeyMasked);
  const [showFullError, setShowFullError] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
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
    <Card className="rounded-xl border border-border bg-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Cpu className="size-5 text-muted-foreground" />
          <CardTitle>AI Provider Settings</CardTitle>
        </div>
        <CardDescription>
          Connect an OpenAI-compatible API or Google AI Studio (Gemini API key). API keys are
          encrypted at rest using AES-256-GCM.
        </CardDescription>
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
                  <FieldLabel htmlFor="baseUrl">Base URL</FieldLabel>
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
                  <FieldLabel htmlFor="model">Model Name</FieldLabel>
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
                  <FieldLabel htmlFor="fastModel">Fast Model (Cheaper tasks)</FieldLabel>
                  <Input
                    id="fastModel"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini"}
                    aria-invalid={invalid}
                  />
                  <FieldDescription>
                    Optional. Used for title translation, chapter summaries, term suggestions, and
                    story context updates to reduce costs.
                  </FieldDescription>
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
                        {provider === "gemini" ? "Google AI Studio API Key" : "API Key"}
                      </FieldLabel>
                      {provider === "gemini" && (
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-caption text-primary hover:underline"
                        >
                          Get Key
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    {hasApiKey && (
                      <span className="flex items-center gap-1 text-caption text-success">
                        <ShieldCheck className="size-3.5" />
                        Key saved ({apiKeyMasked})
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
                        ? `Leave blank to keep saved key (${apiKeyMasked})`
                        : provider === "gemini"
                          ? "AIzaSy…"
                          : "sk-proj-…"
                    }
                    aria-invalid={invalid}
                  />
                  <FieldDescription>
                    Your key is encrypted on the server and never sent to the browser.
                  </FieldDescription>
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
                    <FieldLabel htmlFor="reasoningEffort">Reasoning Effort</FieldLabel>
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
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription className="max-w-2xl">
                      OpenAI-compatible models only. Provider default omits the parameter; explicit
                      levels may be rejected by models that do not support reasoning effort.
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
                    <FieldLabel htmlFor="temperature">Temperature</FieldLabel>
                    <span className="font-mono text-body text-foreground">
                      {field.state.value.toFixed(1)}
                    </span>
                  </div>
                  <Slider
                    id="temperature"
                    aria-label="Temperature"
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
                    {isTemperatureDisabled
                      ? "OpenCode Luna does not support a custom temperature."
                      : "Lower values (0.2–0.5) produce more accurate translations; higher values (0.7–1.0) allow more creative flair."}
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
                  <FieldLabel htmlFor="requestTimeoutSec">Request Timeout (seconds)</FieldLabel>
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
                  <FieldDescription>
                    Request timeout (seconds) — raise for slow/free APIs; keep ≤270 on Vercel Hobby
                  </FieldDescription>
                  {invalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <FieldSet>
            <FieldLegend variant="label">Token Prices (USD per 1M tokens, optional)</FieldLegend>
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
                        placeholder="Input, e.g. 0.075"
                        aria-label="Input price"
                        aria-invalid={invalid}
                      />
                      <FieldDescription>Input / prompt</FieldDescription>
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
                        placeholder="Output, e.g. 0.30"
                        aria-label="Output price"
                        aria-invalid={invalid}
                      />
                      <FieldDescription>Output / completion</FieldDescription>
                      {invalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>
            </div>
            <FieldDescription>
              Used to show per-chapter translation cost on the novel page. Leave blank to track
              tokens only.
            </FieldDescription>
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
              {savePending ? "Saving…" : "Save Settings"}
            </Button>
            <Button type="submit" data-action="test" variant="outline" disabled={isSubmitting}>
              {testPending ? <Spinner /> : <Zap className="size-4" />}
              {testPending ? "Testing…" : "Test Connection"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
