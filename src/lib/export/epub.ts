import { Zip, ZipDeflate, ZipPassThrough, zipSync, strToU8, type Zippable } from "fflate";

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

function containerXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function packageXml(
  meta: EpubMetadata,
  chapterTitles: readonly string[],
  modified: string,
): string {
  const manifestItems = chapterTitles
    .map(
      (_, index) =>
        `    <item id="ch${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spineItems = chapterTitles
    .map((_, index) => `    <itemref idref="ch${index + 1}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
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
}

function navigationXml(meta: EpubMetadata, chapterTitles: readonly string[]): string {
  const navItems = chapterTitles
    .map((title, index) => `      <li><a href="chapter-${index + 1}.xhtml">${esc(title)}</a></li>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
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
}

function addTextFile(
  zip: Zip,
  filename: string,
  content: string,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 9,
) {
  const file = level === 0 ? new ZipPassThrough(filename) : new ZipDeflate(filename, { level });
  zip.add(file);
  file.push(strToU8(content), true);
}

export function createEpubStream(
  meta: EpubMetadata,
  chapterTitles: readonly string[],
  chapters: AsyncIterable<EpubChapter>,
): ReadableStream<Uint8Array> {
  let cancelled = false;
  let zip: Zip | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((error, chunk, final) => {
        if (cancelled) return;
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });

      void (async () => {
        try {
          const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
          addTextFile(zip!, "mimetype", "application/epub+zip", 0);
          addTextFile(zip!, "META-INF/container.xml", containerXml());
          addTextFile(zip!, "OEBPS/content.opf", packageXml(meta, chapterTitles, modified));
          addTextFile(zip!, "OEBPS/nav.xhtml", navigationXml(meta, chapterTitles));

          let index = 0;
          for await (const chapter of chapters) {
            if (cancelled) return;
            index += 1;
            addTextFile(
              zip!,
              `OEBPS/chapter-${index}.xhtml`,
              chapterXhtml(chapter.title, chapter.paragraphs),
            );
          }
          if (index !== chapterTitles.length) {
            throw new Error(`Expected ${chapterTitles.length} EPUB chapters, received ${index}`);
          }
          zip!.end();
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      })();
    },
    cancel() {
      cancelled = true;
      zip?.terminate();
    },
  });
}

// Minimal valid EPUB 3: mimetype (stored, first), container, opf, nav, chapters.
export function buildEpub(meta: EpubMetadata, chapters: EpubChapter[]): Uint8Array {
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const titles = chapters.map((chapter) => chapter.title);

  const files: Zippable = {
    // mimetype must be the first entry and uncompressed per the EPUB spec.
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [strToU8(containerXml()), { level: 9 }],
    "OEBPS/content.opf": [strToU8(packageXml(meta, titles, modified)), { level: 9 }],
    "OEBPS/nav.xhtml": [strToU8(navigationXml(meta, titles)), { level: 9 }],
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/chapter-${i + 1}.xhtml`] = [
      strToU8(chapterXhtml(c.title, c.paragraphs)),
      { level: 9 },
    ];
  });

  return zipSync(files);
}
