import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { ensureSession } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";

import { updateProfileImageSchema, updateProfileNameSchema } from "./schemas";
// Server-only work lives behind the service so the client graph only ever sees the
// RPC stubs below; a plain export that touched storage would drag the bucket into
// the browser bundle and fail the build's import protection.
import {
  applyProfileName,
  clearProfileImage,
  replaceProfileImage,
  viewerProfileForHeaders,
} from "./service.server";
import type { ViewerProfile } from "./types";

/** The signed-in viewer for the router context; null for a guest. */
export const getViewerProfile = createServerFn({ method: "GET" }).handler(() =>
  withSafeHandler(async (): Promise<ViewerProfile | null> =>
    viewerProfileForHeaders(getRequestHeaders()),
  ),
);

export const updateProfileName = createServerFn({ method: "POST" })
  .validator(updateProfileNameSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true; name: string }> => {
      await ensureSession();
      await applyProfileName(getRequestHeaders(), data.name);
      return { success: true, name: data.name };
    }),
  );

export const updateProfileImage = createServerFn({ method: "POST" })
  .validator(updateProfileImageSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async (): Promise<{ success: true }> => {
      const session = await ensureSession();
      await replaceProfileImage(
        getRequestHeaders(),
        session.user.id,
        session.user.image ?? null,
        data,
      );
      return { success: true };
    }),
  );

export const removeProfileImage = createServerFn({ method: "POST" }).handler(async () =>
  withSafeHandler(async (): Promise<{ success: true }> => {
    const session = await ensureSession();
    await clearProfileImage(getRequestHeaders(), session.user.image ?? null);
    return { success: true };
  }),
);
