import { createServerFn } from "@tanstack/react-start";

import { ensureSession } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import {
  deleteRelationshipEntrySchema,
  getRelationshipMapSchema,
  setRelationshipEntryAutoManagedSchema,
  setRelationshipEntryEnabledSchema,
  upsertCharacterProfileSchema,
  upsertCharacterRelationshipSchema,
} from "./schemas";
import {
  deleteRelationshipEntryForUser,
  getRelationshipMapForUser,
  setRelationshipEntryAutoManagedForUser,
  setRelationshipEntryEnabledForUser,
  upsertCharacterProfileForUser,
  upsertCharacterRelationshipForUser,
} from "./service";

export const getRelationshipMap = createServerFn({ method: "GET" })
  .validator(getRelationshipMapSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return getRelationshipMapForUser(session.user.id, data.novelId);
    }),
  );

export const upsertCharacterProfile = createServerFn({ method: "POST" })
  .validator(upsertCharacterProfileSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return upsertCharacterProfileForUser(session.user.id, data);
    }),
  );

export const upsertCharacterRelationship = createServerFn({ method: "POST" })
  .validator(upsertCharacterRelationshipSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return upsertCharacterRelationshipForUser(session.user.id, data);
    }),
  );

export const setRelationshipEntryEnabled = createServerFn({ method: "POST" })
  .validator(setRelationshipEntryEnabledSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return setRelationshipEntryEnabledForUser(session.user.id, data);
    }),
  );

export const setRelationshipEntryAutoManaged = createServerFn({ method: "POST" })
  .validator(setRelationshipEntryAutoManagedSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return setRelationshipEntryAutoManagedForUser(session.user.id, data);
    }),
  );

export const deleteRelationshipEntry = createServerFn({ method: "POST" })
  .validator(deleteRelationshipEntrySchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return deleteRelationshipEntryForUser(session.user.id, data);
    }),
  );
