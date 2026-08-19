import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  cancelEpubImportJob: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/epub/job-store", () => ({
  cancelEpubImportJob: mocks.cancelEpubImportJob,
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: mocks.send },
}));

import { cancelActiveImportJobsForNovel } from "./job-control";

describe("import cancellation routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReturnValue({
      from: () => ({
        where: () =>
          Promise.resolve([
            { id: "epub-job", kind: "epub" },
            { id: "scrape-job", kind: "scrape" },
          ]),
      }),
    });
    mocks.cancelEpubImportJob.mockResolvedValue(true);
    mocks.db.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: "scrape-job" }]),
        }),
      }),
    });
    mocks.send.mockResolvedValue(undefined);
  });

  it("cancels each active kind and emits its matching event", async () => {
    await cancelActiveImportJobsForNovel("novel-1");

    expect(mocks.cancelEpubImportJob).toHaveBeenCalledWith("epub-job");
    expect(mocks.send).toHaveBeenCalledWith({
      name: "epub/import.cancelled",
      data: { jobId: "epub-job" },
    });
    expect(mocks.send).toHaveBeenCalledWith({
      name: "scrape/import.cancelled",
      data: { jobId: "scrape-job" },
    });
  });
});
