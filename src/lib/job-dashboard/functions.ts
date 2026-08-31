import { createServerFn } from "@tanstack/react-start";

import { ensureSession } from "@/lib/auth/functions";
import { jobHistorySearchSchema } from "@/lib/job-dashboard/contracts";
import { loadJobHistory, loadJobStats } from "@/lib/job-dashboard/service";
import { withSafeHandler } from "@/lib/server-fn-error";
import { createServerTiming } from "@/lib/server-timing";

export const getJobDashboard = createServerFn({ method: "GET" })
  .validator(jobHistorySearchSchema)
  .handler(async ({ data }) => {
    const timing = createServerTiming();
    try {
      return await withSafeHandler(async () => {
        const session = await timing.measure("auth", () => ensureSession());
        const [history, stats] = await Promise.all([
          loadJobHistory(session.user.id, data, timing),
          loadJobStats(session.user.id, timing),
        ]);
        return { history, stats };
      });
    } finally {
      timing.flush();
    }
  });

export const getJobHistory = createServerFn({ method: "GET" })
  .validator(jobHistorySearchSchema)
  .handler(async ({ data }) => {
    const timing = createServerTiming();
    try {
      return await withSafeHandler(async () => {
        const session = await timing.measure("auth", () => ensureSession());
        return loadJobHistory(session.user.id, data, timing);
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
