import { customType } from "drizzle-orm/pg-core";

// Custom type for bytea mapping to Buffer in JS/TS
export const bytea = customType<{ data: Buffer; driverData: unknown }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: unknown) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === "string") {
      if (value.startsWith("\\x")) {
        return Buffer.from(value.slice(2), "hex");
      }
      return Buffer.from(value, "hex");
    }
    return Buffer.from(value as ArrayBuffer);
  },
});
