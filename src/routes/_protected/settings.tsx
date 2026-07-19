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

export const Route = createFileRoute("/_protected/settings")({
  loader: async () => {
    return await getProviderSettings();
  },
  component: SettingsPage,
});

function SettingsPage() {
  const initialSettings = Route.useLoaderData();

  // Provider state
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initialSettings.model);
  const [temperature, setTemperature] = useState(initialSettings.temperature);

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

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProvider(true);
    setTestResult(null);

    try {
      await saveProviderSettings({
        data: {
          baseUrl,
          apiKey: apiKey ? apiKey.trim() : undefined,
          model,
          temperature,
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
          baseUrl,
          apiKey: apiKey ? apiKey.trim() : undefined,
          model,
          temperature,
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

  const applyPreset = (presetBaseUrl: string, presetModel: string) => {
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
              You must set up an OpenAI-compatible provider and API key before translating chapters.
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
            Connect any OpenAI-compatible API (OpenAI, OpenRouter, DeepSeek, local LLM). API keys
            are encrypted at rest using AES-256-GCM.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProvider} className="space-y-6">
            {/* Presets */}
            <div className="space-y-2">
              <Label className="text-caption text-muted-foreground">Quick Presets</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset("https://api.openai.com/v1", "gpt-4o")}
                >
                  OpenAI (gpt-4o)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    applyPreset("https://openrouter.ai/api/v1", "deepseek/deepseek-r1")
                  }
                >
                  OpenRouter (DeepSeek R1)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset("https://api.deepseek.com/v1", "deepseek-chat")}
                >
                  DeepSeek Direct
                </Button>
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
                placeholder="https://api.openai.com/v1"
              />
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="apiKey">API Key</Label>
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
                  hasApiKey ? `Leave blank to keep saved key (${apiKeyMasked})` : "sk-proj-…"
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
                placeholder="gpt-4o"
              />
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
