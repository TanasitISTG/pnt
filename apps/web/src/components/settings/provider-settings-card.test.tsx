// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsCard, type ProviderTestResult } from "./provider-settings-card";
import type {
  ProviderSettings,
  SaveProviderSettingsInput,
  TestProviderConnectionInput,
} from "@/lib/settings/schemas";

afterEach(cleanup);

const BASE_SETTINGS: ProviderSettings = {
  isConfigured: true,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  fastModel: null,
  temperature: 0.7,
  reasoningEffort: null,
  requestTimeoutSec: null,
  apiKeyMasked: "sk-…test",
  hasApiKey: true,
  inputPricePer1M: null,
  outputPricePer1M: null,
};

const LUNA_SETTINGS: ProviderSettings = {
  ...BASE_SETTINGS,
  baseUrl: "https://opencode.ai/zen/go/v1/responses",
  model: "gpt-5.6-luna",
};

function renderCard(
  overrides: Partial<ProviderSettings> = {},
  handlers: {
    onSave?: (data: SaveProviderSettingsInput) => Promise<boolean>;
    onTest?: (data: TestProviderConnectionInput) => Promise<ProviderTestResult>;
  } = {},
) {
  const onSave = vi.fn<ProviderSettingsCardHandlers["onSave"]>(
    handlers.onSave ?? (async () => true),
  );
  const onTest = vi.fn<ProviderSettingsCardHandlers["onTest"]>(
    handlers.onTest ?? (async () => ({ success: true })),
  );
  const view = render(
    <ProviderSettingsCard
      initialSettings={{ ...BASE_SETTINGS, ...overrides }}
      onSave={onSave}
      onTest={onTest}
    />,
  );
  return { ...view, onSave, onTest };
}

interface ProviderSettingsCardHandlers {
  onSave: (data: SaveProviderSettingsInput) => Promise<boolean>;
  onTest: (data: TestProviderConnectionInput) => Promise<ProviderTestResult>;
}

function temperatureSliderInput(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('[data-slot="slider"] input[type="range"]');
}

describe("ProviderSettingsCard", () => {
  it("disables temperature for OpenCode Luna and re-enables it for other models", () => {
    const { container } = renderCard(LUNA_SETTINGS);

    expect(temperatureSliderInput(container)?.disabled).toBe(true);
    expect(screen.getByText("OpenCode Luna does not support a custom temperature.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Model Name"), { target: { value: "gpt-4o" } });

    expect(temperatureSliderInput(container)?.disabled).toBe(false);
    expect(screen.getByText(/Lower values \(0\.2–0\.5\)/)).toBeTruthy();
  });

  it("transforms editable strings into the save contract", async () => {
    const { onSave } = renderCard();

    fireEvent.change(screen.getByLabelText("Fast Model (Cheaper tasks)"), {
      target: { value: " gpt-4o-mini " },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "  sk-live-key  " } });
    fireEvent.change(screen.getByLabelText("Request Timeout (seconds)"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText("Input price"), { target: { value: "0.075" } });
    fireEvent.change(screen.getByLabelText("Output price"), { target: { value: "0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-live-key",
      model: "gpt-4o",
      fastModel: "gpt-4o-mini",
      reasoningEffort: null,
      temperature: 0.7,
      requestTimeoutSec: 300,
      inputPricePer1M: 0.075,
      outputPricePer1M: 0.3,
    });
  });

  it("clears the API key field and masks the saved key after a successful save", async () => {
    const { onSave } = renderCard({ hasApiKey: false, apiKeyMasked: "" });
    const apiKey = screen.getByLabelText("API Key") as HTMLInputElement;

    fireEvent.change(apiKey, { target: { value: "sk-abcdefghijkl" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(apiKey.value).toBe(""));
    expect(screen.getByText("Key saved (sk-…ijkl)")).toBeTruthy();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("keeps Test Connection independent from unrelated pricing errors", async () => {
    const { onSave, onTest } = renderCard();

    fireEvent.change(screen.getByLabelText("Output price"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => expect(onTest).toHaveBeenCalledOnce());
    expect(onTest.mock.calls[0]?.[0]).toEqual({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: undefined,
      model: "gpt-4o",
      fastModel: null,
      reasoningEffort: null,
      temperature: 0.7,
      requestTimeoutSec: null,
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a replacement API key over an existing one and re-masks it", async () => {
    const { onSave } = renderCard();
    const apiKey = screen.getByLabelText("API Key") as HTMLInputElement;
    expect(screen.getByText("Key saved (sk-…test)")).toBeTruthy();

    fireEvent.change(apiKey, { target: { value: "sk-replacement-9999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ apiKey: "sk-replacement-9999" });
    await waitFor(() => expect(apiKey.value).toBe(""));
    expect(screen.getByText("Key saved (sk-…9999)")).toBeTruthy();
  });

  it("keeps the stored key when the field is left blank", async () => {
    const { onSave } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ apiKey: undefined });
    expect(screen.getByText("Key saved (sk-…test)")).toBeTruthy();
  });

  it("offers Test Connection even when no API key is available", async () => {
    const { onTest } = renderCard({ hasApiKey: false, apiKeyMasked: "" });
    const testButton = screen.getByRole("button", {
      name: "Test Connection",
    }) as HTMLButtonElement;

    expect(testButton.disabled).toBe(false);

    fireEvent.click(testButton);

    await waitFor(() => expect(onTest).toHaveBeenCalledOnce());
  });

  it("blocks Save on the pricing error that Test Connection ignores", async () => {
    const { onSave } = renderCard();

    fireEvent.change(screen.getByLabelText("Output price"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    expect(await screen.findByText("Price must be zero or greater")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
