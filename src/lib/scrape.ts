// Chapter scraping: parse raw chapter pages from supported source sites.
// One entry per supported site — add a new site by adding one entry to SOURCES.

import { SafeServerError } from "@/lib/server-fn-error";
import { log } from "@/lib/log";

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
  emsp: " ",
  ensp: " ",
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

export const BOILERPLATE_RE =
  /(請記住.{0,12}(域名|網址|本書|本站)|請記住.{0,12}(域名|網址|本書|本站)|台灣|twkan\.com|quanben|\u0489|PROMOTED CONTENT|mgid|resultados para|iphone 17|Ordenar por|biquge)/i;

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

  const next = /href="([^"]+)"[^>]*>\s*下一頁\s*</.exec(html);
  const nextUrl = next ? new URL(next[1], url).toString() : null;

  return {
    number: Number(numMatch[1]),
    title,
    content: paragraphs.join("\n\n"),
    nextUrl,
  };
}

export function isTwkanTocUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "twkan.com" || u.hostname === "www.twkan.com") &&
      u.pathname.startsWith("/book/")
    );
  } catch {
    return false;
  }
}

export function twkanTocUrlFromReader(readerUrl: string): string {
  const match = /\/txt\/(\d+)\//.exec(readerUrl);
  if (!match) {
    if (isTwkanTocUrl(readerUrl)) return readerUrl;
    throw new Error("Invalid twkan reader URL");
  }
  return `https://twkan.com/book/${match[1]}.html`;
}

export function parseTwkanToc(html: string, tocUrl: string): Record<number, string> {
  const chapterUrls: Record<number, string> = {};
  const linkRegex = /<a[^>]*href="([^"]*\/txt\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let fallbackIndex = 1;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = decodeEntities(stripTags(match[2])).trim();
    const numMatch = /第\s*(\d+)\s*章/.exec(text);
    const num = numMatch ? Number(numMatch[1]) : fallbackIndex;
    chapterUrls[num] = new URL(href, tocUrl).toString();
    fallbackIndex++;
  }

  if (Object.keys(chapterUrls).length === 0) {
    if (
      html.includes("cf-browser-verification") ||
      html.includes("challenge-platform") ||
      html.includes("Just a moment...") ||
      html.includes("Attention Required!") ||
      html.includes("cf-turnstile") ||
      html.includes("chk_jsch") ||
      html.includes("challenge-form") ||
      html.includes("Verify you are human") ||
      html.includes("Checking if the site connection is secure") ||
      html.includes("DDoS protection by Cloudflare") ||
      html.includes("_cf_chl") ||
      (html.includes("Cloudflare") && /challenge|captcha|verify|mitigated|security/i.test(html))
    ) {
      throw new SafeServerError(
        "Cloudflare challenge blocked access. Try setting SCRAPER_PREMIUM_PROXY=true in .env.local",
      );
    }
    throw new SafeServerError("Could not parse chapters from twkan TOC page");
  }

  return chapterUrls;
}

export function parseTwkan(html: string, url: string): ScrapedChapter {
  if (
    html.includes("cf-browser-verification") ||
    html.includes("challenge-platform") ||
    html.includes("Just a moment...") ||
    html.includes("Attention Required!") ||
    html.includes("cf-turnstile") ||
    html.includes("chk_jsch") ||
    html.includes("challenge-form") ||
    html.includes("Verify you are human") ||
    html.includes("Checking if the site connection is secure") ||
    html.includes("DDoS protection by Cloudflare") ||
    html.includes("_cf_chl") ||
    (html.includes("Cloudflare") && /challenge|captcha|verify|mitigated|security/i.test(html))
  ) {
    throw new SafeServerError(
      "Cloudflare challenge blocked access. Try setting SCRAPER_PREMIUM_PROXY=true in .env.local",
    );
  }

  const hasTwkanContent =
    html.includes('id="txtcontent0"') ||
    html.includes('id="txtcontent"') ||
    html.includes('id="content"');

  const pageTitleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const pageTitle = pageTitleMatch ? decodeEntities(stripTags(pageTitleMatch[1])) : "";

  if (
    !hasTwkanContent &&
    (pageTitle.includes("Amazon") ||
      html.includes("Añadir a la cesta") ||
      html.includes("Ficha de producto") ||
      /amazon\.[a-z]{2,3}/i.test(pageTitle))
  ) {
    throw new SafeServerError(
      "twkan bot detection redirected to an ad page. Set SCRAPER_PREMIUM_PROXY=true in .env.local to use residential proxies.",
    );
  }

  let h1Text = "";

  // 1. Check all h1 tags on page for a valid novel chapter title
  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  for (const m of h1Matches) {
    const candidate = decodeEntities(stripTags(m[1])).trim();
    if (candidate && !BOILERPLATE_RE.test(candidate)) {
      if (/第\s*\d+|章|話|回/.test(candidate)) {
        h1Text = candidate;
        break;
      }
      if (!h1Text) h1Text = candidate;
    }
  }

  // 2. Target h1 inside containers if h1Text not set
  if (!h1Text) {
    const containerMatch =
      /<div[^>]*class="[^"]*(?:txtnav|mybox|read_main|title|heading)[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(
        html,
      );
    if (containerMatch) {
      h1Text = decodeEntities(stripTags(containerMatch[1])).trim();
    }
  }

  // 3. Fallback to <title> tag
  if (!h1Text) {
    if (pageTitle) {
      h1Text = pageTitle.split(/[-_|–—]/)[0].trim();
    }
  }

  // 4. Fallback to breadcrumb navigation
  if (!h1Text) {
    const navMatch = /<div[^>]*class="[^"]*(?:path|breadcrumb)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    );
    if (navMatch) {
      const navText = decodeEntities(stripTags(navMatch[1])).trim();
      const parts = navText.split(/[>»]/);
      h1Text = parts[parts.length - 1].trim();
    }
  }

  if (!h1Text) {
    h1Text = "Chapter";
  }

  let numMatch = /第\s*(\d+(?:\.\d+)?)\s*[章話回節]/.exec(h1Text);

  if (!numMatch && pageTitle) {
    numMatch = /第\s*(\d+(?:\.\d+)?)\s*[章話回節]/.exec(pageTitle);
  }

  if (!numMatch) {
    numMatch = /(?:Chapter|Ch|ch|^)\s*(\d+(?:\.\d+)?)/i.exec(h1Text);
  }

  if (!numMatch) {
    numMatch = /(\d+(?:\.\d+)?)/.exec(h1Text);
  }

  const number = numMatch ? Number(numMatch[1]) : 1;

  let title = h1Text
    .replace(/^第\s*\d+(?:\.\d+)?\s*[章話回節]\s*[:：\s]*/, "")
    .replace(/^(?:Chapter|Ch|ch|\d+)\s*[:：.\s]*/i, "")
    .trim();

  if (!title) {
    title = h1Text;
  }

  // Multi-stage content container search
  let start = html.indexOf('id="txtcontent0"');
  if (start === -1) start = html.indexOf('id="txtcontent"');
  if (start === -1) start = html.search(/id="txtcontent\d*"/i);
  if (start === -1) start = html.search(/class="[^"]*txtcontent[^"]*"/i);
  if (start === -1) start = html.indexOf('id="content"');
  if (start === -1) start = html.search(/class="[^"]*(?:read_content|readcontent|content)[^"]*"/i);
  if (start === -1)
    start = html.search(/class="[^"]*(?:mybox|txtnav|read_main|box|article|chapter)[^"]*"/i);

  if (start === -1) {
    if (html.length < 1000 || !/[\u4e00-\u9fa5]/.test(html)) {
      throw new SafeServerError(
        "Source page returned invalid HTML or was blocked. Try setting SCRAPER_PREMIUM_PROXY=true in .env.local",
      );
    }
    throw new SafeServerError("Could not locate chapter text container on page");
  }

  const contentStart = html.indexOf(">", start);
  if (contentStart === -1) {
    throw new SafeServerError("Could not locate chapter text container on page");
  }

  let contentHtml = html.slice(contentStart + 1);

  // Stop at navigation/footer section
  const endPage = contentHtml.search(
    /class="page1"|<div[^>]*class="page1"|id="page1"|下一章|上一章|<div[^>]*class="footer"/i,
  );
  if (endPage !== -1) {
    contentHtml = contentHtml.slice(0, endPage);
  }

  contentHtml = contentHtml.replace(
    /<div[^>]*class="[^"]*txt(?:ad|center|info|mgid|adnet)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    "",
  );
  contentHtml = contentHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  contentHtml = contentHtml.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "");
  contentHtml = contentHtml.replace(/<ins[^>]*>[\s\S]*?<\/ins>/gi, "");

  const rawLines = contentHtml.split(/<br\s*\/?>/i);
  const paragraphs = rawLines
    .map((line) =>
      decodeEntities(stripTags(line))
        .replace(/^[\u3000\u2003\s&nbsp;&emsp;]+|[\u3000\u2003\s&nbsp;&emsp;]+$/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && line.length < 5000 && !BOILERPLATE_RE.test(line));

  if (paragraphs.length === 0) {
    throw new SafeServerError("Chapter text extracted is empty");
  }

  const nextMatch = /href="([^"]+)"[^>]*>\s*下一章\s*</i.exec(html);
  const nextUrl = nextMatch ? new URL(nextMatch[1], url).toString() : null;

  return {
    number,
    title,
    content: paragraphs.join("\n\n"),
    nextUrl,
  };
}

export function isBiqugeTocUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "biquge.tw" || u.hostname === "www.biquge.tw") &&
      Boolean(u.pathname.match(/\/book\/\d+(\.html|\/)?$/))
    );
  } catch {
    return false;
  }
}

export function biqugeTocUrlFromReader(readerUrl: string): string {
  const match = /\/book\/(\d+)/.exec(readerUrl);
  if (!match) {
    if (isBiqugeTocUrl(readerUrl)) return readerUrl;
    throw new Error("Invalid biquge reader URL");
  }
  return `https://www.biquge.tw/book/${match[1]}/`;
}

export function parseBiqugeToc(html: string, tocUrl: string): Record<number, string> {
  const chapterUrls: Record<number, string> = {};
  const seenHrefs = new Set<string>();

  // Find start of main chapter list section (<dt>...正文...</dt> or <dt>...章节列表...</dt>)
  let searchHtml = html;
  const zhengwenMatch =
    /<dt[^>]*>[^<]*(?:正文|章節列表|章节列表|最新章節|最新章节)[\s\S]*?<\/dt>/gi;
  let lastDtIndex = -1;
  let m: RegExpExecArray | null;
  while ((m = zhengwenMatch.exec(html)) !== null) {
    if (/正文|章節列表|章节列表/.test(m[0])) {
      lastDtIndex = m.index + m[0].length;
      break;
    }
    lastDtIndex = m.index + m[0].length;
  }

  if (lastDtIndex !== -1) {
    searchHtml = html.slice(lastDtIndex);
  }

  // Strictly match reader URLs of form /book/NOVEL_ID/CHAPTER_ID.html
  const linkRegex = /<a[^>]*href="([^"]*\/book\/\d+\/\d+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let sequentialIndex = 1;

  while ((match = linkRegex.exec(searchHtml)) !== null) {
    const fullUrl = new URL(match[1], tocUrl).toString();
    if (seenHrefs.has(fullUrl)) continue;
    seenHrefs.add(fullUrl);

    const text = decodeEntities(stripTags(match[2])).trim();

    let num: number | null = null;
    const numMatch = /第\s*(\d+(?:\.\d+)?)\s*[章話回節]/.exec(text);
    if (numMatch) {
      num = Number(numMatch[1]);
    } else {
      const leadingMatch = /^(\d+)\s*[.\s:：]/.exec(text);
      if (leadingMatch) {
        num = Number(leadingMatch[1]);
      }
    }

    // 1. Store under 1-based sequential position index (handles multi-volume re-numbering seamlessly)
    chapterUrls[sequentialIndex] = fullUrl;

    // 2. Store under parsed chapter number if not already present
    if (num !== null && !chapterUrls[num]) {
      chapterUrls[num] = fullUrl;
    }

    sequentialIndex++;
  }

  // Fallback to full page if main section slice found nothing
  if (Object.keys(chapterUrls).length === 0 && searchHtml !== html) {
    const fullRegex = /<a[^>]*href="([^"]*\/book\/\d+\/\d+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
    let idx = 1;
    while ((match = fullRegex.exec(html)) !== null) {
      const fullUrl = new URL(match[1], tocUrl).toString();
      if (seenHrefs.has(fullUrl)) continue;
      seenHrefs.add(fullUrl);

      const text = decodeEntities(stripTags(match[2])).trim();
      let num: number | null = null;
      const numMatch = /第\s*(\d+(?:\.\d+)?)\s*[章話回節]/.exec(text);
      if (numMatch) num = Number(numMatch[1]);

      chapterUrls[idx] = fullUrl;
      if (num !== null && !chapterUrls[num]) {
        chapterUrls[num] = fullUrl;
      }
      idx++;
    }
  }

  log("info", "parseBiqugeToc completed", {
    tocUrl,
    count: Object.keys(chapterUrls).length,
    parsedNumbers: Object.keys(chapterUrls).slice(0, 15),
    sample4: chapterUrls[4],
    sample325: chapterUrls[325],
  });

  if (Object.keys(chapterUrls).length === 0) {
    if (
      html.includes("cf-browser-verification") ||
      html.includes("challenge-platform") ||
      html.includes("Just a moment...") ||
      html.includes("Attention Required!") ||
      html.includes("cf-turnstile") ||
      html.includes("chk_jsch") ||
      html.includes("challenge-form") ||
      html.includes("Verify you are human") ||
      html.includes("Checking if the site connection is secure") ||
      html.includes("DDoS protection by Cloudflare") ||
      html.includes("_cf_chl") ||
      (html.includes("Cloudflare") && /challenge|captcha|verify|mitigated|security/i.test(html))
    ) {
      throw new SafeServerError(
        "Cloudflare challenge blocked access. Try setting SCRAPER_PREMIUM_PROXY=true in .env.local",
      );
    }
    throw new SafeServerError("Could not parse chapters from biquge TOC page");
  }

  return chapterUrls;
}

export function parseBiquge(html: string, url: string): ScrapedChapter {
  const pageTitleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const pageTitle = pageTitleMatch ? decodeEntities(stripTags(pageTitleMatch[1])) : "";

  const hasBiqugeContent =
    html.includes('id="chaptercontent"') ||
    html.includes('class="read-content"') ||
    html.includes('id="content"');

  log("info", "parseBiquge inspecting HTML", {
    url,
    length: html.length,
    pageTitle,
    hasBiqugeContent,
    sample: html.slice(0, 300).replace(/\s+/g, " "),
  });

  if (
    html.includes("cf-browser-verification") ||
    html.includes("challenge-platform") ||
    html.includes("Just a moment...") ||
    html.includes("Attention Required!") ||
    html.includes("cf-turnstile") ||
    html.includes("chk_jsch") ||
    html.includes("challenge-form") ||
    html.includes("Verify you are human") ||
    html.includes("Checking if the site connection is secure") ||
    html.includes("DDoS protection by Cloudflare") ||
    html.includes("_cf_chl") ||
    (html.includes("Cloudflare") && /challenge|captcha|verify|mitigated|security/i.test(html))
  ) {
    throw new SafeServerError(
      "Cloudflare challenge blocked access. Try setting SCRAPER_PREMIUM_PROXY=true in .env.local",
    );
  }

  // Only throw redirect error if the page lacks chapter content AND page title indicates an Amazon search result page
  if (
    !hasBiqugeContent &&
    (pageTitle.includes("Amazon") ||
      html.includes("Añadir a la cesta") ||
      html.includes("Ficha de producto") ||
      /amazon\.[a-z]{2,3}/i.test(pageTitle))
  ) {
    log("warn", "biquge bot detection redirect detected", {
      url,
      pageTitle,
      sample: html.slice(0, 300),
    });
    throw new SafeServerError(
      "biquge bot detection redirected to an ad page. Set SCRAPER_PREMIUM_PROXY=true in .env.local to use residential proxies.",
    );
  }

  let h1Text = "";

  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1Match) {
    h1Text = decodeEntities(stripTags(h1Match[1])).trim();
  }

  if (!h1Text) {
    if (pageTitle) {
      h1Text = pageTitle.split(/[-_|]/)[0].trim();
    }
  }

  if (!h1Text) throw new SafeServerError("Could not find chapter title on page");

  // Strip pagination suffix like （1 / 1） or (1/1)
  h1Text = h1Text.replace(/[（(]\s*\d+\s*[/分]\s*\d+\s*[）)]/g, "").trim();

  let numMatch = /第\s*(\d+(?:\.\d+)?)\s*[章話回節]/.exec(h1Text);

  if (!numMatch && pageTitle) {
    numMatch = /第\s*(\d+(?:\.\d+)?)\s*[章話回節]/.exec(pageTitle);
  }

  if (!numMatch) {
    numMatch = /(?:Chapter|Ch|ch|^)\s*(\d+(?:\.\d+)?)/i.exec(h1Text);
  }

  if (!numMatch) {
    numMatch = /(\d+(?:\.\d+)?)/.exec(h1Text);
  }

  const number = numMatch ? Number(numMatch[1]) : 1;

  let title = h1Text
    .replace(/^第\s*\d+(?:\.\d+)?\s*[章話回節]\s*[:：\s]*/, "")
    .replace(/^(?:Chapter|Ch|ch|\d+)\s*[:：.\s]*/i, "")
    .trim();

  if (!title) {
    title = h1Text;
  }

  let start = html.indexOf('id="chaptercontent"');
  if (start === -1) start = html.indexOf('class="read-content"');
  if (start === -1) start = html.indexOf('id="content"');
  if (start === -1) start = html.search(/id="chaptercontent\d*"/i);
  if (start === -1) start = html.search(/class="[^"]*read-content[^"]*"/i);
  if (start === -1) start = html.search(/class="[^"]*read_content[^"]*"/i);
  if (start === -1) start = html.search(/class="[^"]*(?:content|book.read|container)[^"]*"/i);

  if (start === -1) {
    log("warn", "biquge content container not found", {
      url,
      pageTitle,
      length: html.length,
      sample: html.slice(0, 300),
    });
    if (html.length < 1000 || !/[\u4e00-\u9fa5]/.test(html)) {
      throw new SafeServerError(
        "Source page returned invalid HTML or was blocked. Try setting SCRAPER_PREMIUM_PROXY=true in .env.local",
      );
    }
    throw new SafeServerError("Could not locate chapter text container on page");
  }

  const contentStart = html.indexOf(">", start);
  if (contentStart === -1) {
    throw new SafeServerError("Could not locate chapter text container on page");
  }

  let contentHtml = html.slice(contentStart + 1);

  const endPage = contentHtml.search(/class="read-page"|<div[^>]*class="read-page"/i);
  if (endPage !== -1) {
    contentHtml = contentHtml.slice(0, endPage);
  }

  contentHtml = contentHtml.replace(
    /<div[^>]*style="[^"]*text-align:\s*center[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    "",
  );
  contentHtml = contentHtml.replace(/<div[^>]*id="compass-fit-[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  contentHtml = contentHtml.replace(/<ins[^>]*>[\s\S]*?<\/ins>/gi, "");
  contentHtml = contentHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  contentHtml = contentHtml.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "");

  let paragraphs: string[] = [];

  const pMatches = [...contentHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  if (pMatches.length > 0) {
    paragraphs = pMatches
      .map((m) => decodeEntities(stripTags(m[1])).trim())
      .filter((p) => p.length > 0 && !BOILERPLATE_RE.test(p));
  } else {
    const rawLines = contentHtml.split(/<br\s*\/?>/i);
    paragraphs = rawLines
      .map((line) =>
        decodeEntities(stripTags(line))
          .replace(/^[\u3000\u2003\s&nbsp;&emsp;]+|[\u3000\u2003\s&nbsp;&emsp;]+$/g, "")
          .trim(),
      )
      .filter((line) => line.length > 0 && line.length < 5000 && !BOILERPLATE_RE.test(line));
  }

  if (paragraphs.length === 0) {
    throw new SafeServerError("Chapter text extracted is empty");
  }

  const nextMatch =
    /href="([^"]+)"[^>]*rel="next"/i.exec(html) ?? /href="([^"]+)"[^>]*>\s*下一章\s*</i.exec(html);
  const nextUrl = nextMatch ? new URL(nextMatch[1], url).toString() : null;

  return {
    number,
    title,
    content: paragraphs.join("\n\n"),
    nextUrl,
  };
}

export const SOURCES: Source[] = [
  { name: "quanben", hosts: ["www.quanben.io", "quanben.io"], parse: parseQuanben },
  { name: "twkan", hosts: ["twkan.com", "www.twkan.com"], parse: parseTwkan },
  { name: "biquge", hosts: ["www.biquge.tw", "biquge.tw"], parse: parseBiquge },
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
