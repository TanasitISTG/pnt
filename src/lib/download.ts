function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string) {
  downloadBlob(filename, new Blob([text], { type: "text/plain;charset=utf-8" }));
}

export function downloadUrl(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.click();
}

export { sanitizeFilename } from "./filename";
