import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "@/lib/utils";
import { db } from "@/lib/db";
import { novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import {
  deleteRelationshipEntrySchema,
  setRelationshipEntryAutoManagedSchema,
  setRelationshipEntryEnabledSchema,
  upsertCharacterProfileSchema,
  upsertCharacterRelationshipSchema,
  type DeleteRelationshipEntryInput,
  type SetRelationshipEntryAutoManagedInput,
  type SetRelationshipEntryEnabledInput,
  type UpsertCharacterProfileInput,
  type UpsertCharacterRelationshipInput,
} from "./schemas";
import { parseRelationshipMap, serializeRelationshipMap } from "./map";
import type { RelationshipMapV1 } from "./schemas";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getRelationshipMapForUser(
  userId: string,
  novelId: string,
): Promise<RelationshipMapV1> {
  const [novel] = await db
    .select({ relationshipMapJson: novels.relationshipMapJson })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) throw new SafeServerError("Novel not found or unauthorized");
  return parseStoredMap(novel.relationshipMapJson);
}

export async function upsertCharacterProfileForUser(
  userId: string,
  rawData: UpsertCharacterProfileInput,
): Promise<RelationshipMapV1> {
  const data = upsertCharacterProfileSchema.parse(rawData);
  return db.transaction(async (tx) => {
    const { novel, map } = await lockOwnedNovel(tx, userId, data.novelId);
    const existing = data.id ? map.characters.find((character) => character.id === data.id) : null;
    if (data.id && !existing) throw new SafeServerError("Character profile not found");

    const now = new Date().toISOString();
    const profile = {
      id: existing?.id ?? nanoid(),
      sourceName: data.sourceName.trim(),
      targetName: data.targetName?.trim() || null,
      aliases: data.aliases.map((alias) => alias.trim()),
      gender: data.gender,
      role: data.role?.trim() || null,
      notes: data.notes?.trim() || null,
      enabled: true,
      locked: true,
      evidence: data.evidence?.trim() || null,
      lastSeenChapter: existing?.lastSeenChapter ?? null,
      updatedAt: now,
    };
    const next = {
      version: 1 as const,
      characters: map.characters.some((character) => character.id === profile.id)
        ? map.characters.map((character) => (character.id === profile.id ? profile : character))
        : [...map.characters, profile],
      relationships: map.relationships,
    };
    return saveValidatedMap(tx, novel.id, next);
  });
}

export async function upsertCharacterRelationshipForUser(
  userId: string,
  rawData: UpsertCharacterRelationshipInput,
): Promise<RelationshipMapV1> {
  const data = upsertCharacterRelationshipSchema.parse(rawData);
  return db.transaction(async (tx) => {
    const { novel, map } = await lockOwnedNovel(tx, userId, data.novelId);
    if (data.speakerId === data.listenerId) {
      throw new SafeServerError("A relationship cannot point to the same character");
    }
    if (!map.characters.some((character) => character.id === data.speakerId)) {
      throw new SafeServerError("Speaker character not found");
    }
    if (!map.characters.some((character) => character.id === data.listenerId)) {
      throw new SafeServerError("Listener character not found");
    }

    const existing = data.id
      ? map.relationships.find((relationship) => relationship.id === data.id)
      : null;
    if (data.id && !existing) throw new SafeServerError("Relationship entry not found");
    const duplicatePair = map.relationships.find(
      (relationship) =>
        relationship.id !== existing?.id &&
        relationship.speakerId === data.speakerId &&
        relationship.listenerId === data.listenerId,
    );
    if (duplicatePair) {
      throw new SafeServerError("That directed speaker/listener pair already exists");
    }

    const now = new Date().toISOString();
    const relationship = {
      id: existing?.id ?? nanoid(),
      speakerId: data.speakerId,
      listenerId: data.listenerId,
      relationship: data.relationship.trim(),
      speakerStatus: data.speakerStatus,
      familiarity: data.familiarity,
      selfPronoun: data.selfPronoun?.trim() || null,
      addresseeTerm: data.addresseeTerm?.trim() || null,
      sentenceParticles: data.sentenceParticles?.trim() || null,
      register: data.register?.trim() || null,
      notes: data.notes?.trim() || null,
      enabled: true,
      locked: true,
      evidence: data.evidence?.trim() || null,
      lastSeenChapter: existing?.lastSeenChapter ?? null,
      updatedAt: now,
    };
    const next = {
      version: 1 as const,
      characters: map.characters,
      relationships: map.relationships.some((item) => item.id === relationship.id)
        ? map.relationships.map((item) => (item.id === relationship.id ? relationship : item))
        : [...map.relationships, relationship],
    };
    return saveValidatedMap(tx, novel.id, next);
  });
}

export async function setRelationshipEntryEnabledForUser(
  userId: string,
  rawData: SetRelationshipEntryEnabledInput,
): Promise<RelationshipMapV1> {
  const data = setRelationshipEntryEnabledSchema.parse(rawData);
  return db.transaction(async (tx) => {
    const { novel, map } = await lockOwnedNovel(tx, userId, data.novelId);
    const now = new Date().toISOString();
    const next = updateEntry(map, data.entryType, data.entryId, (entry) => ({
      ...entry,
      enabled: data.enabled,
      locked: data.enabled ? entry.locked : true,
      updatedAt: now,
    }));
    return saveValidatedMap(tx, novel.id, next);
  });
}

export async function setRelationshipEntryAutoManagedForUser(
  userId: string,
  rawData: SetRelationshipEntryAutoManagedInput,
): Promise<RelationshipMapV1> {
  const data = setRelationshipEntryAutoManagedSchema.parse(rawData);
  return db.transaction(async (tx) => {
    const { novel, map } = await lockOwnedNovel(tx, userId, data.novelId);
    const now = new Date().toISOString();
    const next = updateEntry(map, data.entryType, data.entryId, (entry) => ({
      ...entry,
      enabled: true,
      locked: false,
      updatedAt: now,
    }));
    return saveValidatedMap(tx, novel.id, next);
  });
}

export async function deleteRelationshipEntryForUser(
  userId: string,
  rawData: DeleteRelationshipEntryInput,
): Promise<RelationshipMapV1> {
  const data = deleteRelationshipEntrySchema.parse(rawData);
  return db.transaction(async (tx) => {
    const { novel, map } = await lockOwnedNovel(tx, userId, data.novelId);
    let next: RelationshipMapV1;
    if (data.entryType === "character") {
      if (!map.characters.some((character) => character.id === data.entryId)) {
        throw new SafeServerError("Character profile not found");
      }
      next = {
        version: 1,
        characters: map.characters.filter((character) => character.id !== data.entryId),
        relationships: map.relationships.filter(
          (relationship) =>
            relationship.speakerId !== data.entryId && relationship.listenerId !== data.entryId,
        ),
      };
    } else {
      if (!map.relationships.some((relationship) => relationship.id === data.entryId)) {
        throw new SafeServerError("Relationship entry not found");
      }
      next = {
        version: 1,
        characters: map.characters,
        relationships: map.relationships.filter((relationship) => relationship.id !== data.entryId),
      };
    }
    return saveValidatedMap(tx, novel.id, next);
  });
}

async function lockOwnedNovel(tx: DbTransaction, userId: string, novelId: string) {
  const [novel] = await tx
    .select({ id: novels.id, relationshipMapJson: novels.relationshipMapJson })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1)
    .for("update");
  if (!novel) throw new SafeServerError("Novel not found or unauthorized");
  return { novel, map: parseStoredMap(novel.relationshipMapJson) };
}

async function saveValidatedMap(
  tx: DbTransaction,
  novelId: string,
  map: RelationshipMapV1,
): Promise<RelationshipMapV1> {
  const serialized = serializeRelationshipMap(map);
  await tx
    .update(novels)
    .set({ relationshipMapJson: serialized, updatedAt: new Date() })
    .where(eq(novels.id, novelId));
  return map;
}

function parseStoredMap(json: string): RelationshipMapV1 {
  const map = parseRelationshipMap(json);
  if (!map) {
    throw new SafeServerError("Relationship map is invalid and cannot be edited safely");
  }
  return map;
}

function updateEntry(
  map: RelationshipMapV1,
  entryType: "character" | "relationship",
  entryId: string,
  update: (
    entry: RelationshipMapV1["characters"][number] | RelationshipMapV1["relationships"][number],
  ) => RelationshipMapV1["characters"][number] | RelationshipMapV1["relationships"][number],
): RelationshipMapV1 {
  if (entryType === "character") {
    const entry = map.characters.find((character) => character.id === entryId);
    if (!entry) throw new SafeServerError("Character profile not found");
    return {
      version: 1,
      characters: map.characters.map((character) =>
        character.id === entryId
          ? (update(entry) as RelationshipMapV1["characters"][number])
          : character,
      ),
      relationships: map.relationships,
    };
  }

  const entry = map.relationships.find((relationship) => relationship.id === entryId);
  if (!entry) throw new SafeServerError("Relationship entry not found");
  return {
    version: 1,
    characters: map.characters,
    relationships: map.relationships.map((relationship) =>
      relationship.id === entryId
        ? (update(entry) as RelationshipMapV1["relationships"][number])
        : relationship,
    ),
  };
}
