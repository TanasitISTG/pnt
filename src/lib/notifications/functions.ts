import { createServerFn } from "@tanstack/react-start";

import { ensureSession, ensureSessionForRead } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import { getNovelFollowForUser, setNovelFollowForUser } from "./follow.service.server";
import {
  markNotificationsReadSchema,
  notificationNovelSchema,
  setNovelFollowSchema,
} from "./schemas";
import { listNotificationsForUser, markNotificationsReadForUser } from "./service.server";

/**
 * The bell and the follow button. Reads accept an impersonated session, exactly as the
 * reader's own state does, while every write goes through `ensureSession` — so an operator
 * viewing an account can see its notifications and cannot clear them.
 */
export const listNotifications = createServerFn({ method: "GET" }).handler(async () => {
  return withSafeHandler(async () => {
    const session = await ensureSessionForRead();
    return listNotificationsForUser(session.user.id);
  });
});

export const markNotificationsRead = createServerFn({ method: "POST" })
  .validator(markNotificationsReadSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return markNotificationsReadForUser(session.user.id, data.ids);
    });
  });

export const getNovelFollow = createServerFn({ method: "GET" })
  .validator(notificationNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getNovelFollowForUser(session.user.id, data.novelId);
    });
  });

export const setNovelFollow = createServerFn({ method: "POST" })
  .validator(setNovelFollowSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return setNovelFollowForUser(session.user.id, data.novelId, data.following);
    });
  });
