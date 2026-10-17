import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";

/**
 * The one definition of which bytes the app accepts from a browser image upload.
 *
 * A declared media type is a claim, not evidence: the first bytes of the buffer must agree with
 * it. The messages are codes like every other server message, and they deliberately do not name
 * the caller's subject: the label used to be an English noun ("Cover", "Profile") interpolated
 * into an English sentence, which cannot survive translation. The upload path that calls this is
 * what tells the reader which image was rejected.
 */
export function assertImageMagicBytes(buffer: Uint8Array, mime: string): void {
  // Defense-in-depth: callers may pass null mime if the schema was bypassed; reject explicitly.
  if (!mime) {
    throw new SafeServerError(encodeMessage("errors.imageMimeRequired"));
  }
  if (mime === "image/png") {
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47
    ) {
      throw new SafeServerError(encodeMessage("errors.imageTypeMismatch"));
    }
  } else if (mime === "image/jpeg") {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new SafeServerError(encodeMessage("errors.imageTypeMismatch"));
    }
  } else if (mime === "image/webp") {
    const isRiff =
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46;
    const isWebp =
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    if (!isRiff || !isWebp) {
      throw new SafeServerError(encodeMessage("errors.imageTypeMismatch"));
    }
  } else {
    throw new SafeServerError(encodeMessage("errors.imageUnsupportedType", { mime }));
  }
}
