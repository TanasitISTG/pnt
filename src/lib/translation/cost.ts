export function calculateTokenCost(
  promptTokens: number,
  completionTokens: number,
  inputPricePer1M: number | null | undefined,
  outputPricePer1M: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(promptTokens) ||
    promptTokens < 0 ||
    !Number.isFinite(completionTokens) ||
    completionTokens < 0 ||
    inputPricePer1M == null ||
    !Number.isFinite(inputPricePer1M) ||
    inputPricePer1M < 0 ||
    outputPricePer1M == null ||
    !Number.isFinite(outputPricePer1M) ||
    outputPricePer1M < 0
  ) {
    return null;
  }

  return (promptTokens * inputPricePer1M + completionTokens * outputPricePer1M) / 1_000_000;
}
