/**
 * Revision key for the admin residual-script scan. The scan reads every
 * translated chapter body and treats approved glossary targets as protected, so
 * the key must move whenever either changes — otherwise the cached result is
 * reused and no full-text scan needs to run.
 */
export interface ResidualRevisionChapter {
  status: string;
  updatedAt: Date | string;
}

export function residualRevisionOf(
  chapters: readonly ResidualRevisionChapter[],
  approvedTermCount: number,
): string {
  let translatedCount = 0;
  let latestUpdatedAt = "";
  for (const chapter of chapters) {
    if (chapter.status !== "translated") continue;
    translatedCount += 1;
    const stamp = new Date(chapter.updatedAt).toISOString();
    if (stamp > latestUpdatedAt) latestUpdatedAt = stamp;
  }
  return `${translatedCount}:${latestUpdatedAt}:${approvedTermCount}`;
}
