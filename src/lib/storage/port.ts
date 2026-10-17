// The port an adapter becomes. One wrapper, applied where an adapter is chosen, so every
// bucket the app can reach addresses keys the vocabulary derives and reads a prefix exactly
// once — here.

import { isObjectKeyPrefix, keySetScope, ownerOfObjectKey } from "./keys";
import type { KeySetPrefix, ObjectKey } from "./keys";
import type { ObjectStorage, ObjectStorageBackend } from "./types";

/**
 * A key or prefix the vocabulary does not derive, refused before anything is sent.
 *
 * It carries the offending value and opens with the port's established words for a path it
 * will not touch, so a caller sees one rejection vocabulary whether the key was unsafe to a
 * filesystem or simply never derived.
 */
export class StorageKeyError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "StorageKeyError";
  }
}

/**
 * Turns an adapter into a bucket.
 *
 * Two things happen here and nowhere else. A key or prefix is checked against the rule `keys.ts`
 * owns — a key that reads as no owner's, a prefix that names no set (a hand-built path, a shape from
 * an older layout, a traversal attempt) is refused *here*, before the adapter is touched, so it
 * cannot reach a bucket even if a caller tries: the alternative is finding the object later in a
 * listing, and a listing is exactly where the audit reports what nothing owns. And a prefix is
 * resolved once into a `KeySetScope`, so the adapter's own spelling of the set boundary cannot
 * drift from the other adapters'.
 *
 * The declared types carry the same rule as the check below, which is why both exist. A parameter is
 * an `ObjectKey` or a `KeySetPrefix`, so a plain string never gets this far; a value that arrived as
 * data — a row, a listing, a request — is read back through `parseObjectKey`/`isObjectKeyPrefix`
 * first, by the caller that has it. What is left for runtime is a value that bypassed the type: a cast, or
 * a caller from outside this application's TypeScript. Both ask the vocabulary the same question, so
 * neither can admit something the other refuses.
 *
 * Refusals reject rather than throw. Every method below is `async` for that reason: callers
 * write `storage.delete(key).catch(...)` on paths where a failure is expected, and a
 * synchronous throw would escape that chain instead of being handled by it.
 *
 * `publicUrl` is deliberately not wrapped. It derives a URL and reaches no bucket, while the
 * paths that call it — a catalog page resolving a cover, a comment thread resolving an avatar
 * — resolve a key stored on a row, and a row that holds a malformed key should degrade to a
 * missing image rather than fail the whole page.
 *
 * Adapters are wrapped at the one place they are chosen, so a third adapter cannot be added
 * without one. The cost is a split per operation against a request that is at least a disk
 * write, which is why the check is unconditional rather than opt-in.
 */
export function createObjectStorage(backend: ObjectStorageBackend): ObjectStorage {
  return {
    async put(key, bytes, options) {
      assertDerivedObjectKey(key);
      await backend.put(key, bytes, options);
    },
    async get(key) {
      assertDerivedObjectKey(key);
      return await backend.get(key);
    },
    async head(key) {
      assertDerivedObjectKey(key);
      return await backend.head(key);
    },
    async delete(key) {
      assertDerivedObjectKey(key);
      await backend.delete(key);
    },
    async deletePrefix(prefix) {
      assertDerivedKeyPrefix(prefix);
      await backend.removeSet(keySetScope(prefix));
    },
    async listKeys(prefix) {
      assertDerivedKeyPrefix(prefix);
      return await backend.listSet(keySetScope(prefix));
    },
    async listObjects(prefix) {
      assertDerivedKeyPrefix(prefix);
      return await backend.listObjects(keySetScope(prefix));
    },
    async presignPut(key, options) {
      assertDerivedObjectKey(key);
      return await backend.presignPut(key, options);
    },
    // Not guarded by design: see the note above.
    publicUrl: (key) => backend.publicUrl(key),
  };
}

/** Asserts rather than returns, so a caller that reached here with a plain string is narrowed too. */
function assertDerivedObjectKey(key: string): asserts key is ObjectKey {
  if (ownerOfObjectKey(key) !== null) return;
  throw new StorageKeyError(
    key,
    `Unsafe storage key: "${key}" is not a shape the key vocabulary derives`,
  );
}

function assertDerivedKeyPrefix(prefix: string): asserts prefix is KeySetPrefix {
  if (isObjectKeyPrefix(prefix)) return;
  throw new StorageKeyError(
    prefix,
    `Unsafe storage key prefix: "${prefix}" is not a set the key vocabulary derives`,
  );
}
