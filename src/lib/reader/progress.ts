import type { ReaderProgress } from "./types";
import { getReaderStorage, READER_PROGRESS_STORAGE_KEY as STORAGE_KEY } from "./storage";

export function getReaderProgress(novelId: string): ReaderProgress {
  const storage = getReaderStorage();
  if (!storage) {
    return { lastChapterId: null, readChapterIds: [] };
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { lastChapterId: null, readChapterIds: [] };

    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
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
      Number.isFinite(novelProgress.scrollFraction)
        ? Math.max(0, Math.min(1, novelProgress.scrollFraction))
        : undefined;

    return { lastChapterId, readChapterIds, scrollFraction };
  } catch {
    return { lastChapterId: null, readChapterIds: [] };
  }
}

function writeNovelProgress(storage: Storage, novelId: string, progress: ReaderProgress): void {
  const raw = storage.getItem(STORAGE_KEY);
  let allData: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        allData = parsed;
      }
    } catch {
      allData = {};
    }
  }

  allData[novelId] = progress;
  storage.setItem(STORAGE_KEY, JSON.stringify(allData));
}

export function markChapterOpened(novelId: string, chapterId: string): ReaderProgress {
  const storage = getReaderStorage();
  if (!storage) {
    return { lastChapterId: chapterId, readChapterIds: [] };
  }

  try {
    const current = getReaderProgress(novelId);
    const updated: ReaderProgress = {
      lastChapterId: chapterId,
      readChapterIds: current.readChapterIds,
      ...(current.lastChapterId === chapterId && current.scrollFraction !== undefined
        ? { scrollFraction: current.scrollFraction }
        : {}),
    };

    writeNovelProgress(storage, novelId, updated);
    return updated;
  } catch {
    return { lastChapterId: chapterId, readChapterIds: [] };
  }
}

export function markChapterRead(novelId: string, chapterId: string): ReaderProgress {
  const storage = getReaderStorage();
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

    writeNovelProgress(storage, novelId, updated);
    return updated;
  } catch {
    return { lastChapterId: chapterId, readChapterIds: [chapterId] };
  }
}

export function saveScrollPosition(novelId: string, fraction: number): void {
  if (!Number.isFinite(fraction)) return;
  const storage = getReaderStorage();
  if (!storage) return;

  try {
    const current = getReaderProgress(novelId);
    const updated: ReaderProgress = {
      ...current,
      scrollFraction: Math.max(0, Math.min(1, fraction)),
    };

    writeNovelProgress(storage, novelId, updated);
  } catch {
    // Ignore storage write errors
  }
}
