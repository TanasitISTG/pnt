import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  ProviderSettingsCard,
  type ProviderTestResult,
} from "@/components/settings/provider-settings-card";
import { SettingsSection } from "@/components/settings/settings-section";
import { InlineNotice } from "@/components/ui/inline-notice";
import {
  getProviderSettings,
  saveProviderSettings,
  testProviderConnection,
} from "@/lib/settings/functions";
import type {
  SaveProviderSettingsInput,
  TestProviderConnectionInput,
} from "@/lib/settings/schemas";

export const Route = createFileRoute("/_protected/settings/provider")({
  loader: async () => {
    return await getProviderSettings();
  },
  head: () => ({
    meta: [{ title: "Translation provider | Pnt - Personal Novel Translator" }],
  }),
  component: ProviderSettingsPage,
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

function ProviderSettingsPage() {
  const initialSettings = Route.useLoaderData();
  // A successful save clears the notice without a reload; the loader only supplies the
  // first paint, exactly as the provider card's own masked key does.
  const [isConfigured, setIsConfigured] = useState(initialSettings.isConfigured);

  const handleSaveProvider = async (data: SaveProviderSettingsInput): Promise<boolean> => {
    try {
      await saveProviderSettings({ data });
      toast.success("Provider settings saved");
      setIsConfigured(true);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(message);
      return false;
    }
  };

  return (
    <SettingsSection
      title="Provider"
      description="Where translated text comes from. Without a provider and a key, translation cannot run."
    >
      {!isConfigured ? (
        <InlineNotice tone="warning" title="No translation provider yet">
          Add an OpenAI-compatible endpoint or a Google AI Studio key below. Until then, chapters
          can be written and published but not translated.
        </InlineNotice>
      ) : null}

      <ProviderSettingsCard
        initialSettings={initialSettings}
        onSave={handleSaveProvider}
        onTest={handleTestConnection}
      />
    </SettingsSection>
  );
}
