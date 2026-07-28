import { CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

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
  return (
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
          <p className="mt-1 text-caption opacity-90">Sample completion: "{testResult.sample}"</p>
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
                onClick={onToggleFullError}
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
  );
}
