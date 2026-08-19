import { describe, it, expect } from "vitest";
import * as fflate from "fflate";
import { parseEpubArchive } from "./parser";
import { SafeServerError } from "@/lib/server-fn-error";

// Helper to create an in-memory EPUB zip buffer
function createEpubBuffer(files: Record<string, string | Uint8Array>): Uint8Array {
  const zipObj: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zipObj[path] = typeof content === "string" ? fflate.strToU8(content) : content;
  }
  return fflate.zipSync(zipObj);
}

describe("EPUB Parser", () => {
  it("parses WebToEpub style EPUB with front-matter, entities, ads, and multipart merge", () => {
    const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试小说&mdash;首部曲</dc:title>
    <dc:creator>作者名</dc:creator>
    <dc:language>zh</dc:language>
    <dc:description>这是&lt;b&gt;小说简介&lt;/b&gt;</dc:description>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="Text/Cover.xhtml" media-type="application/xhtml+xml" properties="cover-image"/>
    <item id="info" href="Text/0000_Information.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="Text/0001_1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2_1" href="Text/0002_2_part1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2_2" href="Text/0003_2_part2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="Text/0004_3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    <itemref idref="info"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2_1"/>
    <itemref idref="ch2_2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`;

    const tocNcx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1"><navLabel><text>Information</text></navLabel><content src="Text/0000_Information.xhtml"/></navPoint>
    <navPoint id="np2"><navLabel><text>第1章 初入江湖</text></navLabel><content src="Text/0001_1.xhtml"/></navPoint>
    <navPoint id="np3"><navLabel><text>第2章 风起云涌 (1/2)</text></navLabel><content src="Text/0002_2_part1.xhtml"/></navPoint>
    <navPoint id="np4"><navLabel><text>第2章 风起云涌 (2/2)</text></navLabel><content src="Text/0003_2_part2.xhtml"/></navPoint>
    <navPoint id="np5"><navLabel><text>Chapter 3: The Climax</text></navLabel><content src="Text/0004_3.xhtml"/></navPoint>
  </navMap>
</ncx>`;

    const coverXhtml = `<!DOCTYPE html><html><head><title>Cover</title></head><body><div><img src="../Images/cover.jpg"/></div></body></html>`;

    const infoXhtml = `<!DOCTYPE html><html><head><title>Information</title></head><body><h1>Information</h1><p>Table of Contents URL: https://example.com</p></body></html>`;

    const ch1Xhtml = `<!DOCTYPE html><html><head><title> 第1章 初入江湖 </title></head><body>
      <h1> 第1章 初入江湖 </h1>
      <p>第1章 初入江湖青石板街上，少侠仗剑而立。&ldquo;天下风云出我辈。&rdquo;</p>
      <p>溫馨提示：請記住本書首發域名 69shu.com</p>
      <p>一阵清风拂过，落叶纷纷。</p>
      <p>VIP</p>
    </body></html>`;

    const ch2Part1Xhtml = `<!DOCTYPE html><html><head><title> 第2章 风起云涌 (1/2) </title></head><body>
      <h1> 第2章 风起云涌 (1/2) </h1>
      <p>第2章 风起云涌客栈之内，人声鼎沸。</p>
      <p>有人高谈阔论，论及武林盛会。</p>
    </body></html>`;

    const ch2Part2Xhtml = `<!DOCTYPE html><html><head><title> 第2章 风起云涌 （２／２） </title></head><body>
      <h1> 第2章 风起云涌 （２／２） </h1>
      <p>角落处的黑衣人冷笑一声，放下茶杯。</p>
      <p>应广大读者的要求，更多精彩请点击查看。</p>
      <p>窗外突然闪过一道黑影。</p>
    </body></html>`;

    const ch3Xhtml = `<!DOCTYPE html><html><head><title>Chapter 3: The Climax</title></head><body>
      <h1>Chapter 3: The Climax</h1>
      <p>Chapter 3: The Climax</p>
      <p>The dawn broke over the ancient fortress, revealing the army below.</p>
    </body></html>`;

    const epubBuf = createEpubBuffer({
      mimetype: "application/epub+zip",
      "META-INF/container.xml": containerXml,
      "OEBPS/content.opf": contentOpf,
      "OEBPS/toc.ncx": tocNcx,
      "OEBPS/Text/Cover.xhtml": coverXhtml,
      "OEBPS/Text/0000_Information.xhtml": infoXhtml,
      "OEBPS/Text/0001_1.xhtml": ch1Xhtml,
      "OEBPS/Text/0002_2_part1.xhtml": ch2Part1Xhtml,
      "OEBPS/Text/0003_2_part2.xhtml": ch2Part2Xhtml,
      "OEBPS/Text/0004_3.xhtml": ch3Xhtml,
    });

    const parsed = parseEpubArchive(epubBuf);

    // Metadata
    expect(parsed.metadata.title).toBe("测试小说—首部曲");
    expect(parsed.metadata.author).toBe("作者名");
    expect(parsed.metadata.language).toBe("zh");
    expect(parsed.metadata.description).toBe("这是小说简介");

    // Chapters count: Cover & Info skipped, Chapter 2 (1/2) and (2/2) merged -> 3 total chapters
    expect(parsed.chapters.length).toBe(3);

    // Chapter 1
    const ch1 = parsed.chapters[0];
    expect(ch1.number).toBe("1");
    expect(ch1.title).toBe("初入江湖");
    // Duplicate heading stripped from first paragraph, entities decoded, ads filtered
    expect(ch1.content).toContain("青石板街上，少侠仗剑而立。“天下风云出我辈。”");
    expect(ch1.content).not.toContain("第1章 初入江湖青石板街上");
    expect(ch1.content).toContain("一阵清风拂过，落叶纷纷。");
    expect(ch1.content).not.toContain("溫馨提示");
    expect(ch1.content).not.toContain("VIP");

    // Chapter 2 (Merged)
    const ch2 = parsed.chapters[1];
    expect(ch2.number).toBe("2");
    expect(ch2.title).toBe("风起云涌");
    expect(ch2.content).toContain("客栈之内，人声鼎沸。");
    expect(ch2.content).toContain("角落处的黑衣人冷笑一声，放下茶杯。");
    expect(ch2.content).toContain("窗外突然闪过一道黑影。");
    expect(ch2.content).not.toContain("应广大读者的要求");

    // Chapter 3 (English)
    const ch3 = parsed.chapters[2];
    expect(ch3.number).toBe("3");
    expect(ch3.title).toBe("The Climax");
    expect(ch3.content).toBe("The dawn broke over the ancient fortress, revealing the army below.");
  });

  it("parses EPUB 3 navigation documents", () => {
    const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>EPUB 3 Novel</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="ch1"/>
  </spine>
</package>`;

    const navXhtml = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>TOC</title></head><body>
      <nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc">
        <ol>
          <li><a href="ch1.xhtml">第1話 異世界転生</a></li>
        </ol>
      </nav>
    </body></html>`;

    const ch1Xhtml = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch 1</title></head><body>
      <h2>第1話 異世界転生</h2>
      <p>トラックに跳ねられて気がつくと、見知らぬ天井だった。</p>
    </body></html>`;

    const epubBuf = createEpubBuffer({
      "META-INF/container.xml": containerXml,
      "content.opf": contentOpf,
      "nav.xhtml": navXhtml,
      "ch1.xhtml": ch1Xhtml,
    });

    const parsed = parseEpubArchive(epubBuf);
    expect(parsed.chapters.length).toBe(1);
    expect(parsed.chapters[0].number).toBe("1");
    expect(parsed.chapters[0].title).toBe("異世界転生");
    expect(parsed.chapters[0].content).toBe("トラックに跳ねられて気がつくと、見知らぬ天井だった。");
  });

  it("handles unnumbered chapters by returning number: null", () => {
    const containerXml = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
    const contentOpf = `<package version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata><manifest><item id="c1" href="c1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
    const c1Xhtml = `<html><body><h1>Prologue: The Awakening</h1><p>In the beginning there was light.</p></body></html>`;

    const epubBuf = createEpubBuffer({
      "META-INF/container.xml": containerXml,
      "content.opf": contentOpf,
      "c1.xhtml": c1Xhtml,
    });

    const parsed = parseEpubArchive(epubBuf);
    expect(parsed.chapters.length).toBe(1);
    expect(parsed.chapters[0].number).toBeNull();
    expect(parsed.chapters[0].title).toBe("Prologue: The Awakening");
  });

  it("rejects empty EPUB, invalid ZIP, missing container, or dangerous paths", () => {
    expect(() => parseEpubArchive(new Uint8Array(0))).toThrow(SafeServerError);
    expect(() => parseEpubArchive(new Uint8Array([1, 2, 3, 4]))).toThrow(SafeServerError);

    // Missing container.xml
    const noContainer = createEpubBuffer({ "test.txt": "hello" });
    expect(() => parseEpubArchive(noContainer)).toThrow(/container\.xml/);

    // Dangerous path
    const dangerous = createEpubBuffer({
      "META-INF/container.xml": `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
      "../etc/passwd": "root:x:0:0",
    });
    expect(() => parseEpubArchive(dangerous)).toThrow(/invalid file path/);
    const malformedPath = createEpubBuffer({
      "META-INF/container.xml": `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
      "content.opf": `<package><metadata><dc:title>Test</dc:title></metadata><manifest><item id="chapter" href="%ZZ.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
      "chapter.xhtml": `<html><body><h1>Chapter 1</h1><p>text</p></body></html>`,
    });
    expect(() => parseEpubArchive(malformedPath)).toThrow(SafeServerError);
    const encodedDangerous = createEpubBuffer({
      "META-INF/container.xml": `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
      "safe/%2e%2e/passwd": "root:x:0:0",
    });
    expect(() => parseEpubArchive(encodedDangerous)).toThrow(/invalid file path/);
  });

  it("rejects archive containing only front matter or empty chapters", () => {
    const containerXml = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
    const contentOpf = `<package version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata><manifest><item id="cover" href="Cover.xhtml"/></manifest><spine><itemref idref="cover"/></spine></package>`;
    const coverXhtml = `<html><body><img src="cover.jpg"/></body></html>`;

    const epubBuf = createEpubBuffer({
      "META-INF/container.xml": containerXml,
      "content.opf": contentOpf,
      "Cover.xhtml": coverXhtml,
    });

    expect(() => parseEpubArchive(epubBuf)).toThrow(/no usable chapters/);
  });

  it("excludes navigation manifest items and rejects missing package metadata", () => {
    const containerXml = `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
    const withNav = `<package><metadata><dc:title>Test</dc:title></metadata><manifest><item id="nav" href="contents.xhtml" properties="nav"/><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="nav"/><itemref idref="chapter"/></spine></package>`;
    const navXhtml = `<html><body><h1>Book contents</h1><p>Chapter 1</p></body></html>`;
    const chapterXhtml = `<html><body><h1>Chapter 1</h1><p>Actual chapter</p></body></html>`;
    const parsed = parseEpubArchive(
      createEpubBuffer({
        "META-INF/container.xml": containerXml,
        "content.opf": withNav,
        "contents.xhtml": navXhtml,
        "chapter.xhtml": chapterXhtml,
      }),
    );
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].content).toBe("Actual chapter");

    const missingMetadata = `<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>`;
    expect(() =>
      parseEpubArchive(
        createEpubBuffer({
          "META-INF/container.xml": containerXml,
          "content.opf": missingMetadata,
          "chapter.xhtml": chapterXhtml,
        }),
      ),
    ).toThrow(/package metadata/);
  });

  it("merges only sequential multipart chapters and removes number-only markers", () => {
    const containerXml = `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
    const contentOpf = `<package><metadata><dc:title>Test</dc:title></metadata><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/><item id="c" href="c.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>`;
    const epub = createEpubBuffer({
      "META-INF/container.xml": containerXml,
      "content.opf": contentOpf,
      "a.xhtml": `<html><body><h1>第1章 Same</h1><p>single</p></body></html>`,
      "b.xhtml": `<html><body><h1>第1章 Same (2/2)</h1><p>part two</p></body></html>`,
      "c.xhtml": `<html><body><h1>第12章</h1><p>number-only</p></body></html>`,
    });
    const parsed = parseEpubArchive(epub);
    expect(parsed.chapters).toHaveLength(3);
    expect(parsed.chapters[0].content).toBe("single");
    expect(parsed.chapters[1].content).toBe("part two");
    expect(parsed.chapters[2]).toMatchObject({ number: "12", title: "Chapter" });
  });

  it("parses the real WebToEpub sample 8.epub if present", () => {
    const samplePath = "C:/Users/roycekk/Downloads/8.epub";
    const fs = require("node:fs");
    if (!fs.existsSync(samplePath)) return;

    const buf = fs.readFileSync(samplePath);
    const parsed = parseEpubArchive(new Uint8Array(buf));
    expect(parsed.metadata.title).toBe("中了8千萬，我卻回了村");
    expect(parsed.metadata.author).toBe("三歲的阿濤");
    expect(parsed.chapters.length).toBe(74);
    expect(parsed.chapters[0].number).toBe("1");
    expect(parsed.chapters[0].title).toBe("彩票中獎，霸氣離職");
    expect(parsed.chapters[69].title).toBe("謝以沐受傷");
    expect(parsed.chapters[69].content).toMatch(/^下午一點，尚安農莊的停車場/);
  });
});
