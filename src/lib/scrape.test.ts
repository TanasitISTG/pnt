import { describe, it, expect } from "vitest";

import { parseChapter, chapterUrlFor, findSource } from "@/lib/scrape";

const URL = "https://www.quanben.io/n/some-novel/30.html";

// Trimmed version of a real quanben.io chapter page.
const FIXTURE = `<!DOCTYPE html>
<html><body>
<div class="main">
<h1 class="headline" itemprop="headline">第030章 秦大师真相了</h1>
<div itemprop="articleBody" class="articlebody">
<div id="content">
<span id="ad"></span>
<p>“？？？”</p><p>中年男人直接满脸的问号。</p>
<!--PAGE 2-->
<p>秦夜则是说道：&quot;办法不是没有。&quot;</p>
<p>“请记住我的名字！”</p>
<p>请记住本书首发域名：quanben.io</p>
<p>  </p>
</div>
</div>
<div class="list_page">
<span><a href="/n/some-novel/29.html">上一页</a></span>
<span><a href="/n/some-novel/31.html">下一页</a></span>
</div>
</div>
</body></html>`;

describe("parseChapter (quanben)", () => {
  it("extracts number, title, content, nextUrl", () => {
    const r = parseChapter(FIXTURE, URL);
    expect(r.number).toBe(30);
    expect(r.title).toBe("秦大师真相了");
    expect(r.content).toBe(
      '“？？？”\n\n中年男人直接满脸的问号。\n\n秦夜则是说道："办法不是没有。"\n\n“请记住我的名字！”',
    );
    expect(r.nextUrl).toBe("https://www.quanben.io/n/some-novel/31.html");
  });

  it("throws when content markers are missing", () => {
    expect(() => parseChapter("<html><body>nope</body></html>", URL)).toThrow(
      "Could not find chapter title",
    );
  });
});

describe("findSource", () => {
  it("rejects unsupported hosts and non-https URLs", () => {
    expect(() => findSource("https://evil.example.com/x/1.html")).toThrow("Unsupported site");
    expect(() => findSource("http://www.quanben.io/n/x/1.html")).toThrow("https");
    expect(() => findSource("not a url")).toThrow("Invalid URL");
  });
});

describe("chapterUrlFor", () => {
  it("swaps the chapter number", () => {
    expect(chapterUrlFor(URL, 31)).toBe("https://www.quanben.io/n/some-novel/31.html");
  });
});
