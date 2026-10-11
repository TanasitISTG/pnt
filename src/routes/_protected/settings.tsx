import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";

import {
  ProviderSettingsCard,
  type ProviderTestResult,
} from "@/components/settings/provider-settings-card";
import { BackupCard } from "@/components/settings/backup-card";
import {
  getProviderSettings,
  saveProviderSettings,
  testProviderConnection,
} from "@/lib/settings/functions";
import type {
  SaveProviderSettingsInput,
  TestProviderConnectionInput,
} from "@/lib/settings/schemas";

export const Route = createFileRoute("/_protected/settings")({
  loader: async () => {
    return await getProviderSettings();
  },
  component: SettingsPage,
});

async function handleTestConnection(
  data: TestProviderConnectionInput,
): Promise<ProviderTestResult> {
  try {
    const result = await testProviderConnection({ data });
    if (result.success) {
      toast.success(`Connection test succeeded (${result.latencyMs}ms)`);
    } else {
      toast.error(result.error || "Connection test failed");
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection test failed";
    toast.error(message);
    return { success: false, error: message };
  }
}

function SettingsPage() {
  const initialSettings = Route.useLoaderData();

  const [isConfigured, setIsConfigured] = useState(initialSettings.isConfigured);

  const handleSaveProvider = async (data: SaveProviderSettingsInput): Promise<boolean> => {
    try {
      await saveProviderSettings({ data });

      toast.success("Provider settings saved successfully");
      setIsConfigured(true);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(message);
      return false;
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-display-alt font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Configure your AI provider for translations and manage your data.
        </p>
        <p className="mt-2 text-caption text-muted-foreground">
          Your display name, photo and password live in{" "}
          <Link to="/profile" className="underline underline-offset-4 hover:text-primary">
            Profile
          </Link>
          .
        </p>
      </div>

      {!isConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-warning">
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
      <ProviderSettingsCard
        initialSettings={initialSettings}
        onSave={handleSaveProvider}
        onTest={handleTestConnection}
      />

      {/* Backup Section */}
      <BackupCard />
    </div>
  );
}
