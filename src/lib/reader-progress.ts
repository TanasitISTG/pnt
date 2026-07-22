export interface ReaderProgress {
  lastChapterId: string | null;
  readChapterIds: string[];
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

    return { lastChapterId, readChapterIds };
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
