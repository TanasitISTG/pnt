// Chapter scraping: parse raw chapter pages from supported source sites.
// One entry per supported site — add a new site by adding one entry to SOURCES.

export interface ScrapedChapter {
  number: number;
  title: string;
  content: string;
  nextUrl: string | null;
}

interface Source {
  name: string;
  hosts: string[];
  parse(html: string, url: string): ScrapedChapter;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  mdash: "—",
};

// Single pass so decoded text is never re-scanned (&amp;lt; stays "&lt;").
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, "");

const BOILERPLATE_RE = /(请记住.{0,12}(域名|网址|本书|本站)|全本小说|手机阅读|quanben)/i;

// quanben.io: server-rendered, title in h1.headline ("第030章 <title>"),
// paragraphs as plain <p> between div#content and div.list_page (multi-page
// chapters are inlined, separated by <!--PAGE N--> comments).
function parseQuanben(html: string, url: string): ScrapedChapter {
  const numMatch = /\/(\d+(?:\.\d+)?)\.html$/.exec(new URL(url).pathname);
  if (!numMatch) throw new Error("Could not read chapter number from URL");

  const h1 = /<h1[^>]*class="headline"[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (!h1) throw new Error("Could not find chapter title on page");
  const title = decodeEntities(stripTags(h1[1]))
    .replace(/^第\s*\d+\s*章\s*/, "")
    .trim();
  if (!title) throw new Error("Parsed chapter title is empty");

  const start = html.indexOf('id="content"');
  const end = start === -1 ? -1 : html.indexOf('class="list_page"', start);
  if (start === -1 || end === -1) throw new Error("Could not find chapter content on page");

  const paragraphs = [...html.slice(start, end).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => decodeEntities(stripTags(m[1])).trim())
    .filter((p) => p.length > 0 && !BOILERPLATE_RE.test(p));
  if (paragraphs.length === 0) throw new Error("Chapter content is empty");

  const next = /href="([^"]+)"[^>]*>\s*下一页\s*</.exec(html);
  const nextUrl = next ? new URL(next[1], url).toString() : null;

  return {
    number: Number(numMatch[1]),
    title,
    content: paragraphs.join("\n\n"),
    nextUrl,
  };
}

export const SOURCES: Source[] = [
  { name: "quanben", hosts: ["www.quanben.io", "quanben.io"], parse: parseQuanben },
];

export function findSource(url: string): Source {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error("Only https URLs are supported");
    host = u.hostname;
  } catch (e) {
    if (e instanceof TypeError) throw new Error("Invalid URL", { cause: e });
    throw e;
  }
  const source = SOURCES.find((s) => s.hosts.includes(host));
  if (!source) {
    const supported = SOURCES.flatMap((s) => s.hosts).join(", ");
    throw new Error(`Unsupported site: ${host}. Supported: ${supported}`);
  }
  return source;
}

// ponytail: host whitelist + redirect:error makes this defense-in-depth; required when adding a SOURCE on a DNS-rebinddable host.
export function isPrivateIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "::" ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }
  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  const parts = normalized.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts;
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export async function assertPublicHost(url: string): Promise<void> {
  findSource(url); // checks https: and host whitelist
  const hostname = new URL(url).hostname;
  if (isPrivateIp(hostname)) {
    throw new Error(`Private or local host access blocked: ${hostname}`);
  }

  if (typeof window === "undefined") {
    try {
      const dns = await import("node:dns/promises");
      const res = await dns.lookup(hostname, { all: true });
      for (const entry of res) {
        if (isPrivateIp(entry.address)) {
          throw new Error(`Private IP address blocked: ${entry.address}`);
        }
      }
    } catch (err: any) {
      // Fail-closed for SSRF defense-in-depth: any DNS failure rejects the fetch
      // (mitigated by upstream host whitelist, but strict mode is safer).
      if (err.message?.includes("blocked")) throw err;
      throw new Error(`DNS resolution failed for ${hostname}: ${err.message ?? err}`, {
        cause: err,
      });
    }
  }
}

export function parseChapter(html: string, url: string): ScrapedChapter {
  return findSource(url).parse(html, url);
}

// Swap the chapter number in a source URL (used by range import).
export function chapterUrlFor(url: string, n: number): string {
  return url.replace(/(\d+(?:\.\d+)?)\.html([?#].*)?$/, `${n}.html`);
}
