import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Key,
  Cpu,
  ShieldCheck,
  Zap,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getProviderSettings,
  saveProviderSettings,
  testProviderConnection,
  changePassword,
} from "@/lib/settings.functions";
import type { ProviderType } from "@/lib/translation/translation.types";

export const Route = createFileRoute("/_protected/settings")({
  loader: async () => {
    return await getProviderSettings();
  },
  component: SettingsPage,
});

function SettingsPage() {
  const initialSettings = Route.useLoaderData();

  // Provider state
  const [provider, setProvider] = useState<ProviderType>(initialSettings.provider || "openai");
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initialSettings.model);
  const [fastModel, setFastModel] = useState(initialSettings.fastModel || "");
  const [temperature, setTemperature] = useState(initialSettings.temperature);
  const [requestTimeoutSec, setRequestTimeoutSec] = useState(
    initialSettings.requestTimeoutSec?.toString() ?? "",
  );
  const [inputPrice, setInputPrice] = useState(initialSettings.inputPricePer1M?.toString() ?? "");
  const [outputPrice, setOutputPrice] = useState(
    initialSettings.outputPricePer1M?.toString() ?? "",
  );

  const [hasApiKey, setHasApiKey] = useState(initialSettings.hasApiKey);
  const [apiKeyMasked, setApiKeyMasked] = useState(initialSettings.apiKeyMasked);
  const [isConfigured, setIsConfigured] = useState(initialSettings.isConfigured);

  const [savingProvider, setSavingProvider] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [showFullError, setShowFullError] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    sample?: string;
    error?: string;
  } | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

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

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProvider(true);
    setTestResult(null);

    try {
      await saveProviderSettings({
        data: {
          provider,
          baseUrl,
          apiKey: apiKey ? apiKey.trim() : undefined,
          model,
          fastModel: fastModel ? fastModel.trim() : null,
          temperature,
          requestTimeoutSec: requestTimeoutSec === "" ? null : Number(requestTimeoutSec),
          inputPricePer1M: inputPrice === "" ? null : Number(inputPrice),
          outputPricePer1M: outputPrice === "" ? null : Number(outputPrice),
        },
      });

      toast.success("Provider settings saved successfully");
      setIsConfigured(true);

      // Refresh masked state if new key was provided
      if (apiKey) {
        setHasApiKey(true);
        setApiKeyMasked(`${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`);
        setApiKey("");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(message);
    } finally {
      setSavingProvider(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);

    try {
      const result = await testProviderConnection({
        data: {
          provider,
          baseUrl,
          apiKey: apiKey ? apiKey.trim() : undefined,
          model,
          temperature,
          requestTimeoutSec: requestTimeoutSec === "" ? null : Number(requestTimeoutSec),
        },
      });
      setTestResult(result);
      if (result.success) {
        toast.success(`Connection test succeeded (${result.latencyMs}ms)`);
      } else {
        toast.error(result.error || "Connection test failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      setTestResult({ success: false, error: message });
      toast.error(message);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword({
        data: {
          currentPassword,
          newPassword,
          confirmPassword,
        },
      });

      toast.success("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update password";
      toast.error(message);
    } finally {
      setChangingPassword(false);
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-display-alt font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Configure your AI provider for translations and manage your admin account.
        </p>
      </div>

      {!isConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div className="text-body">
            <p className="font-semibold">AI Provider Not Configured</p>
            <p className="mt-1 text-caption opacity-90">
              You must set up an AI provider (OpenAI-compatible or Google AI Studio) and API key
              before translating chapters.
            </p>
          </div>
        </div>
      )}

      {/* Provider Configuration */}
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
          <form onSubmit={handleSaveProvider} className="space-y-6">
            {/* Provider Selector */}
            <div className="space-y-2">
              <Label>Provider Type</Label>
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <button
                  type="button"
                  onClick={() => handleProviderChange("openai")}
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
                  onClick={() => handleProviderChange("gemini")}
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
                        applyPreset(
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
                        applyPreset(
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
                        applyPreset(
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
                      onClick={() => applyPreset("openai", "https://api.openai.com/v1", "gpt-4o")}
                    >
                      OpenAI (gpt-4o)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        applyPreset(
                          "openai",
                          "https://openrouter.ai/api/v1",
                          "deepseek/deepseek-r1",
                        )
                      }
                    >
                      OpenRouter (DeepSeek R1)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        applyPreset("openai", "https://api.deepseek.com/v1", "deepseek-chat")
                      }
                    >
                      DeepSeek Direct
                    </Button>
                  </>
                )}
              </div>
            </div>

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

            {/* API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="apiKey">
                    {provider === "gemini" ? "Google AI Studio API Key" : "API Key"}
                  </Label>
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
                  <span className="flex items-center gap-1 text-caption text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="size-3.5" />
                    Key saved ({apiKeyMasked})
                  </span>
                )}
              </div>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  hasApiKey
                    ? `Leave blank to keep saved key (${apiKeyMasked})`
                    : provider === "gemini"
                      ? "AIzaSy…"
                      : "sk-proj-…"
                }
              />
              <p className="text-caption text-muted-foreground">
                Your key is encrypted on the server and never sent to the browser.
              </p>
            </div>

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
                <span className="font-mono text-body text-foreground">
                  {temperature.toFixed(1)}
                </span>
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

            {/* Request Timeout */}
            <div className="space-y-2">
              <Label htmlFor="requestTimeoutSec">Request Timeout (seconds)</Label>
              <Input
                id="requestTimeoutSec"
                type="number"
                min="10"
                max="600"
                value={requestTimeoutSec}
                onChange={(e) => setRequestTimeoutSec(e.target.value)}
                placeholder="240"
              />
              <p className="text-caption text-muted-foreground">
                Request timeout (seconds) — raise for slow/free APIs; keep ≤270 on Vercel Hobby
              </p>
            </div>

            {/* Cost tracking prices */}
            <div className="space-y-2">
              <Label>Token Prices (USD per 1M tokens, optional)</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Input
                    id="inputPrice"
                    type="number"
                    min="0"
                    step="any"
                    value={inputPrice}
                    onChange={(e) => setInputPrice(e.target.value)}
                    placeholder="Input, e.g. 0.075"
                  />
                  <p className="text-caption text-muted-foreground">Input / prompt</p>
                </div>
                <div className="space-y-1.5">
                  <Input
                    id="outputPrice"
                    type="number"
                    min="0"
                    step="any"
                    value={outputPrice}
                    onChange={(e) => setOutputPrice(e.target.value)}
                    placeholder="Output, e.g. 0.30"
                  />
                  <p className="text-caption text-muted-foreground">Output / completion</p>
                </div>
              </div>
              <p className="text-caption text-muted-foreground">
                Used to show per-chapter translation cost on the novel page. Leave blank to track
                tokens only.
              </p>
            </div>

            {/* Test connection result banner */}
            {testResult && (
              <div
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  testResult.success
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                    : "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
                )}
                <div className="min-w-0 flex-1 text-body">
                  <p className="font-semibold">
                    {testResult.success
                      ? `Connection Successful (${testResult.latencyMs}ms)`
                      : "Connection Failed"}
                  </p>
                  {testResult.success ? (
                    <p className="mt-1 text-caption opacity-90">
                      Sample completion: "{testResult.sample}"
                    </p>
                  ) : (
                    <div>
                      <p className="mt-1 break-words text-caption opacity-90">
                        {showFullError || (testResult.error?.length || 0) <= 120
                          ? testResult.error
                          : `${testResult.error?.slice(0, 120)}…`}
                      </p>
                      {(testResult.error?.length || 0) > 120 && (
                        <button
                          type="button"
                          onClick={() => setShowFullError((prev) => !prev)}
                          className="mt-2 flex items-center gap-1 text-caption font-medium underline opacity-90 hover:opacity-100"
                        >
                          {showFullError ? (
                            <>
                              <ChevronUp className="size-3.5" />
                              Show less
                            </>
                          ) : (
                            <>
                              <ChevronDown className="size-3.5" />
                              Show details
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Button type="submit" disabled={savingProvider}>
                {savingProvider && <Loader2 className="animate-spin" />}
                {savingProvider ? "Saving…" : "Save Settings"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={testingConnection || (!hasApiKey && !apiKey) || !baseUrl || !model}
              >
                {testingConnection ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Zap className="size-4" />
                )}
                {testingConnection ? "Testing…" : "Test Connection"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Account Section */}
      <Card className="rounded-xl border border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="size-5 text-muted-foreground" />
            <CardTitle>Account & Security</CardTitle>
          </div>
          <CardDescription>Update your admin account password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <div className="pt-2">
              <Button type="submit" disabled={changingPassword}>
                {changingPassword && <Loader2 className="animate-spin" />}
                {changingPassword ? "Updating…" : "Update Password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
