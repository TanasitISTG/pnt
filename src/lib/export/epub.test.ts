import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import { buildEpub, createEpubStream } from "./epub";

afterEach(() => vi.useRealTimers());
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

  describe("createEpubStream", () => {
    it("streams a valid archive without a base64 copy", async () => {
      async function* chapters() {
        for (const chapter of CHAPTERS) yield chapter;
      }

      const bytes = new Uint8Array(
        await new Response(createEpubStream(META, chapters())).arrayBuffer(),
      );
      const streamedEntries = unzipSync(bytes);
      expect(strFromU8(streamedEntries["mimetype"])).toBe("application/epub+zip");
      expect(strFromU8(streamedEntries["OEBPS/chapter-2.xhtml"])).toContain("Only para.");
    });

    it("emits nav/spine matching consumed chapters even when iteration stops early", async () => {
      async function* truncated() {
        yield CHAPTERS[0];
      }

      const entries = unzipSync(
        new Uint8Array(await new Response(createEpubStream(META, truncated())).arrayBuffer()),
      );
      const nav = strFromU8(entries["OEBPS/nav.xhtml"]);
      expect(nav).toContain("Start");
      expect(nav).not.toContain("Next");
      const opf = strFromU8(entries["OEBPS/content.opf"]);
      expect(opf).toContain('idref="ch1"');
      expect(opf).not.toContain('idref="ch2"');
      expect(strFromU8(entries["OEBPS/chapter-1.xhtml"])).toContain("First para.");
      expect(Object.keys(entries).some((name) => name.includes("chapter-2"))).toBe(false);
    });

    it("propagates iteration errors as stream errors", async () => {
      async function* throwing() {
        yield CHAPTERS[0];
        throw new Error("iteration failed");
      }

      await expect(new Response(createEpubStream(META, throwing())).arrayBuffer()).rejects.toThrow(
        "iteration failed",
      );
    });

    it("propagates a zero-chapter stream as a valid empty archive", async () => {
      async function* empty() {
        // yields nothing
      }

      const entries = unzipSync(
        new Uint8Array(await new Response(createEpubStream(META, empty())).arrayBuffer()),
      );
      const opf = strFromU8(entries["OEBPS/content.opf"]);
      expect(opf).not.toContain('idref="ch1"');
      expect(entries["OEBPS/chapter-1.xhtml"]).toBeUndefined();
      expect(strFromU8(entries["OEBPS/nav.xhtml"])).not.toContain("chapter-1.xhtml");
    });

    it("applies backpressure so unread data halts producer advancement", async () => {
      vi.useFakeTimers();
      let consumed = 0;
      let seed = 123456;
      const body = Array.from({ length: 300_000 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return String.fromCharCode(33 + ((seed >>> 16) % 90));
      }).join("");
      async function* chapters() {
        for (let index = 0; index < 20; index++) {
          consumed++;
          yield { title: String(index), paragraphs: [body] };
        }
      }
      const reader = createEpubStream(META, chapters()).getReader();
      while (consumed === 0) await reader.read();
      await vi.runAllTimersAsync();
      const pausedAt = consumed;
      expect(pausedAt).toBe(1);
      await vi.runAllTimersAsync();
      expect(consumed).toBe(pausedAt);
      await reader.cancel();
    });

    it("runs iterator cleanup on consumer cancellation", async () => {
      let finallyRan = false;
      let started = false;
      async function* cancellable() {
        try {
          started = true;
          for (const chapter of CHAPTERS) yield chapter;
          while (true) yield { title: "extra", paragraphs: [] };
        } finally {
          finallyRan = true;
        }
      }

      const reader = createEpubStream(META, cancellable()).getReader();
      while (!started) await reader.read();
      await reader.cancel();
      await Promise.resolve();
      expect(finallyRan).toBe(true);
    });
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
