import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ProviderType } from "@/lib/translation/translation.types";

interface ProviderSelectionSectionProps {
  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
  onApplyPreset: (provider: ProviderType, baseUrl: string, model: string) => void;
}

export function ProviderSelectionSection({
  provider,
  onProviderChange,
  onApplyPreset,
}: ProviderSelectionSectionProps) {
  return (
    <>
      {/* Provider Selector */}
      <div className="space-y-2">
        <Label>Provider Type</Label>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <button
            type="button"
            onClick={() => onProviderChange("openai")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              provider === "openai"
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <span className="font-medium text-foreground">OpenAI-Compatible</span>
            <span className="text-caption text-muted-foreground">
              OpenAI, OpenRouter, DeepSeek, Local LLM
            </span>
          </button>
          <button
            type="button"
            onClick={() => onProviderChange("gemini")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              provider === "gemini"
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <span className="font-medium text-foreground">Google AI Studio</span>
            <span className="text-caption text-muted-foreground">
              Gemini 2.5 Flash / Pro, 1.5 Flash
            </span>
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="space-y-2">
        <Label className="text-caption text-muted-foreground">Quick Presets</Label>
        <div className="flex flex-wrap gap-2">
          {provider === "gemini" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onApplyPreset(
                    "gemini",
                    "https://generativelanguage.googleapis.com",
                    "gemini-2.5-flash",
                  )
                }
              >
                Gemini 2.5 Flash
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onApplyPreset(
                    "gemini",
                    "https://generativelanguage.googleapis.com",
                    "gemini-2.5-pro",
                  )
                }
              >
                Gemini 2.5 Pro
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onApplyPreset(
                    "gemini",
                    "https://generativelanguage.googleapis.com",
                    "gemini-1.5-flash",
                  )
                }
              >
                Gemini 1.5 Flash
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onApplyPreset("openai", "https://api.openai.com/v1", "gpt-4o")}
              >
                OpenAI (gpt-4o)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onApplyPreset("openai", "https://openrouter.ai/api/v1", "deepseek/deepseek-r1")
                }
              >
                OpenRouter (DeepSeek R1)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onApplyPreset("openai", "https://api.deepseek.com/v1", "deepseek-chat")
                }
              >
                DeepSeek Direct
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
