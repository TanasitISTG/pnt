export const MAX_PERSISTED_TOKEN_COUNT = 2_147_483_647;

export function assertPersistableTokenCount(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_PERSISTED_TOKEN_COUNT) {
    throw new RangeError("Token count exceeds the persistence limit");
  }
}

export function sumPersistableTokenCounts(...values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertPersistableTokenCount(value);
    total += value;
    assertPersistableTokenCount(total);
  }
  return total;
}
