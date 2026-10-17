import { CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "use-intl";

import { translateServerError } from "@/lib/i18n/server-error";

import type { ProviderTestResult } from "./provider-settings-card";

interface TestResultBannerProps {
  testResult: ProviderTestResult;
  showFullError: boolean;
  onToggleFullError: () => void;
}

export function TestResultBanner({
  testResult,
  showFullError,
  onToggleFullError,
}: TestResultBannerProps) {
  const t = useTranslations("settings");
  const tRoot = useTranslations();
  // The server sends a code for the failure it classified, because the worker that classified it
  // had no reader and no language. Resolving it here is what makes the same failure read in Thai
  // in this banner and in a job's log row; a message that is not a code - anything from before
  // this vocabulary, or a provider's own words in an old row - passes through as it is.
  const failure = translateServerError(testResult.error, tRoot);
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-4 ${
        testResult.success
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-foreground"
      }`}
    >
      {testResult.success ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
      ) : (
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-foreground" />
      )}
      <div className="min-w-0 flex-1 text-body">
        <p className="font-semibold">
          {testResult.success
            ? t("connectionSuccessful", { latencyMs: testResult.latencyMs ?? 0 })
            : t("connectionFailed")}
        </p>
        {testResult.success ? (
          <p className="mt-1 text-caption opacity-90">
            {t("sampleCompletion", { sample: testResult.sample ?? "" })}
          </p>
        ) : (
          <div>
            <p className="mt-1 break-words text-caption opacity-90">
              {showFullError || failure.length <= 120 ? failure : `${failure.slice(0, 120)}…`}
            </p>
            {failure.length > 120 && (
              <button
                type="button"
                onClick={onToggleFullError}
                className="mt-2 flex items-center gap-1 text-caption font-medium underline opacity-90 hover:opacity-100"
              >
                {showFullError ? (
                  <>
                    <ChevronUp className="size-3.5" />
                    {t("showLess")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" />
                    {t("showDetails")}
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
