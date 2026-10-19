/**
 * The HTML text helpers the EPUB parser shares with nothing else now that URL sources are
 * gone. They live here rather than in the parser because the archive is the only caller:
 * entity decoding and the boilerplate guard are properties of the text an EPUB carries.
 */
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
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

export const BOILERPLATE_RE =
  /(請記住.{0,12}(域名|網址|本書|本站)|請記住.{0,12}(域名|網址|本書|本站)|台灣|twkan\.com|quanben|\u0489|PROMOTED CONTENT|mgid|resultados para|iphone 17|Ordenar por|biquge)/i;
