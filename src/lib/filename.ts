export function sanitizeFilename(name: string): string {
  const cleaned = name
    // Control characters must be stripped before constructing a download header.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "export";
}

export function contentDisposition(filename: string): string {
  const cleaned = sanitizeFilename(filename);
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_");
  const extended = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${extended}`;
}
