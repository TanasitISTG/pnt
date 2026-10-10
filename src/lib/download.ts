function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
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
