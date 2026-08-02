import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";

import {
  ProviderSettingsCard,
  type ProviderTestResult,
} from "@/components/settings/provider-settings-card";
import { ChangePasswordCard } from "@/components/settings/change-password-card";
import { BackupCard } from "@/components/settings/backup-card";
import {
  getProviderSettings,
  saveProviderSettings,
  testProviderConnection,
  changePassword,
} from "@/lib/settings/functions";
import type {
  SaveProviderSettingsInput,
  TestProviderConnectionInput,
  ChangePasswordInput,
} from "@/lib/settings/schemas";

export const Route = createFileRoute("/_protected/settings")({
  loader: async () => {
    return await getProviderSettings();
  },
  component: SettingsPage,
});

function SettingsPage() {
  const initialSettings = Route.useLoaderData();

  const [isConfigured, setIsConfigured] = useState(initialSettings.isConfigured);
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSaveProvider = async (data: SaveProviderSettingsInput): Promise<boolean> => {
    setSavingProvider(true);

    try {
      await saveProviderSettings({ data });

      toast.success("Provider settings saved successfully");
      setIsConfigured(true);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(message);
      return false;
    } finally {
      setSavingProvider(false);
    }
  };

  const handleTestConnection = async (
    data: TestProviderConnectionInput,
  ): Promise<ProviderTestResult> => {
    setTestingConnection(true);

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
    } finally {
      setTestingConnection(false);
    }
  };

  const handleChangePassword = async (data: ChangePasswordInput): Promise<boolean> => {
    if (data.newPassword !== data.confirmPassword) {
      toast.error("New passwords do not match");
      return false;
    }
    if (data.newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return false;
    }

    setChangingPassword(true);
    try {
      await changePassword({ data });

      toast.success("Password updated successfully");
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update password";
      toast.error(message);
      return false;
    } finally {
      setChangingPassword(false);
    }
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
      <ProviderSettingsCard
        initialSettings={initialSettings}
        saving={savingProvider}
        testing={testingConnection}
        onSave={handleSaveProvider}
        onTest={handleTestConnection}
      />

      {/* Backup Section */}
      <BackupCard />

      {/* Account Section */}
      <ChangePasswordCard pending={changingPassword} onSubmit={handleChangePassword} />
    </div>
  );
}
