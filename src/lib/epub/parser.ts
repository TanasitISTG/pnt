import * as fflate from "fflate";
import { SafeServerError } from "@/lib/server-fn-error";
import { decodeEntities, BOILERPLATE_RE } from "@/lib/scrape/parsers";

export interface ParsedEpubChapter {
  number: string | null;
  title: string;
  content: string;
}

export interface ParsedEpubMetadata {
  title: string | null;
  author: string | null;
  language: string | null;
  description: string | null;
}

export interface ParsedEpub {
  metadata: ParsedEpubMetadata;
  chapters: ParsedEpubChapter[];
}

const MAX_COMPRESSED_SIZE = 50 * 1024 * 1024; // 50 MiB
const MAX_UNCOMPRESSED_SIZE = 200 * 1024 * 1024; // 200 MiB
const MAX_CHAPTER_SIZE = 2 * 1024 * 1024; // 2 MiB
const MAX_ZIP_ENTRIES = 10000;
const MAX_CHAPTERS = 2000;
const UTF8_ENCODER = new TextEncoder();

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
  resolvedPath: string;
}

interface SpineItemRef {
  idref: string;
  linear: boolean;
}

function decodeEpubPath(path: string): string {
  try {
    return decodeURIComponent(path.replace(/\\/g, "/"));
  } catch {
    throw new SafeServerError("Invalid EPUB path encoding");
  }
}

// Check if a ZIP entry has traversal or absolute path issues
function isDangerousPath(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path.replace(/\\/g, "/"));
  } catch {
    return true;
  }
  if (!decoded || decoded.startsWith("/") || /^[a-zA-Z]:/.test(decoded)) {
    return true;
  }
  return decoded.split("/").includes("..");
}

// Normalize a relative package path against its base directory
function normalizePath(baseDir: string, relativePath: string): string {
  const decoded = decodeEpubPath(relativePath);
  if (decoded.startsWith("/") || /^[a-zA-Z]:/.test(decoded)) {
    throw new SafeServerError("EPUB contains an absolute package path");
  }

  const resolved = baseDir.split("/").filter((part) => part.length > 0 && part !== ".");
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) {
        throw new SafeServerError("EPUB package path escapes its root");
      }
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

// Strip HTML tags from a string
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function cleanText(text: string): string {
  return stripTags(decodeEntities(text)).replace(/\s+/g, " ").trim();
}

// Check if a document is front-matter or non-chapter content
function isFrontMatter(
  item: ManifestItem,
  tocTitle: string | null,
  docHeading: string | null,
): boolean {
  const props = item.properties.toLowerCase();
  if (/(^|\s)(?:cover-image|nav)(?:\s|$)/.test(props)) {
    return true;
  }

  const basename = item.resolvedPath.split("/").pop()?.toLowerCase() ?? "";
  const nameWithoutExt = basename.replace(/\.[^.]+$/, "");

  // Match filename patterns like Cover.xhtml, Information.xhtml, 0000_Information.xhtml, nav.xhtml, toc.xhtml
  if (
    /^(?:\d+_)?(?:cover|information|about|nav|toc|copyright|license|titlepage|metadata|preface|intro|introduction)$/i.test(
      nameWithoutExt,
    )
  ) {
    return true;
  }

  const checkTitles = [tocTitle, docHeading].filter(Boolean) as string[];
  for (const title of checkTitles) {
    const t = title.trim().toLowerCase();
    if (
      /^(?:cover|information|about|table of contents|toc|contents|title page|copyright|license|metadata|introduction|preface)$/i.test(
        t,
      )
    ) {
      return true;
    }
  }

  return false;
}

function isNavigationDocument(xhtml: string): boolean {
  return (
    /<nav\b/i.test(xhtml) ||
    /\b(?:epub:)?type\s*=\s*["'][^"']*\b(?:toc|landmarks|page-list|cover)\b/i.test(xhtml) ||
    /\brole\s*=\s*["']doc-(?:toc|landmarks|page-list|cover)["']/i.test(xhtml)
  );
}

// Parse attributes from a tag string
function parseAttributes(tagStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tagStr)) !== null) {
    const name = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = val;
  }
  return attrs;
}

// Extract chapter number and clean title
function parseChapterNumberAndTitle(rawTitle: string): {
  number: string | null;
  title: string;
} {
  const trimmed = rawTitle.trim();
  if (!trimmed) {
    return { number: null, title: "" };
  }

  // Chinese chapter pattern: 第 12 章, 12章, 第12話, 第12.5节, 第12回, etc.
  const cnMatch = trimmed.match(/^(?:第\s*)?(\d+(?:\.\d+)?)\s*[章話话节節回卷]\s*[:：、\s-]*(.*)$/);
  if (cnMatch) {
    const num = cnMatch[1];
    const rest = cnMatch[2].trim();
    return {
      number: num,
      title: rest || "Chapter",
    };
  }

  // Western chapter pattern: Chapter 12, Ch. 12, Episode 12, etc.
  const enMatch = trimmed.match(
    /^(?:Chapter|Ch\.?|Episode|Ep\.?)\s*(\d+(?:\.\d+)?)\s*[:：、\s-]*(.*)$/i,
  );
  if (enMatch) {
    const num = enMatch[1];
    const rest = enMatch[2].trim();
    return {
      number: num,
      title: rest || "Chapter",
    };
  }

  // Leading numeric pattern: 12. Title or 12: Title or 12 Title
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*[:：、\s-]\s*(.+)$/);
  if (numMatch) {
    const num = numMatch[1];
    const rest = numMatch[2].trim();
    return {
      number: num,
      title: rest || "Chapter",
    };
  }

  return { number: null, title: trimmed };
}

function normalizeFullWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

// Extract multipart info from title e.g. "釣魚2 (1/2)" -> { baseTitle: "釣魚2", part: 1, total: 2 }
function parseMultipart(title: string): {
  baseTitle: string;
  part: number;
  total: number;
} | null {
  const match = title.match(/\s*[(（]([0-9０-９]+)[/／]([0-9０-９]+)[)）]\s*$/);
  if (!match) {
    return null;
  }
  const part = parseInt(normalizeFullWidthDigits(match[1]), 10);
  const total = parseInt(normalizeFullWidthDigits(match[2]), 10);
  if (Number.isNaN(part) || Number.isNaN(total) || total < 1 || part < 1 || part > total) {
    return null;
  }
  const baseTitle = title.slice(0, match.index).trim();
  return { baseTitle, part, total };
}

const EPUB_BANNER_RE =
  /(?:溫馨提示|温馨提示|應廣大讀者的要求|应广大读者的要求|點擊查看|点击查看|VIP(?:\s*$|章节|章節)|本章未完|手機用戶請瀏覽|手机用户请浏览)/i;

// Parse a single XHTML document into raw text content and heading
function parseXhtmlDocument(
  xhtml: string,
  tocTitle: string | null,
): {
  heading: string | null;
  content: string;
} | null {
  // Remove non-content elements
  let cleaned = xhtml
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<ins[\s\S]*?<\/ins>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<img[^>]*\/?>/gi, "");

  // Extract heading from h1, h2, title, or tocTitle
  let heading: string | null = null;
  const h1Match = cleaned.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    heading = cleanText(h1Match[1]);
  }
  if (!heading) {
    const h2Match = cleaned.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) {
      heading = cleanText(h2Match[1]);
    }
  }
  if (!heading) {
    const titleMatch = xhtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      heading = cleanText(titleMatch[1]);
    }
  }
  if (!heading && tocTitle) {
    heading = cleanText(tocTitle);
  }

  // Extract paragraphs
  const paragraphs: string[] = [];
  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(cleaned)) !== null) {
    const rawP = pMatch[1];
    // Replace <br> with newline within paragraph
    const withNewlines = rawP.replace(/<br\s*\/?>/gi, "\n");
    const text = decodeEntities(stripTags(withNewlines)).trim();
    if (!text) continue;

    // Filter out banners / boilerplate ads
    if (EPUB_BANNER_RE.test(text) || BOILERPLATE_RE.test(text)) {
      continue;
    }
    paragraphs.push(text);
  }

  // Fallback if no <p> tags produced content: look in <div> or body
  if (paragraphs.length === 0) {
    const bodyMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : cleaned;
    const divRegex = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;
    let divMatch: RegExpExecArray | null;
    while ((divMatch = divRegex.exec(bodyContent)) !== null) {
      const rawDiv = divMatch[1];
      const withNewlines = rawDiv.replace(/<br\s*\/?>/gi, "\n");
      const text = decodeEntities(stripTags(withNewlines)).trim();
      if (!text || EPUB_BANNER_RE.test(text) || BOILERPLATE_RE.test(text)) continue;
      paragraphs.push(text);
    }

    if (paragraphs.length === 0) {
      // Split on br or newlines
      const lines = decodeEntities(stripTags(bodyContent.replace(/<br\s*\/?>/gi, "\n")))
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !EPUB_BANNER_RE.test(l) && !BOILERPLATE_RE.test(l));
      paragraphs.push(...lines);
    }
  }

  if (paragraphs.length === 0) {
    return null;
  }

  // Remove exact leading duplication of the heading from the first paragraph
  if (heading && paragraphs.length > 0) {
    // Candidate heading prefixes to strip:
    // 1. Raw heading: "第70章 謝以沐受傷 (1/2)"
    // 2. Heading without multipart: "第70章 謝以沐受傷"
    // 3. Raw title without multipart
    const headingWithoutMp = heading.replace(/\s*[(（]\d+\/\d+[)）]\s*$/, "").trim();
    const candidates = [heading, headingWithoutMp].filter(Boolean);

    for (const cand of candidates) {
      if (paragraphs.length === 0) break;
      const currentFirstP = paragraphs[0];
      const cClean = cand.replace(/\s+/g, "");
      const pClean = currentFirstP.replace(/\s+/g, "");

      if (currentFirstP === cand) {
        paragraphs.shift();
        break;
      } else if (currentFirstP.startsWith(cand)) {
        paragraphs[0] = currentFirstP.slice(cand.length).trim();
        if (!paragraphs[0]) paragraphs.shift();
        break;
      } else if (pClean.startsWith(cClean)) {
        let matchedLen = 0;
        let cleanIdx = 0;
        for (let i = 0; i < currentFirstP.length; i++) {
          if (/\s/.test(currentFirstP[i])) continue;
          if (cleanIdx < cClean.length && currentFirstP[i] === cClean[cleanIdx]) {
            cleanIdx++;
            if (cleanIdx === cClean.length) {
              matchedLen = i + 1;
              break;
            }
          } else {
            break;
          }
        }
        if (matchedLen > 0) {
          paragraphs[0] = currentFirstP.slice(matchedLen).trim();
          if (!paragraphs[0]) paragraphs.shift();
          break;
        }
      }
    }
  }

  const content = paragraphs.join("\n\n");
  if (UTF8_ENCODER.encode(content).byteLength > MAX_CHAPTER_SIZE) {
    throw new SafeServerError(`Chapter content exceeds maximum limit of 2 MiB`);
  }

  return { heading, content };
}

export function parseEpubArchive(bytes: Uint8Array): ParsedEpub {
  if (!bytes || bytes.length === 0) {
    throw new SafeServerError("EPUB file is empty");
  }
  if (bytes.length > MAX_COMPRESSED_SIZE) {
    throw new SafeServerError("EPUB file exceeds maximum allowed size of 50 MiB");
  }

  let totalUncompressedSize = 0;
  let entryCount = 0;

  // Unzip archive with fflate filter
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = fflate.unzipSync(bytes, {
      filter(file) {
        entryCount++;
        if (entryCount > MAX_ZIP_ENTRIES) {
          throw new SafeServerError("EPUB contains too many entries (exceeds 10,000)");
        }
        if (isDangerousPath(file.name)) {
          throw new SafeServerError(`EPUB contains invalid file path: ${file.name}`);
        }

        const nameLower = file.name.toLowerCase();
        // Skip images, fonts, audio, video, css
        if (
          /\.(?:jpe?g|png|gif|webp|bmp|ico|svg|css|ttf|otf|woff2?|eot|mp3|m4a|wav|mp4|webm|ogv)$/i.test(
            nameLower,
          )
        ) {
          return false;
        }

        totalUncompressedSize += file.originalSize || 0;
        if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
          throw new SafeServerError("EPUB uncompressed content exceeds 200 MiB limit");
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof SafeServerError) throw err;
    throw new SafeServerError("Invalid or corrupted EPUB file");
  }

  // Find container.xml
  const containerKey = Object.keys(unzipped).find(
    (k) => k.toLowerCase() === "meta-inf/container.xml",
  );
  if (!containerKey) {
    throw new SafeServerError("Invalid EPUB: missing META-INF/container.xml");
  }

  const containerXml = fflate.strFromU8(unzipped[containerKey]);
  const rootfileMatch = containerXml.match(/<rootfile\b[^>]*\bfull-path=["']([^"']+)["'][^>]*>/i);
  if (!rootfileMatch) {
    throw new SafeServerError("Invalid EPUB: missing rootfile in container.xml");
  }

  const opfPath = normalizePath("", rootfileMatch[1]);
  const opfKey = Object.keys(unzipped).find((k) => k.toLowerCase() === opfPath.toLowerCase());
  if (!opfKey) {
    throw new SafeServerError(`Invalid EPUB: OPF package file not found at ${opfPath}`);
  }

  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const opfXml = fflate.strFromU8(unzipped[opfKey]);

  // Parse required package metadata
  const metadataMatch = opfXml.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i);
  if (!metadataMatch) {
    throw new SafeServerError("Invalid EPUB: missing package metadata");
  }
  const metadataXml = metadataMatch[1];
  const metadata: ParsedEpubMetadata = {
    title: null,
    author: null,
    language: null,
    description: null,
  };

  const titleMatch = metadataXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i);
  if (titleMatch) metadata.title = cleanText(titleMatch[1]) || null;

  const creatorMatch = metadataXml.match(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i);
  if (creatorMatch) metadata.author = cleanText(creatorMatch[1]) || null;

  const langMatch = metadataXml.match(/<dc:language\b[^>]*>([\s\S]*?)<\/dc:language>/i);
  if (langMatch) metadata.language = cleanText(langMatch[1]) || null;

  const descMatch = metadataXml.match(/<dc:description\b[^>]*>([\s\S]*?)<\/dc:description>/i);
  if (descMatch) metadata.description = cleanText(descMatch[1]) || null;

  // Parse Manifest
  const manifestMatch = opfXml.match(/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i);
  if (!manifestMatch) {
    throw new SafeServerError("Invalid EPUB: missing manifest in OPF");
  }

  const manifestMap = new Map<string, ManifestItem>();
  const itemRegex = /<item\b([^>]*)\/?>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRegex.exec(manifestMatch[1])) !== null) {
    const attrs = parseAttributes(itemMatch[1]);
    const id = attrs["id"];
    const href = attrs["href"];
    if (id && href) {
      const resolvedPath = normalizePath(opfDir, href);
      manifestMap.set(id, {
        id,
        href,
        mediaType: attrs["media-type"] ?? "",
        properties: attrs["properties"] ?? "",
        resolvedPath,
      });
    }
  }

  // Parse Spine
  const spineMatch = opfXml.match(/<spine\b([^>]*)>([\s\S]*?)<\/spine>/i);
  if (!spineMatch) {
    throw new SafeServerError("Invalid EPUB: missing spine in OPF");
  }

  const spineAttrs = parseAttributes(spineMatch[1]);
  const tocId = spineAttrs["toc"] ?? "ncx";

  const spineRefs: SpineItemRef[] = [];
  const itemrefRegex = /<itemref\b([^>]*)\/?>/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = itemrefRegex.exec(spineMatch[2])) !== null) {
    const attrs = parseAttributes(refMatch[1]);
    const idref = attrs["idref"];
    if (idref) {
      const linear = attrs["linear"] !== "no";
      spineRefs.push({ idref, linear });
    }
  }

  // Parse TOC (EPUB 3 nav document or EPUB 2 toc.ncx)
  const tocMap = new Map<string, string>(); // resolvedPath -> title

  // 1. Check EPUB 3 nav
  for (const item of manifestMap.values()) {
    if (item.properties.toLowerCase().includes("nav")) {
      const navKey = Object.keys(unzipped).find(
        (k) => k.toLowerCase() === item.resolvedPath.toLowerCase(),
      );
      if (navKey) {
        const navXml = fflate.strFromU8(unzipped[navKey]);
        const navDir = item.resolvedPath.includes("/")
          ? item.resolvedPath.slice(0, item.resolvedPath.lastIndexOf("/"))
          : "";
        const aRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let aMatch: RegExpExecArray | null;
        while ((aMatch = aRegex.exec(navXml)) !== null) {
          const aAttrs = parseAttributes(aMatch[1]);
          const href = aAttrs["href"];
          if (href) {
            const rawHref = href.split("#")[0];
            const resolved = normalizePath(navDir, rawHref);
            const title = cleanText(aMatch[2]);
            if (title && !tocMap.has(resolved)) {
              tocMap.set(resolved, title);
            }
          }
        }
      }
    }
  }

  // 2. Check EPUB 2 NCX as fallback
  const ncxItem =
    manifestMap.get(tocId) ??
    Array.from(manifestMap.values()).find(
      (item) =>
        item.mediaType.toLowerCase() === "application/x-dtbncx+xml" ||
        item.resolvedPath.toLowerCase().endsWith(".ncx"),
    );

  if (ncxItem) {
    const ncxKey = Object.keys(unzipped).find(
      (k) => k.toLowerCase() === ncxItem.resolvedPath.toLowerCase(),
    );
    if (ncxKey) {
      const ncxXml = fflate.strFromU8(unzipped[ncxKey]);
      const ncxDir = ncxItem.resolvedPath.includes("/")
        ? ncxItem.resolvedPath.slice(0, ncxItem.resolvedPath.lastIndexOf("/"))
        : "";
      const navPointRegex =
        /<navPoint\b[^>]*>[\s\S]*?<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>[\s\S]*?<content\b([^>]*)\/?>/gi;
      let npMatch: RegExpExecArray | null;
      while ((npMatch = navPointRegex.exec(ncxXml)) !== null) {
        const text = cleanText(npMatch[1]);
        const contentAttrs = parseAttributes(npMatch[2]);
        const src = contentAttrs["src"];
        if (src && text) {
          const rawSrc = src.split("#")[0];
          const resolved = normalizePath(ncxDir, rawSrc);
          if (!tocMap.has(resolved)) {
            tocMap.set(resolved, text);
          }
        }
      }
    }
  }

  // Extract chapters from ordered spine
  const candidateChapters: Array<{
    number: string | null;
    title: string;
    content: string;
    rawTitle: string;
    multipart: { baseTitle: string; part: number; total: number } | null;
  }> = [];

  for (const spineRef of spineRefs) {
    if (!spineRef.linear) continue;
    const item = manifestMap.get(spineRef.idref);
    if (!item) continue;

    const fileKey = Object.keys(unzipped).find(
      (k) => k.toLowerCase() === item.resolvedPath.toLowerCase(),
    );
    if (!fileKey) continue;

    const tocTitle = tocMap.get(item.resolvedPath) ?? null;
    const xhtmlContent = fflate.strFromU8(unzipped[fileKey]);

    // Quick front-matter check based on manifest/path/TOC/navigation role
    if (isFrontMatter(item, tocTitle, null) || isNavigationDocument(xhtmlContent)) {
      continue;
    }

    const doc = parseXhtmlDocument(xhtmlContent, tocTitle);
    if (!doc) continue;

    // Check front-matter again with extracted heading
    if (isFrontMatter(item, tocTitle, doc.heading)) {
      continue;
    }

    const rawTitle = doc.heading || tocTitle || "Chapter";
    const { number, title } = parseChapterNumberAndTitle(rawTitle);
    const multipart = parseMultipart(title);

    if (candidateChapters.length >= MAX_CHAPTERS) {
      throw new SafeServerError(`EPUB contains too many chapters (exceeds ${MAX_CHAPTERS})`);
    }
    candidateChapters.push({
      number,
      title,
      content: doc.content,
      rawTitle,
      multipart,
    });
  }

  // Merge only consecutive multipart chapters with sequential parts.
  type MergedChapter = ParsedEpubChapter & {
    multipart: { baseTitle: string; part: number; total: number } | null;
    multipartStartedAtOne: boolean;
  };
  const mergedChapters: MergedChapter[] = [];

  for (const candidate of candidateChapters) {
    const last = mergedChapters[mergedChapters.length - 1];
    const mp = candidate.multipart;

    if (
      last &&
      last.multipartStartedAtOne &&
      last.multipart &&
      mp &&
      last.number === candidate.number &&
      last.title === mp.baseTitle &&
      last.multipart.baseTitle === mp.baseTitle &&
      last.multipart.total === mp.total &&
      last.multipart.part + 1 === mp.part
    ) {
      last.content += `\n\n${candidate.content}`;
      last.multipart = mp;
      if (UTF8_ENCODER.encode(last.content).byteLength > MAX_CHAPTER_SIZE) {
        throw new SafeServerError(`Merged chapter content exceeds maximum limit of 2 MiB`);
      }
    } else {
      const finalTitle = mp ? mp.baseTitle : candidate.title;
      mergedChapters.push({
        number: candidate.number,
        title: finalTitle,
        content: candidate.content,
        multipart: mp,
        multipartStartedAtOne: mp?.part === 1,
      });
    }
  }

  const parsedChapters: ParsedEpubChapter[] = mergedChapters.map(
    ({ multipart: _multipart, multipartStartedAtOne: _startedAtOne, ...chapter }) => chapter,
  );

  if (parsedChapters.length === 0) {
    throw new SafeServerError("EPUB contains no usable chapters");
  }

  if (parsedChapters.length > MAX_CHAPTERS) {
    throw new SafeServerError(`EPUB contains too many chapters (exceeds ${MAX_CHAPTERS})`);
  }

  return {
    metadata,
    chapters: parsedChapters,
  };
}
