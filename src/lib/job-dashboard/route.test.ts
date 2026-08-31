import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/jobs/jobs-page", () => ({ JobsPage: () => null }));
vi.mock("@/lib/job-dashboard/functions", () => ({ getJobDashboard: vi.fn() }));

import { Route } from "@/routes/_protected/jobs";

describe("jobs route data ownership", () => {
  it("hydrates on entry without keying the loader by investigation state", () => {
    expect(Route.options.shouldReload).toBe(false);
    expect(Route.options.loaderDeps?.({ search: { page: 2 } } as never)).toEqual({});
  });
});
