import { SafeServerError } from "@/lib/server-fn-error";

/**
 * The one definition of which bytes the app accepts from a browser image upload.
 *
 * A declared media type is a claim, not evidence: the first bytes of the buffer
 * must agree with it. `label` only names the subject in the error messages
 * ("Cover", "Profile"), so every upload path reports the same fixed strings.
 */
export function assertImageMagicBytes(buffer: Uint8Array, mime: string, label: string): void {
  const subject = label.toLowerCase();
  // Defense-in-depth: callers may pass null mime if schema bypassed; reject explicitly.
  if (!mime) {
    throw new SafeServerError(`${label} MIME type is required to validate ${subject} image`);
  }
  if (mime === "image/png") {
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47
    ) {
      throw new SafeServerError(`${label} image magic bytes do not match declared PNG MIME type`);
    }
  } else if (mime === "image/jpeg") {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new SafeServerError(`${label} image magic bytes do not match declared JPEG MIME type`);
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
      throw new SafeServerError(`${label} image magic bytes do not match declared WebP MIME type`);
    }
  } else {
    throw new SafeServerError(`Unsupported ${subject} MIME type: ${mime}`);
  }
}
