import { beforeEach, describe, expect, it, vi } from "vitest";

import { adoptProviderAvatars, type AdoptCandidate } from "./adopt-social-avatars";

const candidates: AdoptCandidate[] = [
  { id: "discord-user", image: "https://cdn.discordapp.com/avatars/1/abc.png" },
  { id: "google-user", image: "https://lh3.googleusercontent.com/a/abc=s96-c" },
];

const probe = vi.fn(async () => true);

beforeEach(() => {
  probe.mockClear();
  probe.mockResolvedValue(true);
});

describe("adoptProviderAvatars", () => {
  it("writes the mirrored key for every provider photo", async () => {
    const save = vi.fn(async () => {});
    const mirror = vi.fn(async (userId: string) => `avatars/${userId}/segment-1`);

    const result = await adoptProviderAvatars({ candidates, mirror, probe, save, dryRun: false });

    expect(result.adopted).toEqual(["discord-user", "google-user"]);
    expect(result.failed).toEqual([]);
    expect(mirror).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith("discord-user", "avatars/discord-user/segment-1");
    expect(save).toHaveBeenCalledWith("google-user", "avatars/google-user/segment-1");
  });

  it("leaves a failed row exactly as it was so a re-run can retry", async () => {
    const save = vi.fn(async () => {});
    const mirror = vi.fn(async (userId: string) =>
      userId === "discord-user" ? null : "avatars/google-user/segment-1",
    );

    const result = await adoptProviderAvatars({ candidates, mirror, probe, save, dryRun: false });

    expect(result.adopted).toEqual(["google-user"]);
    expect(result.failed).toEqual([
      { id: "discord-user", message: "provider photo could not be adopted" },
    ]);
    // The provider URL is the only copy of the source we hold; it is never discarded.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalledWith("discord-user", expect.anything());
  });

  it("reports a thrown failure instead of stopping the run", async () => {
    const save = vi.fn(async () => {});
    const mirror = vi.fn(async (userId: string) => {
      if (userId === "discord-user") throw new Error("socket hang up");
      return "avatars/google-user/segment-1";
    });

    const result = await adoptProviderAvatars({ candidates, mirror, probe, save, dryRun: false });

    expect(result.failed).toEqual([{ id: "discord-user", message: "socket hang up" }]);
    expect(result.adopted).toEqual(["google-user"]);
  });

  it("skips values that are not provider addresses without calling out", async () => {
    const save = vi.fn(async () => {});
    const mirror = vi.fn(async () => null);

    const result = await adoptProviderAvatars({
      candidates: [
        { id: "uploaded-photo", image: "avatars/uploaded-photo/segment-1" },
        { id: "someone-else", image: "https://evil.example.test/me.png" },
      ],
      mirror,
      probe,
      save,
      dryRun: false,
    });

    expect(result.skipped).toEqual(["uploaded-photo", "someone-else"]);
    expect(result.failed).toEqual([]);
    expect(mirror).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("writes nothing on a dry run, not even objects", async () => {
    const save = vi.fn(async () => {});
    const mirror = vi.fn(async (userId: string) => `avatars/${userId}/segment-1`);

    const result = await adoptProviderAvatars({ candidates, mirror, probe, save, dryRun: true });

    expect(result.adopted).toEqual(["discord-user", "google-user"]);
    expect(probe).toHaveBeenCalledTimes(2);
    // The mirror is what writes objects into the shared public bucket.
    expect(mirror).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reports a photo the provider no longer serves", async () => {
    const save = vi.fn(async () => {});
    const mirror = vi.fn(async () => null);
    probe.mockResolvedValue(false);

    const result = await adoptProviderAvatars({ candidates, mirror, probe, save, dryRun: true });

    expect(result.adopted).toEqual([]);
    expect(result.failed).toEqual([
      { id: "discord-user", message: "provider photo is not retrievable" },
      { id: "google-user", message: "provider photo is not retrievable" },
    ]);
  });
});
