import type {
  LanguageCode,
  LectureWorkspace,
  SavedLibraryEntry,
  VisualGuideData,
} from '../types/mindflow';
import { isValidYouTubeId } from './youtube';

export const LIBRARY_STORAGE_KEY = 'mindflow_saved_library_v4';
export const LEGACY_LIBRARY_STORAGE_KEY_V3 = 'mindflow_saved_library_v3';
export const LIBRARY_STORAGE_VERSION = 4;
export const MAX_LIBRARY_ITEMS = 15;

export interface LibraryStorageEnvelope {
  version: number;
  items: SavedLibraryEntry[];
}

export interface LibraryLoadReport {
  items: SavedLibraryEntry[];
  migrated: boolean;
  recoveredFromCorruption: boolean;
  droppedInvalidEntries: number;
}

export interface LibrarySaveResult {
  ok: boolean;
  savedCount: number;
  droppedForQuota: number;
  reason?: 'quota_trimmed' | 'storage_unavailable' | 'quota_exceeded';
}

export interface LibraryUpsertResult {
  items: SavedLibraryEntry[];
  evictedTitles: string[];
  replacedExisting: boolean;
}

export function buildYouTubeThumbnailUrl(videoId: string): string {
  const trimmed = typeof videoId === 'string' ? videoId.trim() : '';
  if (!isValidYouTubeId(trimmed)) return '';
  return `https://i.ytimg.com/vi/${trimmed}/hqdefault.jpg`;
}

export function isDemoWorkspace(
  workspace: Pick<LectureWorkspace, 'id' | 'isDemo'> | null | undefined
): boolean {
  if (!workspace) return false;
  return Boolean(workspace.isDemo) || workspace.id.startsWith('dsa-masterclass-');
}

export function isDemoLibraryEntry(entry: SavedLibraryEntry | null | undefined): boolean {
  if (!entry) return false;
  if (typeof entry.isDemo === 'boolean') return entry.isDemo;
  const workspaces = Object.values(entry.workspacesByLang ?? {});
  return workspaces.length > 0 && workspaces.every((ws) => isDemoWorkspace(ws));
}

function isValidLanguageCode(val: unknown): val is LanguageCode {
  return val === 'en' || val === 'hi' || val === 'hinglish';
}

function isValidWorkspaceObject(raw: unknown): raw is LectureWorkspace {
  if (!raw || typeof raw !== 'object') return false;
  const ws = raw as Record<string, unknown>;
  return (
    typeof ws.videoId === 'string' &&
    ws.videoId.trim().length > 0 &&
    typeof ws.title === 'string' &&
    ws.title.trim().length > 0 &&
    Array.isArray(ws.nodes) &&
    ws.nodes.length > 0 &&
    Boolean(ws.cheatSheet) &&
    typeof ws.cheatSheet === 'object' &&
    Array.isArray(ws.transcript)
  );
}

function sanitizeLibraryEntry(raw: unknown): SavedLibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const videoId = typeof obj.videoId === 'string' ? obj.videoId.trim().slice(0, 80) : '';
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 300) : '';
  if (!videoId || !title) return null;

  const rawByLang = obj.workspacesByLang;
  if (!rawByLang || typeof rawByLang !== 'object') return null;

  const validWorkspacesByLang: Partial<Record<LanguageCode, LectureWorkspace>> = {};
  for (const [lang, ws] of Object.entries(rawByLang as Record<string, unknown>)) {
    if (isValidLanguageCode(lang) && isValidWorkspaceObject(ws)) {
      validWorkspacesByLang[lang] = ws;
    }
  }
  const availableLangs = Object.keys(validWorkspacesByLang) as LanguageCode[];
  if (availableLangs.length === 0) return null;

  const activeLanguage: LanguageCode =
    isValidLanguageCode(obj.activeLanguage) && validWorkspacesByLang[obj.activeLanguage]
      ? obj.activeLanguage
      : availableLangs[0];

  const validGuidesByLang: Partial<Record<LanguageCode, VisualGuideData>> = {};
  if (obj.visualGuidesByLang && typeof obj.visualGuidesByLang === 'object') {
    for (const [lang, guide] of Object.entries(
      obj.visualGuidesByLang as Record<string, unknown>
    )) {
      if (
        isValidLanguageCode(lang) &&
        guide &&
        typeof guide === 'object' &&
        Array.isArray((guide as Record<string, unknown>).chapters)
      ) {
        validGuidesByLang[lang] = guide as VisualGuideData;
      }
    }
  }

  const sourceType: 'youtube' | 'manual-transcript' =
    obj.sourceType === 'manual-transcript' || !isValidYouTubeId(videoId)
      ? 'manual-transcript'
      : 'youtube';

  return {
    videoId,
    title,
    channel: typeof obj.channel === 'string' ? obj.channel.trim().slice(0, 160) : 'YouTube Creator',
    videoCategory:
      typeof obj.videoCategory === 'string' ? obj.videoCategory.trim().slice(0, 80) : 'Explainer',
    youtubeUrl:
      sourceType === 'youtube' && typeof obj.youtubeUrl === 'string'
        ? obj.youtubeUrl.trim().slice(0, 300)
        : '',
    thumbnailUrl: sourceType === 'youtube' ? buildYouTubeThumbnailUrl(videoId) : '',
    activeLanguage,
    languages: availableLangs,
    savedAt:
      typeof obj.savedAt === 'number' && Number.isFinite(obj.savedAt) && obj.savedAt > 0
        ? obj.savedAt
        : Date.now(),
    workspacesByLang: validWorkspacesByLang,
    visualGuidesByLang: validGuidesByLang,
    isDemo:
      typeof obj.isDemo === 'boolean'
        ? obj.isDemo
        : Object.values(validWorkspacesByLang).every((ws) => isDemoWorkspace(ws)),
    sourceType,
  };
}

/**
 * Pure upsert helper with transparent eviction reporting:
 * inserts or updates a video entry in the saved library, moves it to the top,
 * and reports any oldest entries evicted when exceeding MAX_LIBRARY_ITEMS (15).
 */
export function upsertLibraryItemWithReport(
  items: SavedLibraryEntry[],
  workspace: LectureWorkspace,
  visualGuide?: VisualGuideData | null
): LibraryUpsertResult {
  const existing = items.find((item) => item.videoId === workspace.videoId);
  const rest = items.filter((item) => item.videoId !== workspace.videoId);

  const mergedWorkspaces: Partial<Record<LanguageCode, LectureWorkspace>> = {
    ...(existing?.workspacesByLang ?? {}),
    [workspace.language]: workspace,
  };

  const mergedVisualGuides: Partial<Record<LanguageCode, VisualGuideData>> = {
    ...(existing?.visualGuidesByLang ?? {}),
    ...(visualGuide ? { [visualGuide.language]: visualGuide } : {}),
  };

  const langSet = new Set<LanguageCode>(existing?.languages ?? []);
  langSet.add(workspace.language);
  if (visualGuide) {
    langSet.add(visualGuide.language);
  }

  const sourceType: 'youtube' | 'manual-transcript' =
    workspace.sourceType === 'manual-transcript' || !isValidYouTubeId(workspace.videoId)
      ? 'manual-transcript'
      : 'youtube';

  const nextEntry: SavedLibraryEntry = {
    videoId: workspace.videoId,
    title: workspace.title,
    channel: workspace.channel,
    videoCategory: workspace.videoCategory,
    youtubeUrl: sourceType === 'youtube' ? workspace.youtubeUrl : '',
    thumbnailUrl: sourceType === 'youtube' ? buildYouTubeThumbnailUrl(workspace.videoId) : '',
    activeLanguage: workspace.language,
    languages: Array.from(langSet),
    savedAt: Date.now(),
    workspacesByLang: mergedWorkspaces,
    visualGuidesByLang: mergedVisualGuides,
    isDemo: isDemoWorkspace(workspace),
    sourceType,
  };

  const combined = [nextEntry, ...rest];
  const kept = combined.slice(0, MAX_LIBRARY_ITEMS);
  const evicted = combined.slice(MAX_LIBRARY_ITEMS);

  return {
    items: kept,
    evictedTitles: evicted.map((entry) => entry.title),
    replacedExisting: Boolean(existing),
  };
}

/** Backwards-compatible upsert helper returning the updated array. */
export function upsertLibraryItem(
  items: SavedLibraryEntry[],
  workspace: LectureWorkspace,
  visualGuide?: VisualGuideData | null
): SavedLibraryEntry[] {
  return upsertLibraryItemWithReport(items, workspace, visualGuide).items;
}

/** Pure delete helper: removes a video entry by videoId. */
export function deleteLibraryItem(
  items: SavedLibraryEntry[],
  videoId: string
): SavedLibraryEntry[] {
  return items.filter((item) => item.videoId !== videoId);
}

/** Pure search/filter helper for the Saved Library drawer. */
export function filterLibraryItems(
  items: SavedLibraryEntry[],
  query: string
): SavedLibraryEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(normalized) ||
      item.channel.toLowerCase().includes(normalized) ||
      item.videoCategory.toLowerCase().includes(normalized) ||
      item.languages.some((lang) => lang.toLowerCase().includes(normalized))
  );
}

function parseRawLibraryPayload(
  raw: string
): { items: SavedLibraryEntry[]; droppedInvalidEntries: number; wasCorrupted: boolean } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    let candidateArray: unknown[] | null = null;

    if (Array.isArray(parsed)) {
      candidateArray = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (obj.version === LIBRARY_STORAGE_VERSION && Array.isArray(obj.items)) {
        candidateArray = obj.items;
      } else if (Array.isArray(obj.items) && (!('version' in obj) || obj.version === 3)) {
        candidateArray = obj.items;
      } else {
        return { items: [], droppedInvalidEntries: 0, wasCorrupted: true };
      }
    } else {
      return { items: [], droppedInvalidEntries: 0, wasCorrupted: true };
    }

    const valid: SavedLibraryEntry[] = [];
    let dropped = 0;
    for (const rawItem of candidateArray) {
      const clean = sanitizeLibraryEntry(rawItem);
      if (clean) {
        valid.push(clean);
      } else {
        dropped += 1;
      }
    }
    return {
      items: valid.slice(0, MAX_LIBRARY_ITEMS),
      droppedInvalidEntries: dropped,
      wasCorrupted: false,
    };
  } catch {
    return { items: [], droppedInvalidEntries: 0, wasCorrupted: true };
  }
}

/**
 * Loads saved library entries with schema validation, seamless v3 -> v4 migration,
 * and safe recovery from corrupted localStorage data.
 */
export function loadLibraryWithReport(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): LibraryLoadReport {
  const target =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) {
    return {
      items: [],
      migrated: false,
      recoveredFromCorruption: false,
      droppedInvalidEntries: 0,
    };
  }

  try {
    const rawV4 = target.getItem(LIBRARY_STORAGE_KEY);
    if (rawV4 !== null) {
      const parsed = parseRawLibraryPayload(rawV4);
      if (parsed.wasCorrupted) {
        // Recover cleanly by resetting unreadable storage
        try {
          target.removeItem(LIBRARY_STORAGE_KEY);
        } catch {
          // Ignore storage cleanup error
        }
        return {
          items: [],
          migrated: false,
          recoveredFromCorruption: true,
          droppedInvalidEntries: 0,
        };
      }
      if (parsed.droppedInvalidEntries > 0) {
        saveLibraryToStorage(parsed.items, target);
      }
      return {
        items: parsed.items,
        migrated: false,
        recoveredFromCorruption: parsed.droppedInvalidEntries > 0,
        droppedInvalidEntries: parsed.droppedInvalidEntries,
      };
    }

    // Seamless one-time migration from legacy v3 array key
    const rawV3 = target.getItem(LEGACY_LIBRARY_STORAGE_KEY_V3);
    if (rawV3 !== null) {
      const parsed = parseRawLibraryPayload(rawV3);
      if (parsed.wasCorrupted) {
        try {
          target.removeItem(LEGACY_LIBRARY_STORAGE_KEY_V3);
        } catch {
          // Ignore
        }
        return {
          items: [],
          migrated: false,
          recoveredFromCorruption: true,
          droppedInvalidEntries: 0,
        };
      }
      saveLibraryToStorage(parsed.items, target);
      return {
        items: parsed.items,
        migrated: true,
        recoveredFromCorruption: parsed.droppedInvalidEntries > 0,
        droppedInvalidEntries: parsed.droppedInvalidEntries,
      };
    }
  } catch {
    return {
      items: [],
      migrated: false,
      recoveredFromCorruption: true,
      droppedInvalidEntries: 0,
    };
  }

  return {
    items: [],
    migrated: false,
    recoveredFromCorruption: false,
    droppedInvalidEntries: 0,
  };
}

export function loadLibraryFromStorage(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): SavedLibraryEntry[] {
  return loadLibraryWithReport(storage).items;
}

/**
 * Persists library entries inside a versioned v4 schema envelope.
 * Never silently discards entries without reporting back what happened so the UI can inform the user.
 */
export function saveLibraryToStorage(
  items: SavedLibraryEntry[],
  storage?: Pick<Storage, 'setItem'>
): LibrarySaveResult {
  const target =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) {
    return {
      ok: false,
      savedCount: 0,
      droppedForQuota: items.length,
      reason: 'storage_unavailable',
    };
  }

  const trimmed = items.slice(0, MAX_LIBRARY_ITEMS);
  const serialize = (subset: SavedLibraryEntry[]) =>
    JSON.stringify({
      version: LIBRARY_STORAGE_VERSION,
      items: subset,
    } satisfies LibraryStorageEnvelope);

  try {
    target.setItem(LIBRARY_STORAGE_KEY, serialize(trimmed));
    return { ok: true, savedCount: trimmed.length, droppedForQuota: 0 };
  } catch {
    // First try stripping cached visual guides (re-generatable) before dropping any saved video
    const withoutVisualGuides = trimmed.map((entry) => ({
      ...entry,
      visualGuidesByLang: {},
    }));
    try {
      target.setItem(LIBRARY_STORAGE_KEY, serialize(withoutVisualGuides));
      return { ok: true, savedCount: withoutVisualGuides.length, droppedForQuota: 0 };
    } catch {
      // Progressive trim of oldest items if browser storage quota is still full
      for (let limit = withoutVisualGuides.length - 1; limit >= 1; limit--) {
        try {
          target.setItem(LIBRARY_STORAGE_KEY, serialize(withoutVisualGuides.slice(0, limit)));
          return {
            ok: true,
            savedCount: limit,
            droppedForQuota: trimmed.length - limit,
            reason: 'quota_trimmed',
          };
        } catch {
          // Keep trying smaller subset
        }
      }
      return {
        ok: false,
        savedCount: 0,
        droppedForQuota: trimmed.length,
        reason: 'quota_exceeded',
      };
    }
  }
}
