import { setResponseHeader } from "@tanstack/react-start/server";

type Clock = () => number;

type Metric = {
  name: string;
  duration: number;
};

export type ServerTiming = {
  measure<T>(name: string, operation: () => Promise<T>): Promise<T>;
  flush(): void;
};

export function createServerTiming(now: Clock = performance.now.bind(performance)): ServerTiming {
  const startedAt = now();
  const metrics: Metric[] = [];
  let flushed = false;

  async function measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const operationStartedAt = now();
    try {
      return await operation();
    } finally {
      metrics.push({ name, duration: Math.max(0, now() - operationStartedAt) });
    }
  }

  function flush() {
    if (flushed) return;
    flushed = true;

    const entries = [...metrics, { name: "total", duration: Math.max(0, now() - startedAt) }];
    setResponseHeader(
      "Server-Timing",
      entries.map(({ name, duration }) => `${name};dur=${duration.toFixed(1)}`).join(", "),
    );
  }

  return { measure, flush };
}
