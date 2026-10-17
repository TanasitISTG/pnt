import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import {
  ProviderSettingsCard,
  type ProviderTestResult,
} from "@/components/settings/provider-settings-card";
import { SettingsSection } from "@/components/settings/settings-section";
import { InlineNotice } from "@/components/ui/inline-notice";
import { headTranslator } from "@/lib/i18n/route-head";
import { translateServerError } from "@/lib/i18n/server-error";
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
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [{ title: `${t("meta.settingsProvider")} | ${t("meta.siteName")}` }],
    };
  },
  component: ProviderSettingsPage,
});

function ProviderSettingsPage() {
  const t = useTranslations("settings");
  // A rejection carries a key, and the root translator is the one that can resolve it.
  const tRoot = useTranslations();
  const initialSettings = Route.useLoaderData();
  // A successful save clears the notice without a reload; the loader only supplies the
  // first paint, exactly as the provider card's own masked key does.
  const [isConfigured, setIsConfigured] = useState(initialSettings.isConfigured);

  const handleTestConnection = async (
    data: TestProviderConnectionInput,
  ): Promise<ProviderTestResult> => {
    try {
      const result = await testProviderConnection({ data });
      if (result.success) {
        toast.success(t("providerTestSucceeded", { latencyMs: result.latencyMs ?? 0 }));
      } else {
        // The server reports which provider failure it classified as a code; the banner under the
        // card resolves it too, so the toast and the banner say the same thing in the same words.
        toast.error(translateServerError(result.error, tRoot, t("providerTestFailed")));
      }
      return result;
    } catch (err: unknown) {
      const message = translateServerError(err, tRoot, t("providerTestFailed"));
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const handleSaveProvider = async (data: SaveProviderSettingsInput): Promise<boolean> => {
    try {
      await saveProviderSettings({ data });
      toast.success(t("providerSaved"));
      setIsConfigured(true);
      return true;
    } catch (err: unknown) {
      const message = translateServerError(err, tRoot, t("providerSaveFailed"));
      toast.error(message);
      return false;
    }
  };

  return (
    <SettingsSection title={t("providerTitle")} description={t("providerDescription")}>
      {!isConfigured ? (
        <InlineNotice tone="warning" title={t("providerMissingTitle")}>
          {t("providerMissingBody")}
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
