import { describe, it, expect } from "vitest";

import {
  parseChapter,
  chapterUrlFor,
  findSource,
  isPrivateIp,
  assertPublicHost,
  parseTwkanToc,
  twkanTocUrlFromReader,
  isTwkanTocUrl,
  parseBiqugeToc,
  biqugeTocUrlFromReader,
  isBiqugeTocUrl,
} from "@/lib/scrape";

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
});

describe("parseChapter (biquge)", () => {
  it("extracts number, title, content, nextUrl and filters ad elements", () => {
    const r = parseChapter(BIQUGE_FIXTURE, BIQUGE_URL);
    expect(r.number).toBe(3);
    expect(r.title).toBe("讓人短命的工作");
    expect(r.content).toBe("趙思思離開出租屋後，第一件事就是把相冊里的合照撕了個粉碎。\n\n混蛋！");
    expect(r.nextUrl).toBe("https://www.biquge.tw/book/8143360/82204464.html");
  });
});

describe("parseBiqugeToc", () => {
  it("parses TOC links into a map of chapter numbers to full URLs", () => {
    const toc = parseBiqugeToc(BIQUGE_TOC_FIXTURE, "https://www.biquge.tw/book/8143360/");
    expect(toc[1]).toBe("https://www.biquge.tw/book/8143360/82204461.html");
    expect(toc[2]).toBe("https://www.biquge.tw/book/8143360/82204462.html");
    expect(toc[3]).toBe("https://www.biquge.tw/book/8143360/82204463.html");
  });

  it("handles multi-volume renumbering after chapter 324 using sequential indices", () => {
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
    expect(toc[1]).toBe("https://www.biquge.tw/book/8143360/82204461.html");
    expect(toc[2]).toBe("https://www.biquge.tw/book/8143360/82204462.html");
    expect(toc[3]).toBe("https://www.biquge.tw/book/8143360/82204463.html");
    expect(toc[324]).toBe("https://www.biquge.tw/book/8143360/82204461.html");
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
