export const OPEN_CODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const OPEN_CODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPEN_CODE_LUNA_MODEL = "gpt-5.6-luna";

export function normalizeOpenCodeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (
    normalized === `${OPEN_CODE_ZEN_BASE_URL}/responses` ||
    normalized === `${OPEN_CODE_GO_BASE_URL}/responses`
  ) {
    return normalized.slice(0, -"/responses".length);
  }
  return normalized;
}

export function isOpenCodeLunaModel(model: string, baseUrl: string): boolean {
  const normalizedBaseUrl = normalizeOpenCodeBaseUrl(baseUrl);
  return (
    model === OPEN_CODE_LUNA_MODEL &&
    (normalizedBaseUrl === OPEN_CODE_ZEN_BASE_URL || normalizedBaseUrl === OPEN_CODE_GO_BASE_URL)
  );
}
