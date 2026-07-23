export interface ReaderProgress {
  lastChapterId: string | null;
  readChapterIds: string[];
  scrollFraction?: number;
}

const STORAGE_KEY = "pnt-reader-progress";

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // Return null if storage is disabled or restricted
  }
  return null;
}

export function getReaderProgress(novelId: string): ReaderProgress {
  const storage = getStorage();
  if (!storage) {
    return { lastChapterId: null, readChapterIds: [] };
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { lastChapterId: null, readChapterIds: [] };

    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null) {
      return { lastChapterId: null, readChapterIds: [] };
    }

    const novelProgress = data[novelId];
    if (typeof novelProgress !== "object" || novelProgress === null) {
      return { lastChapterId: null, readChapterIds: [] };
    }

    const lastChapterId =
      typeof novelProgress.lastChapterId === "string" ? novelProgress.lastChapterId : null;

    const readChapterIds = Array.isArray(novelProgress.readChapterIds)
      ? novelProgress.readChapterIds.filter((id: unknown): id is string => typeof id === "string")
      : [];

    const scrollFraction =
      typeof novelProgress.scrollFraction === "number" &&
      !isNaN(novelProgress.scrollFraction) &&
      novelProgress.scrollFraction > 0
        ? novelProgress.scrollFraction
        : undefined;

    return { lastChapterId, readChapterIds, scrollFraction };
  } catch {
    return { lastChapterId: null, readChapterIds: [] };
  }
}

export function markChapterRead(novelId: string, chapterId: string): ReaderProgress {
  const storage = getStorage();
  if (!storage) {
    return { lastChapterId: chapterId, readChapterIds: [chapterId] };
  }

  try {
    const current = getReaderProgress(novelId);
    const readSet = new Set(current.readChapterIds);
    readSet.add(chapterId);

    const updated: ReaderProgress = {
      lastChapterId: chapterId,
      readChapterIds: Array.from(readSet),
      ...(current.lastChapterId === chapterId && current.scrollFraction !== undefined
        ? { scrollFraction: current.scrollFraction }
        : {}),
    };

    const raw = storage.getItem(STORAGE_KEY);
    let allData: Record<string, unknown> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          allData = parsed;
        }
      } catch {
        allData = {};
      }
    }

    allData[novelId] = updated;
    storage.setItem(STORAGE_KEY, JSON.stringify(allData));
    return updated;
  } catch {
    return { lastChapterId: chapterId, readChapterIds: [chapterId] };
  }
}

export function saveScrollPosition(novelId: string, fraction: number): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    const current = getReaderProgress(novelId);
    const updated: ReaderProgress = {
      ...current,
      scrollFraction: Math.max(0, Math.min(1, fraction)),
    };

    const raw = storage.getItem(STORAGE_KEY);
    let allData: Record<string, unknown> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          allData = parsed;
        }
      } catch {
        allData = {};
      }
    }

    allData[novelId] = updated;
    storage.setItem(STORAGE_KEY, JSON.stringify(allData));
  } catch {
    // Ignore storage write errors
  }
}
