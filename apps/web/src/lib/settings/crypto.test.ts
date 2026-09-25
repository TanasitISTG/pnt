import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto";

describe("crypto module", () => {
  it("encrypts and decrypts text correctly", () => {
    const secretText = "sk-proj-test-1234567890-api-key";
    const encrypted = encrypt(secretText);

    expect(encrypted).not.toBe(secretText);
    expect(encrypted.split(":")).toHaveLength(3);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(secretText);
  });

  it("handles empty string roundtrip", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toBe("");
  });

  it("throws on corrupted ciphertext or auth tag", () => {
    const encrypted = encrypt("my-secret");
    const parts = encrypted.split(":");
    // corrupt ciphertext
    const corruptedCipher = `${parts[0]}:000000:${parts[2]}`;
    expect(() => decrypt(corruptedCipher)).toThrow();

    // corrupt auth tag
    const corruptedTag = `${parts[0]}:${parts[1]}:00000000000000000000000000000000`;
    expect(() => decrypt(corruptedTag)).toThrow();
  });

  it("throws on invalid format", () => {
    expect(() => decrypt("invalid-string-without-colons")).toThrow(
      "Invalid encrypted payload format",
    );
  });
});
