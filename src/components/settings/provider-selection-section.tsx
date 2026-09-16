import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ProviderType } from "@/lib/providers/types";

interface ProviderSelectionSectionProps {
  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
  onApplyPreset: (provider: ProviderType, baseUrl: string, model: string) => void;
}

const PROVIDER_OPTIONS: Array<{
  value: ProviderType;
  label: string;
  description: string;
}> = [
  {
    value: "openai",
    label: "OpenAI-Compatible",
    description: "OpenRouter, DeepSeek, etc",
  },
  {
    value: "gemini",
    label: "Google AI Studio",
    description: "Gemini 2.5 Flash / Pro, 1.5 Flash",
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
  return (
    <>
      <FieldSet>
        <FieldLegend variant="label">Provider Type</FieldLegend>
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
              className="h-auto min-w-0 flex-1 basis-0 flex-col items-start gap-0.5 whitespace-normal rounded-lg border border-border bg-background p-3 text-left font-normal text-muted-foreground hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:ring-1 aria-pressed:ring-primary"
            >
              <span className="w-full font-medium text-foreground">{option.label}</span>
              <span className="w-full text-caption text-muted-foreground">
                {option.description}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label" className="text-caption text-muted-foreground">
          Quick Presets
        </FieldLegend>
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
