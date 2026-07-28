import { useState } from "react";
import { Loader2, Cpu, Zap } from "lucide-react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ProviderSelectionSection } from "./provider-selection-section";
import { ApiKeySection } from "./api-key-section";
import { TimeoutPricingFields } from "./timeout-pricing-fields";
import { TestResultBanner } from "./test-result-banner";
import type { getProviderSettings } from "@/lib/settings.functions";
import type {
  SaveProviderSettingsInput,
  TestProviderConnectionInput,
} from "@/lib/settings.schemas";
import type { ProviderType } from "@/lib/translation/translation.types";

export interface ProviderTestResult {
  success: boolean;
  latencyMs?: number;
  sample?: string;
  error?: string;
}

export interface ProviderSettingsCardProps {
  initialSettings: Awaited<ReturnType<typeof getProviderSettings>>;
  saving: boolean;
  testing: boolean;
  onSave: (data: SaveProviderSettingsInput) => Promise<boolean>;
  onTest: (data: TestProviderConnectionInput) => Promise<ProviderTestResult>;
}

export function ProviderSettingsCard({
  initialSettings,
  saving,
  testing,
  onSave,
  onTest,
}: ProviderSettingsCardProps) {
  const [provider, setProvider] = useState<ProviderType>(initialSettings.provider || "openai");
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initialSettings.model);
  const [fastModel, setFastModel] = useState(initialSettings.fastModel || "");
  const [temperature, setTemperature] = useState(initialSettings.temperature);
  const [requestTimeoutSec, setRequestTimeoutSec] = useState(
    () => initialSettings.requestTimeoutSec?.toString() ?? "",
  );
  const [inputPrice, setInputPrice] = useState(
    () => initialSettings.inputPricePer1M?.toString() ?? "",
  );
  const [outputPrice, setOutputPrice] = useState(
    () => initialSettings.outputPricePer1M?.toString() ?? "",
  );

  const [hasApiKey, setHasApiKey] = useState(initialSettings.hasApiKey);
  const [apiKeyMasked, setApiKeyMasked] = useState(initialSettings.apiKeyMasked);

  const [showFullError, setShowFullError] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  const handleProviderChange = (newProvider: ProviderType) => {
    setProvider(newProvider);
    setTestResult(null);
    if (newProvider === "gemini") {
      setBaseUrl("https://generativelanguage.googleapis.com");
      if (model === "gpt-4o" || model === "deepseek/deepseek-r1" || model === "deepseek-chat") {
        setModel("gemini-2.5-flash");
      }
    } else if (newProvider === "openai") {
      if (baseUrl === "https://generativelanguage.googleapis.com" || !baseUrl) {
        setBaseUrl("https://api.openai.com/v1");
      }
      if (model.startsWith("gemini")) {
        setModel("gpt-4o");
      }
    }
  };

  const applyPreset = (
    presetProvider: ProviderType,
    presetBaseUrl: string,
    presetModel: string,
  ) => {
    setProvider(presetProvider);
    setBaseUrl(presetBaseUrl);
    setModel(presetModel);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestResult(null);

    const saved = await onSave({
      provider,
      baseUrl,
      apiKey: apiKey ? apiKey.trim() : undefined,
      model,
      fastModel: fastModel ? fastModel.trim() : null,
      temperature,
      requestTimeoutSec: requestTimeoutSec === "" ? null : Number(requestTimeoutSec),
      inputPricePer1M: inputPrice === "" ? null : Number(inputPrice),
      outputPricePer1M: outputPrice === "" ? null : Number(outputPrice),
    });

    // Refresh masked state if new key was provided
    if (saved && apiKey) {
      setHasApiKey(true);
      setApiKeyMasked(`${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`);
      setApiKey("");
    }
  };

  const handleTestConnection = async () => {
    setTestResult(null);
    const result = await onTest({
      provider,
      baseUrl,
      apiKey: apiKey ? apiKey.trim() : undefined,
      model,
      temperature,
      requestTimeoutSec: requestTimeoutSec === "" ? null : Number(requestTimeoutSec),
    });
    setTestResult(result);
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
        <form onSubmit={handleSubmit} className="space-y-6">
          <ProviderSelectionSection
            provider={provider}
            onProviderChange={handleProviderChange}
            onApplyPreset={applyPreset}
          />

          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              type="url"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === "gemini"
                  ? "https://generativelanguage.googleapis.com"
                  : "https://api.openai.com/v1"
              }
            />
          </div>

          <ApiKeySection
            provider={provider}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            hasApiKey={hasApiKey}
            apiKeyMasked={apiKeyMasked}
          />

          {/* Model */}
          <div className="space-y-2">
            <Label htmlFor="model">Model Name</Label>
            <Input
              id="model"
              type="text"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o"}
            />
          </div>

          {/* Fast Model */}
          <div className="space-y-2">
            <Label htmlFor="fastModel">Fast Model (Cheaper tasks)</Label>
            <Input
              id="fastModel"
              type="text"
              value={fastModel}
              onChange={(e) => setFastModel(e.target.value)}
              placeholder={provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini"}
            />
            <p className="text-caption text-muted-foreground">
              Optional. Used for title translation, chapter summaries, term suggestions, and story
              context updates to reduce costs.
            </p>
          </div>

          {/* Temperature */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="temperature">Temperature</Label>
              <span className="font-mono text-body text-foreground">{temperature.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-4">
              <input
                id="temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-muted accent-foreground"
              />
            </div>
            <p className="text-caption text-muted-foreground">
              Lower values (0.2–0.5) produce more accurate translations; higher values (0.7–1.0)
              allow more creative flair.
            </p>
          </div>

          <TimeoutPricingFields
            requestTimeoutSec={requestTimeoutSec}
            onRequestTimeoutSecChange={setRequestTimeoutSec}
            inputPrice={inputPrice}
            onInputPriceChange={setInputPrice}
            outputPrice={outputPrice}
            onOutputPriceChange={setOutputPrice}
          />

          {/* Test connection result banner */}
          {testResult && (
            <TestResultBanner
              testResult={testResult}
              showFullError={showFullError}
              onToggleFullError={() => setShowFullError((prev) => !prev)}
            />
          )}

          {/* Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? "Saving…" : "Save Settings"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || (!hasApiKey && !apiKey) || !baseUrl || !model}
            >
              {testing ? <Loader2 className="animate-spin" /> : <Zap className="size-4" />}
              {testing ? "Testing…" : "Test Connection"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
