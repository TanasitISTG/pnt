// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderSettingsCard } from "./provider-settings-card";

const LUNA_SETTINGS = {
  isConfigured: true,
  provider: "openai" as const,
  baseUrl: "https://opencode.ai/zen/go/v1/responses",
  model: "gpt-5.6-luna",
  fastModel: null,
  temperature: 0.7,
  reasoningEffort: null,
  requestTimeoutSec: null,
  apiKeyMasked: "sk-…test",
  hasApiKey: true,
  inputPricePer1M: null,
  outputPricePer1M: null,
};
describe("ProviderSettingsCard", () => {
  it("disables temperature for OpenCode Luna and re-enables it for other models", () => {
    render(
      <ProviderSettingsCard
        initialSettings={LUNA_SETTINGS}
        saving={false}
        testing={false}
        onSave={async () => true}
        onTest={async () => ({ success: true })}
      />,
    );

    const temperature = screen.getByLabelText("Temperature") as HTMLInputElement;
    expect(temperature.disabled).toBe(true);
    expect(screen.getByText("OpenCode Luna does not support a custom temperature.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Model Name"), {
      target: { value: "gpt-4o" },
    });

    expect(temperature.disabled).toBe(false);
    expect(screen.getByText(/Lower values \(0\.2–0\.5\)/)).toBeTruthy();
  });
});
