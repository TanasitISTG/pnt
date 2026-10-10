export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const workerCount = Number.isFinite(concurrency)
    ? Math.min(items.length, Math.max(1, Math.floor(concurrency)))
    : 1;
  const results: R[] = [];
  results.length = items.length;
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;

    results[index] = await mapper(items[index], index);
    return runNext();
  }

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}
