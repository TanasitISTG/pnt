import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import { buildEpub } from "./epub";

const META = {
  title: "Test Novel <&>",
  author: "Author Name",
  language: "th",
  identifier: "urn:pnt:test-1",
};

const CHAPTERS = [
  { title: "Chapter 1 — Start", paragraphs: ["First para.", "Second <para> & more."] },
  { title: "Chapter 2 — Next", paragraphs: ["Only para."] },
];

describe("buildEpub", () => {
  const zip = buildEpub(META, CHAPTERS);
  const entries = unzipSync(zip);
  const names = Object.keys(entries);

  it("has mimetype first with the exact required content", () => {
    expect(names[0]).toBe("mimetype");
    expect(strFromU8(entries["mimetype"])).toBe("application/epub+zip");
  });

  it("contains container, opf, nav, and one xhtml per chapter", () => {
    expect(names).toContain("META-INF/container.xml");
    expect(names).toContain("OEBPS/content.opf");
    expect(names).toContain("OEBPS/nav.xhtml");
    expect(names).toContain("OEBPS/chapter-1.xhtml");
    expect(names).toContain("OEBPS/chapter-2.xhtml");
  });

  it("embeds title/author metadata and escapes XML", () => {
    const opf = strFromU8(entries["OEBPS/content.opf"]);
    expect(opf).toContain("<dc:title>Test Novel &lt;&amp;&gt;</dc:title>");
    expect(opf).toContain("<dc:creator>Author Name</dc:creator>");
    expect(opf).toContain("<dc:language>th</dc:language>");

    const ch1 = strFromU8(entries["OEBPS/chapter-1.xhtml"]);
    expect(ch1).toContain("<p>Second &lt;para&gt; &amp; more.</p>");
  });

  it("lists every chapter in the nav", () => {
    const nav = strFromU8(entries["OEBPS/nav.xhtml"]);
    expect(nav).toContain('href="chapter-1.xhtml"');
    expect(nav).toContain('href="chapter-2.xhtml"');
  });
});
