export function filterChapters<
  T extends { number: string; title: string; translatedTitle: string | null },
>(chapters: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...chapters];

  return chapters.filter((chapter) =>
    [chapter.number, chapter.title, chapter.translatedTitle]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
  );
}
