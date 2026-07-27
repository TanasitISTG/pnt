import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./provider-client.ts", import.meta.url)),
  "utf8",
);

describe("provider-client module", () => {
  it("exports OpenAIProviderClient and GeminiProviderClient classes", () => {
    expect(source).toContain("export class OpenAIProviderClient");
    expect(source).toContain("export class GeminiProviderClient");
  });

  it("supports provider type selection in createProviderClient", () => {
    expect(source).toContain('provider === "gemini"');
    expect(source).toContain("new GeminiProviderClient");
    expect(source).toContain("new OpenAIProviderClient");
  });

  it("handles Gemini system instructions and response format", () => {
    expect(source).toContain("systemInstruction:");
    expect(source).toContain(
      'responseMimeType:\n          options.responseFormat?.type === "json_object" ? "application/json" : undefined',
    );
  });

  it("extracts token counts from Gemini usageMetadata", () => {
    expect(source).toContain("response.usageMetadata?.promptTokenCount");
    expect(source).toContain("response.usageMetadata?.candidatesTokenCount");
  });

  it("passes fastModel configuration to provider clients", () => {
    expect(source).toContain("fastModel?: string | null");
    expect(source).toContain("fastModel: settings.fastModel");
  });
});
