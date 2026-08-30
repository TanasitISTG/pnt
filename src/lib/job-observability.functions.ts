import { createServerFn } from "@tanstack/react-start";
import { ensureSession } from "@/lib/auth/functions";
import { loadJobActivity, loadJobStats } from "@/lib/job-observability.service";
import { withSafeHandler } from "@/lib/server-fn-error";
import { createServerTiming } from "@/lib/server-timing";

export const getJobDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const timing = createServerTiming();
  try {
    return await withSafeHandler(async () => {
      const session = await timing.measure("auth", () => ensureSession());
      const [activity, stats] = await Promise.all([
        loadJobActivity(session.user.id, timing),
        loadJobStats(session.user.id, timing),
      ]);
      return { activity, stats };
    });
  } finally {
    timing.flush();
  }
});

export const getJobActivity = createServerFn({ method: "GET" }).handler(async () => {
  const timing = createServerTiming();
  try {
    return await withSafeHandler(async () => {
      const session = await timing.measure("auth", () => ensureSession());
      return loadJobActivity(session.user.id, timing);
    });
  } finally {
    timing.flush();
  }
});

export const getJobStats = createServerFn({ method: "GET" }).handler(async () => {
  const timing = createServerTiming();
  try {
    return await withSafeHandler(async () => {
      const session = await timing.measure("auth", () => ensureSession());
      return loadJobStats(session.user.id, timing);
    });
  } finally {
    timing.flush();
  }
});
