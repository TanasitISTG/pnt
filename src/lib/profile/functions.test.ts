import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeMessage } from "@/lib/i18n/message-code";

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  writeAvatarSet: vi.fn(),
  deleteAvatarSet: vi.fn(),
  resolveUserAvatar: vi.fn(),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { updateUser: mocks.updateUser } },
}));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));
vi.mock("./avatar.server", () => ({
  writeAvatarSet: mocks.writeAvatarSet,
  deleteAvatarSet: mocks.deleteAvatarSet,
  resolveUserAvatar: mocks.resolveUserAvatar,
}));

// The server functions wrapping these behaviors go through TanStack Start's
// compiler, which is why the tests drive the server-only service directly.
const { applyProfileName, clearProfileImage, replaceProfileImage, viewerProfileForSession } =
  await import("./service.server");

const PREVIOUS_KEY = "avatars/user-1/oldsegment";
const NEW_KEY = "avatars/user-1/newsegment";

/** A real PNG header, so the shared magic-byte check sees bytes it would accept. */
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const UPLOAD = { image: PNG_BASE64, imageMime: "image/png" } as const;

const headers = new Headers();

const sessionWith = (image: string | null) => ({
  user: {
    id: "user-1",
    name: "tana",
    email: "tana@example.test",
    emailVerified: true,
    image,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});

const impersonatedSessionWith = (image: string | null) => ({
  ...sessionWith(image),
  session: { impersonatedBy: "operator-1" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAvatarSet.mockResolvedValue(NEW_KEY);
  mocks.deleteAvatarSet.mockResolvedValue(undefined);
  mocks.updateUser.mockResolvedValue({ status: true });
  mocks.resolveUserAvatar.mockReturnValue({ url: "https://cdn.test/a.webp", srcSet: null });
});

describe("viewerProfileForSession", () => {
  it("returns null for guests", () => {
    expect(viewerProfileForSession(null)).toBeNull();
    expect(mocks.resolveUserAvatar).not.toHaveBeenCalled();
  });

  it("exposes resolved URLs and withholds the stored object key", () => {
    const viewer = viewerProfileForSession(sessionWith(PREVIOUS_KEY));

    expect(viewer?.user).not.toHaveProperty("image");
    expect(viewer).toMatchObject({
      user: { id: "user-1", name: "tana", email: "tana@example.test" },
      avatar: { url: "https://cdn.test/a.webp", srcSet: null },
    });
    expect(mocks.resolveUserAvatar).toHaveBeenCalledWith(PREVIOUS_KEY);
  });

  it("reports an ordinary session as not impersonating", () => {
    expect(viewerProfileForSession(sessionWith(null))?.impersonation).toBeNull();
  });

  it("carries the operator to return to while viewing as an account", () => {
    // The banner is driven from here, so the shell can name both sides without a
    // second request of its own.
    expect(
      viewerProfileForSession(impersonatedSessionWith(null), "Operator")?.impersonation,
    ).toEqual({ operatorId: "operator-1", operatorName: "Operator" });
    expect(viewerProfileForSession(impersonatedSessionWith(null))?.impersonation).toEqual({
      operatorId: "operator-1",
      operatorName: null,
    });
  });

  it("still renders the shell when the photo cannot be resolved", () => {
    mocks.resolveUserAvatar.mockImplementation(() => {
      throw new Error("storage unreachable");
    });

    expect(viewerProfileForSession(sessionWith(PREVIOUS_KEY))).toMatchObject({
      avatar: null,
      user: { name: "tana" },
    });
  });
});

describe("applyProfileName", () => {
  it("writes the new name through Better Auth", async () => {
    await applyProfileName(headers, "tana");
    expect(mocks.updateUser).toHaveBeenCalledWith({ headers, body: { name: "tana" } });
  });

  it("reports a fixed message instead of the driver's", async () => {
    mocks.updateUser.mockRejectedValue(new Error('relation "user" does not exist'));

    await expect(applyProfileName(headers, "tana")).rejects.toThrow(
      encodeMessage("errors.displayNameUpdateFailed"),
    );
  });
});

describe("replaceProfileImage", () => {
  it("writes the object set before the row and then drops the replaced photo", async () => {
    await replaceProfileImage(headers, "user-1", PREVIOUS_KEY, UPLOAD);

    expect(mocks.writeAvatarSet).toHaveBeenCalledWith("user-1", expect.any(Buffer), "image/png");
    expect(mocks.updateUser).toHaveBeenCalledWith({ headers, body: { image: NEW_KEY } });
    expect(mocks.deleteAvatarSet).toHaveBeenCalledWith(PREVIOUS_KEY);
  });

  it("accepts an upload with no previous photo", async () => {
    await replaceProfileImage(headers, "user-1", null, UPLOAD);

    expect(mocks.deleteAvatarSet).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAvatarSet).toHaveBeenCalledWith(null);
  });

  it("rejects bytes that do not match the declared type before writing anything", async () => {
    await expect(
      replaceProfileImage(headers, "user-1", PREVIOUS_KEY, {
        image: PNG_BASE64,
        imageMime: "image/jpeg",
      }),
    ).rejects.toThrow(encodeMessage("errors.imageTypeMismatch"));

    expect(mocks.writeAvatarSet).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("deletes the fresh set when the row write fails, so the profile never dangles", async () => {
    mocks.updateUser.mockRejectedValue(new Error("row write failed"));

    await expect(replaceProfileImage(headers, "user-1", PREVIOUS_KEY, UPLOAD)).rejects.toThrow(
      "row write failed",
    );

    expect(mocks.deleteAvatarSet).toHaveBeenCalledWith(NEW_KEY);
    expect(mocks.deleteAvatarSet).not.toHaveBeenCalledWith(PREVIOUS_KEY);
  });
});

describe("clearProfileImage", () => {
  it("clears the key and deletes the objects", async () => {
    await expect(clearProfileImage(headers, PREVIOUS_KEY)).resolves.toBe(true);

    expect(mocks.updateUser).toHaveBeenCalledWith({ headers, body: { image: null } });
    expect(mocks.deleteAvatarSet).toHaveBeenCalledWith(PREVIOUS_KEY);
  });

  it("does nothing when there is no photo", async () => {
    await expect(clearProfileImage(headers, null)).resolves.toBe(false);

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.deleteAvatarSet).not.toHaveBeenCalled();
  });
});
