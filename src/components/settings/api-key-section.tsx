import { ShieldCheck, ExternalLink } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProviderType } from "@/lib/translation/types/provider";

interface ApiKeySectionProps {
  provider: ProviderType;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export function ApiKeySection({
  provider,
  apiKey,
  onApiKeyChange,
  hasApiKey,
  apiKeyMasked,
}: ApiKeySectionProps) {
  return (
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
        onChange={(e) => onApiKeyChange(e.target.value)}
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
  );
}
