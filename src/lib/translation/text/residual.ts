// CJK ideographs (ext-A + unified + compat). Leftover hanzi in output = missed translation.
// Single source of truth: CJK_RE scans in JS; RESIDUAL_CJK_SQL_RE is the same class
// used by getResidualHanziChapters for a DB-side pre-filter (PostgreSQL `~`).
export const RESIDUAL_CJK_CLASS = "㐀-䶿一-鿿豈-﫿";
export const RESIDUAL_CJK_SQL_RE = `[${RESIDUAL_CJK_CLASS}]`;
const CJK_RE = new RegExp(RESIDUAL_CJK_SQL_RE, "g");

/** Leftover CJK chars in a translation — never legitimate output, so detection is pair-agnostic
 *  (a wrong sourceLang on the novel must not disable it). `pair` kept for caller compatibility. */
export function findResidualSourceChars(_pair: string, text: string): string[] {
  return text.match(CJK_RE) || [];
}
