import { describe, it, expect } from "vitest";

import {
  parseChapter,
  chapterUrlFor,
  findSource,
  parseTwkanToc,
  twkanTocUrlFromReader,
  isTwkanTocUrl,
  parseBiqugeToc,
  biqugeTocUrlFromReader,
  isBiqugeTocUrl,
} from "@/lib/scrape";
import { assertPublicHost, isPrivateIp } from "@/lib/scrape/network-policy.server";

const QUANBEN_URL = "https://www.quanben.io/n/some-novel/30.html";

// Trimmed version of a real quanben.io chapter page.
const QUANBEN_FIXTURE = `<!DOCTYPE html>
<html><body>
<div class="main">
<h1 class="headline" itemprop="headline">第030章 秦大師真相了</h1>
<div itemprop="articleBody" class="articlebody">
<div id="content">
<span id="ad"></span>
<p>“？？？”</p><p>中年男人直接滿臉的問號。</p>
<!--PAGE 2-->
<p>秦夜則是說道："辦法不是沒有。"</p>
<p>“請記住我的名字！”</p>
<p>請記住本書首發域名：quanben.io</p>
  
</div>
</div>
<div class="list_page">
<span><a href="/n/some-novel/29.html">上一頁</a></span>
<span><a href="/n/some-novel/31.html">下一頁</a></span>
</div>
</div>
</body></html>`;

const TWKAN_URL = "https://twkan.com/txt/93984/52204812";

// Trimmed version of twkan reader HTML.
const TWKAN_FIXTURE = `<!DOCTYPE html>
<html><body>
<div class="read_main">
<h1>第2章 心動小島2026</h1>
<div id="txtcontent0">
<div class="txtad">ADVERT</div>
<script>var x = 1;</script>
第一段正文內容。<br>
第二段正文內容。<br>
請記住台灣twkan.com<br>
<script>var y = 2;</script>
第三段正文內容。
</div>
<div class="page1">
<a href="/txt/93984/52204811">上一章</a>
<a href="/txt/93984/52204813">下一章</a>
</div>
</div>
</body></html>`;

const TWKAN_TOC_FIXTURE = `<!DOCTYPE html>
<html><body>
<div class="book_list">
<ul>
<li><a href="/txt/93984/52204811">第1章 登島</a></li>
<li><a href="/txt/93984/52204812">第2章 心動小島2026</a></li>
<li><a href="/txt/93984/52204813">第3章 晚餐</a></li>
</ul>
</div>
</body></html>`;

const BIQUGE_URL = "https://www.biquge.tw/book/8143360/82204463.html";

const BIQUGE_FIXTURE = `<!DOCTYPE html>
<html><body>
<div class="container autoheight">
	<div class="book read">
		<h1>第3章 讓人短命的工作（1 / 1）</h1>
		<div class="read-page">
			<a href="/book/8143360/82204462.html" class="btn-grey">上一章</a>
			<a href="/book/8143360.html" rel="index">目錄</a>
			<a href="/book/8143360/82204464.html" rel="next">下一章</a>
		</div>
		<div class="read-content" id="chaptercontent">
	<p> 趙思思離開出租屋後，第一件事就是把相冊里的合照撕了個粉碎。 </p>
  <div style="text-align: center;"><ins class="clickforceads" data-ad-zone="25115"><iframe></iframe></ins></div>
  <p> 混蛋！ </p>
    </div>
</div>
</body></html>`;

const BIQUGE_TOC_FIXTURE = `<!DOCTYPE html>
<html><body>
<div class="book-list">
<a href="/book/8143360/82204461.html">第1章 上岸第一劍</a>
<a href="/book/8143360/82204462.html">第2章 心動小島2026</a>
<a href="/book/8143360/82204463.html">第3章 讓人短命的工作</a>
</div>
</body></html>`;

// Minimal reader pages whose heading (and page title) vary while content stays
// fixed, so numbering behavior can be probed without repeating full fixtures.
function twkanChapterHtml(heading: string | null, pageTitle?: string): string {
  return `<!DOCTYPE html>
<html><head>${pageTitle ? `<title>${pageTitle}</title>` : ""}</head><body>
<div class="read_main">
${heading === null ? "" : `<h1>${heading}</h1>`}
<div id="txtcontent0">
第一段正文內容。<br>
第二段正文內容。
</div>
</div>
</body></html>`;
}

function biqugeChapterHtml(heading: string, pageTitle?: string): string {
  return `<!DOCTYPE html>
<html><head>${pageTitle ? `<title>${pageTitle}</title>` : ""}</head><body>
<div class="container autoheight">
	<div class="book read">
		<h1>${heading}</h1>
		<div class="read-content" id="chaptercontent">
			<p>正文內容。</p>
		</div>
	</div>
</div>
</body></html>`;
}

describe("parseChapter (quanben)", () => {
  it("extracts number, title, content, nextUrl", () => {
    const r = parseChapter(QUANBEN_FIXTURE, QUANBEN_URL);
    expect(r.number).toBe(30);
    expect(r.title).toBe("秦大師真相了");
    expect(r.content).toBe(
      '“？？？”\n\n中年男人直接滿臉的問號。\n\n秦夜則是說道："辦法不是沒有。"\n\n“請記住我的名字！”',
    );
    expect(r.nextUrl).toBe("https://www.quanben.io/n/some-novel/31.html");
  });

  it("throws when content markers are missing", () => {
    expect(() => parseChapter("<html><body>nope</body></html>", QUANBEN_URL)).toThrow(
      "Could not find chapter title",
    );
  });
});

describe("parseChapter (twkan)", () => {
  it("extracts number, title, content, nextUrl and filters ads/scripts/boilerplate", () => {
    const r = parseChapter(TWKAN_FIXTURE, TWKAN_URL);
    expect(r.number).toBe(2);
    expect(r.title).toBe("心動小島2026");
    expect(r.content).toBe("第一段正文內容。\n\n第二段正文內容。\n\n第三段正文內容。");
    expect(r.nextUrl).toBe("https://twkan.com/txt/93984/52204813");
  });

  it("keeps content with a null number when the heading carries no numbering", () => {
    const r = parseChapter(twkanChapterHtml("心動小島2026"), TWKAN_URL);
    expect(r.number).toBeNull();
    expect(r.title).toBe("心動小島2026");
    expect(r.content).toBe("第一段正文內容。\n\n第二段正文內容。");

    const proseOnly = parseChapter(twkanChapterHtml("風起的地方"), TWKAN_URL);
    expect(proseOnly.number).toBeNull();
    expect(proseOnly.title).toBe("風起的地方");
  });

  it("falls back to the page title for the chapter number", () => {
    const r = parseChapter(
      twkanChapterHtml("心動小島2026", "第7章 心動小島2026_twkan 小說"),
      TWKAN_URL,
    );
    expect(r.number).toBe(7);
    expect(r.title).toBe("心動小島2026");
  });

  it("throws instead of fabricating a heading when no title source exists", () => {
    expect(() => parseChapter(twkanChapterHtml(null), TWKAN_URL)).toThrow(
      "Could not find chapter title on page",
    );
  });
});

describe("parseChapter (biquge)", () => {
  it("extracts number, title, content, nextUrl and filters ad elements", () => {
    const r = parseChapter(BIQUGE_FIXTURE, BIQUGE_URL);
    expect(r.number).toBe(3);
    expect(r.title).toBe("讓人短命的工作");
    expect(r.content).toBe("趙思思離開出租屋後，第一件事就是把相冊里的合照撕了個粉碎。\n\n混蛋！");
    expect(r.nextUrl).toBe("https://www.biquge.tw/book/8143360/82204464.html");
  });

  it("keeps content with a null number when the title carries no numbering", () => {
    const proseOnly = parseChapter(biqugeChapterHtml("讓人短命的工作"), BIQUGE_URL);
    expect(proseOnly.number).toBeNull();
    expect(proseOnly.title).toBe("讓人短命的工作");

    const digitsInTitle = parseChapter(biqugeChapterHtml("心動小島2026"), BIQUGE_URL);
    expect(digitsInTitle.number).toBeNull();
    expect(digitsInTitle.title).toBe("心動小島2026");
    expect(digitsInTitle.content).toBe("正文內容。");
  });

  it("falls back to the page title for the chapter number", () => {
    const r = parseChapter(
      biqugeChapterHtml("讓人短命的工作", "第8章 讓人短命的工作_心動小島2026_小說"),
      BIQUGE_URL,
    );
    expect(r.number).toBe(8);
    expect(r.title).toBe("讓人短命的工作");
  });

  it("parses decimal, zero, and leading-zero chapter labels", () => {
    expect(parseChapter(biqugeChapterHtml("第1.5章 番外"), BIQUGE_URL)).toMatchObject({
      number: 1.5,
      title: "番外",
    });
    expect(parseChapter(biqugeChapterHtml("第007章 上岸第一劍"), BIQUGE_URL).number).toBe(7);
    expect(parseChapter(biqugeChapterHtml("第000章 楔子"), BIQUGE_URL).number).toBe(0);
  });

  it("parses English Chapter/Ch labels and delimited leading numbers", () => {
    expect(parseChapter(biqugeChapterHtml("Chapter 12 - 訓練"), BIQUGE_URL)).toMatchObject({
      number: 12,
      title: "訓練",
    });
    expect(parseChapter(biqugeChapterHtml("Ch.5 訓練"), BIQUGE_URL)).toMatchObject({
      number: 5,
      title: "訓練",
    });
    expect(parseChapter(biqugeChapterHtml("12、結局"), BIQUGE_URL)).toMatchObject({
      number: 12,
      title: "結局",
    });
  });

  it("rejects explicit numbers outside the stored numeric(8,2) range or scale", () => {
    const invalid = "Could not determine a valid chapter number from the source page";
    expect(() => parseChapter(biqugeChapterHtml("第1000000章 溢出"), BIQUGE_URL)).toThrow(invalid);
    expect(() => parseChapter(biqugeChapterHtml("第1.234章 精度"), BIQUGE_URL)).toThrow(invalid);
    expect(() => parseChapter(biqugeChapterHtml("1234567 心動小島"), BIQUGE_URL)).toThrow(invalid);
    expect(parseChapter(biqugeChapterHtml("第999999章 頂點"), BIQUGE_URL).number).toBe(999999);
  });

  it("rejects malformed explicit chapter tokens without prefix truncation", () => {
    for (const heading of ["Chapter 1e3", "1.2.3 Title", "第-1章 標題"]) {
      expect(() => parseChapter(biqugeChapterHtml(heading), BIQUGE_URL)).toThrow(
        "Could not determine a valid chapter number from the source page",
      );
    }
  });
});

describe("parseBiqugeToc", () => {
  it("parses TOC links into a map of 1-based positions to full URLs", () => {
    const toc = parseBiqugeToc(BIQUGE_TOC_FIXTURE, "https://www.biquge.tw/book/8143360/");
    expect(Object.keys(toc)).toEqual(["1", "2", "3"]);
    expect(toc[1]).toBe("https://www.biquge.tw/book/8143360/82204461.html");
    expect(toc[2]).toBe("https://www.biquge.tw/book/8143360/82204462.html");
    expect(toc[3]).toBe("https://www.biquge.tw/book/8143360/82204463.html");
  });

  it("keys multi-volume TOCs by position only, never by printed chapter number", () => {
    const multiVolFixture = `<!DOCTYPE html>
<html><body>
<div class="book-list">
<dt>正文</dt>
<a href="/book/8143360/82204461.html">第324章 遲來的婚禮</a>
<a href="/book/8143360/82204462.html">第1章 高中</a>
<a href="/book/8143360/82204463.html">第2章 兄妹</a>
</div>
</body></html>`;
    const toc = parseBiqugeToc(multiVolFixture, "https://www.biquge.tw/book/8143360/");
    expect(Object.keys(toc)).toEqual(["1", "2", "3"]);
    expect(toc[1]).toBe("https://www.biquge.tw/book/8143360/82204461.html");
    expect(toc[2]).toBe("https://www.biquge.tw/book/8143360/82204462.html");
    expect(toc[3]).toBe("https://www.biquge.tw/book/8143360/82204463.html");
    expect(toc[324]).toBeUndefined();
  });

  it("deduplicates repeated links without leaving position gaps", () => {
    const duplicateFixture = `<!DOCTYPE html>
<html><body>
<div class="book-list">
<dt>正文</dt>
<a href="/book/8143360/82204461.html">第1章 上岸第一劍</a>
<a href="/book/8143360/82204461.html">第1章 上岸第一劍</a>
<a href="/book/8143360/82204462.html">第2章 心動小島2026</a>
</div>
</body></html>`;
    const toc = parseBiqugeToc(duplicateFixture, "https://www.biquge.tw/book/8143360/");
    expect(Object.keys(toc)).toEqual(["1", "2"]);
    expect(toc[1]).toBe("https://www.biquge.tw/book/8143360/82204461.html");
    expect(toc[2]).toBe("https://www.biquge.tw/book/8143360/82204462.html");
  });

  it("traverses the whole page when the main section holds no chapter links", () => {
    const lateSectionFixture = `<!DOCTYPE html>
<html><body>
<div class="book-list">
<a href="/book/8143360/82204461.html">第5章 上岸第一劍</a>
<a href="/book/8143360/82204462.html">第6章 心動小島2026</a>
<dt>正文</dt>
</div>
</body></html>`;
    const toc = parseBiqugeToc(lateSectionFixture, "https://www.biquge.tw/book/8143360/");
    expect(Object.keys(toc)).toEqual(["1", "2"]);
    expect(toc[1]).toBe("https://www.biquge.tw/book/8143360/82204461.html");
    expect(toc[2]).toBe("https://www.biquge.tw/book/8143360/82204462.html");
    expect(toc[5]).toBeUndefined();
    expect(toc[6]).toBeUndefined();
  });
});

describe("biquge helpers", () => {
  it("derives TOC URL from reader URL", () => {
    expect(biqugeTocUrlFromReader("https://www.biquge.tw/book/8143360/82204463.html")).toBe(
      "https://www.biquge.tw/book/8143360/",
    );
  });

  it("identifies biquge TOC URLs", () => {
    expect(isBiqugeTocUrl("https://www.biquge.tw/book/8143360/")).toBe(true);
    expect(isBiqugeTocUrl("https://biquge.tw/book/8143360")).toBe(true);
    expect(isBiqugeTocUrl("https://www.biquge.tw/book/8143360/82204463.html")).toBe(false);
  });
});

describe("parseTwkanToc", () => {
  it("parses TOC links into a map of chapter numbers to full URLs", () => {
    const toc = parseTwkanToc(TWKAN_TOC_FIXTURE, "https://twkan.com/book/93984.html");
    expect(toc[1]).toBe("https://twkan.com/txt/93984/52204811");
    expect(toc[2]).toBe("https://twkan.com/txt/93984/52204812");
    expect(toc[3]).toBe("https://twkan.com/txt/93984/52204813");
  });
});

describe("twkan helpers", () => {
  it("derives TOC URL from reader URL", () => {
    expect(twkanTocUrlFromReader("https://twkan.com/txt/93984/52204812")).toBe(
      "https://twkan.com/book/93984.html",
    );
  });

  it("identifies twkan TOC URLs", () => {
    expect(isTwkanTocUrl("https://twkan.com/book/93984.html")).toBe(true);
    expect(isTwkanTocUrl("https://www.twkan.com/book/93984.html")).toBe(true);
    expect(isTwkanTocUrl("https://twkan.com/txt/93984/52204812")).toBe(false);
  });
});

describe("findSource", () => {
  it("supports quanben, twkan, and biquge", () => {
    expect(findSource("https://www.quanben.io/n/some-novel/1.html").name).toBe("quanben");
    expect(findSource("https://twkan.com/txt/93984/52204812").name).toBe("twkan");
    expect(findSource("https://www.biquge.tw/book/8143360/82204461.html").name).toBe("biquge");
  });

  it("rejects unsupported hosts and non-https URLs", () => {
    expect(() => findSource("https://evil.example.com/x/1.html")).toThrow("Unsupported site");
    expect(() => findSource("http://www.quanben.io/n/x/1.html")).toThrow("https");
    expect(() => findSource("not a url")).toThrow("Invalid URL");
  });
});

describe("chapterUrlFor", () => {
  it("swaps the chapter number", () => {
    expect(chapterUrlFor(QUANBEN_URL, 31)).toBe("https://www.quanben.io/n/some-novel/31.html");
  });

  it("preserves query and fragment", () => {
    expect(chapterUrlFor("https://www.quanben.io/n/book/30.html?lang=zh#text", 31)).toBe(
      "https://www.quanben.io/n/book/31.html?lang=zh#text",
    );
    expect(chapterUrlFor(`${QUANBEN_URL}?lang=zh`, 31)).toBe(
      "https://www.quanben.io/n/some-novel/31.html?lang=zh",
    );
    expect(chapterUrlFor(`${QUANBEN_URL}#text`, 31)).toBe(
      "https://www.quanben.io/n/some-novel/31.html#text",
    );
  });

  it("supports decimal chapter numbers", () => {
    expect(chapterUrlFor(QUANBEN_URL, 1.5)).toBe("https://www.quanben.io/n/some-novel/1.5.html");
  });

  it("leaves a pathname without a numeric suffix unchanged", () => {
    expect(chapterUrlFor("https://www.quanben.io/n/some-novel/", 31)).toBe(
      "https://www.quanben.io/n/some-novel/",
    );
  });

  it("does not rewrite numeric suffixes inside nonnumeric filename components", () => {
    const url = "https://www.quanben.io/n/book/chapter30.html?lang=zh#text";
    expect(chapterUrlFor(url, 31)).toBe(url);
  });

  it("does not rewrite an .html-looking query value", () => {
    expect(chapterUrlFor(`${QUANBEN_URL}?file=9.html`, 31)).toBe(
      "https://www.quanben.io/n/some-novel/31.html?file=9.html",
    );
  });
});

describe("isPrivateIp", () => {
  it("identifies private and loopback addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("localhost")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);

    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });
});

describe("assertPublicHost", () => {
  it("rejects private hostnames, unsupported sites, and non-https URLs", async () => {
    await expect(assertPublicHost("https://localhost/n/x/1.html")).rejects.toThrow(
      "Unsupported site",
    );
    await expect(assertPublicHost("http://www.quanben.io/n/some-novel/1.html")).rejects.toThrow(
      "https",
    );
    await expect(
      assertPublicHost("https://www.quanben.io/n/some-novel/1.html"),
    ).resolves.toBeUndefined();
    await expect(assertPublicHost("https://twkan.com/txt/93984/52204812")).resolves.toBeUndefined();
    await expect(
      assertPublicHost("https://www.biquge.tw/book/8143360/82204461.html"),
    ).resolves.toBeUndefined();
  });
});

describe("SCRAPE_PROVIDERS & SUPPORTED_SITES_LABEL", () => {
  it("exports provider metadata for auto, direct, zenrows, scrapingbee, and firecrawl", async () => {
    const { SCRAPE_PROVIDERS, SUPPORTED_SITES_LABEL } = await import("@/lib/scrape");
    expect(SCRAPE_PROVIDERS).toHaveLength(5);
    expect(SCRAPE_PROVIDERS.map((p) => p.id)).toEqual([
      "auto",
      "direct",
      "zenrows",
      "scrapingbee",
      "firecrawl",
    ]);
    expect(SUPPORTED_SITES_LABEL).toContain("quanben.io");
    expect(SUPPORTED_SITES_LABEL).toContain("twkan.com");
    expect(SUPPORTED_SITES_LABEL).toContain("biquge.tw");
  });
});
