import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ProviderType } from "@/lib/providers/types";

interface ProviderSelectionSectionProps {
  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
  onApplyPreset: (provider: ProviderType, baseUrl: string, model: string) => void;
}

interface ProviderOption {
  value: ProviderType;
  labelKey: "providerOpenAiLabel" | "providerGeminiLabel";
  descriptionKey: "providerOpenAiDescription" | "providerGeminiDescription";
}

const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    value: "openai",
    labelKey: "providerOpenAiLabel",
    descriptionKey: "providerOpenAiDescription",
  },
  {
    value: "gemini",
    labelKey: "providerGeminiLabel",
    descriptionKey: "providerGeminiDescription",
  },
];

const PROVIDER_PRESETS: Record<
  ProviderType,
  Array<{ label: string; baseUrl: string; model: string }>
> = {
  openai: [
    { label: "OpenAI (gpt-4o)", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
    {
      label: "OpenRouter (DeepSeek R1)",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-r1",
    },
    { label: "DeepSeek Direct", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  ],
  gemini: [
    {
      label: "Gemini 2.5 Flash",
      baseUrl: "https://generativelanguage.googleapis.com",
      model: "gemini-2.5-flash",
    },
    {
      label: "Gemini 2.5 Pro",
      baseUrl: "https://generativelanguage.googleapis.com",
      model: "gemini-2.5-pro",
    },
    {
      label: "Gemini 1.5 Flash",
      baseUrl: "https://generativelanguage.googleapis.com",
      model: "gemini-1.5-flash",
    },
  ],
};

export function ProviderSelectionSection({
  provider,
  onProviderChange,
  onApplyPreset,
}: ProviderSelectionSectionProps) {
  const t = useTranslations("settings");
  return (
    <>
      <FieldSet>
        <FieldLegend variant="label">{t("providerTypeLabel")}</FieldLegend>
        <ToggleGroup
          value={[provider]}
          spacing={3}
          className="w-full sm:max-w-md"
          onValueChange={(groupValue) => {
            const next = groupValue[0];
            if (next === "openai" || next === "gemini") onProviderChange(next);
          }}
        >
          {PROVIDER_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              appearance="provider"
              // `self-stretch` because the group centres its items: a two-line label beside a
              // one-line one otherwise made the two cards different heights.
              className="h-auto min-w-0 flex-1 basis-0 flex-col self-stretch whitespace-normal"
            >
              <span className="w-full font-medium text-foreground">{t(option.labelKey)}</span>
              <span className="w-full text-caption text-muted-foreground">
                {t(option.descriptionKey)}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="mutedCaption">{t("quickPresets")}</FieldLegend>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_PRESETS[provider].map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onApplyPreset(provider, preset.baseUrl, preset.model)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </FieldSet>
    </>
  );
}
