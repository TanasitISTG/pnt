import { zipSync, strToU8, type Zippable } from "fflate";

export interface EpubChapter {
  title: string;
  paragraphs: string[];
}

export interface EpubMetadata {
  title: string;
  author: string;
  language: string;
  identifier: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chapterXhtml(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `    <p>${esc(p)}</p>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${esc(title)}</title></head>
<body>
  <h1>${esc(title)}</h1>
${body}
</body>
</html>`;
}

// Minimal valid EPUB 3: mimetype (stored, first), container, opf, nav, chapters.
export function buildEpub(meta: EpubMetadata, chapters: EpubChapter[]): Uint8Array {
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const manifestItems = chapters
    .map(
      (_, i) =>
        `    <item id="ch${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spineItems = chapters.map((_, i) => `    <itemref idref="ch${i + 1}"/>`).join("\n");

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${esc(meta.identifier)}</dc:identifier>
    <dc:title>${esc(meta.title)}</dc:title>
    <dc:creator>${esc(meta.author)}</dc:creator>
    <dc:language>${esc(meta.language)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;

  const navItems = chapters
    .map((c, i) => `      <li><a href="chapter-${i + 1}.xhtml">${esc(c.title)}</a></li>`)
    .join("\n");

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${esc(meta.title)}</title></head>
<body>
  <nav epub:type="nav">
    <h1>${esc(meta.title)}</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;

  const files: Zippable = {
    // mimetype must be the first entry and uncompressed per the EPUB spec.
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [strToU8(container), { level: 9 }],
    "OEBPS/content.opf": [strToU8(opf), { level: 9 }],
    "OEBPS/nav.xhtml": [strToU8(nav), { level: 9 }],
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/chapter-${i + 1}.xhtml`] = [
      strToU8(chapterXhtml(c.title, c.paragraphs)),
      { level: 9 },
    ];
  });

  return zipSync(files);
}
