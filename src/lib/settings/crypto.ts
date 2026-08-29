import "@tanstack/react-start/server-only";
import crypto from "node:crypto";
import { env } from "@/lib/env";

function getEncryptionKeyBuffer(): Buffer {
  const raw = env.APP_ENCRYPTION_KEY;
  const base64Buf = Buffer.from(raw, "base64");
  if (base64Buf.length === 32) {
    return base64Buf;
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const key = getEncryptionKeyBuffer();
  const iv = Buffer.from(parts[0], "hex");
  const ciphertext = Buffer.from(parts[1], "hex");
  const authTag = Buffer.from(parts[2], "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
