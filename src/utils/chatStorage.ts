import type { VideoChatCitation, VideoChatMessage } from '../types/mindflow';

export const CHAT_STORAGE_KEY = 'mindflow_chat_history_v2';
export const LEGACY_SESSION_CHAT_KEY = 'mindflow_chat_history_v1';
export const CHAT_STORAGE_VERSION = 2;

export const MAX_STORED_CHAT_VIDEOS = 15;
export const MAX_MESSAGES_PER_VIDEO = 30;
export const MAX_MESSAGE_CONTENT_CHARS = 3000;
export const MAX_CITATIONS_PER_MESSAGE = 5;
export const MAX_TOTAL_STORAGE_CHARS = 180000;

export interface StoredVideoChatThread {
  updatedAt: number;
  messages: VideoChatMessage[];
}

export interface PersistedChatStore {
  version: number;
  byVideo: Record<string, StoredVideoChatThread>;
}

function sanitizeCitations(raw: unknown): VideoChatCitation[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const cleaned: VideoChatCitation[] = [];
  for (const item of raw.slice(0, MAX_CITATIONS_PER_MESSAGE)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const label = typeof obj.label === 'string' ? obj.label.trim().slice(0, 16) : '';
    const seconds =
      typeof obj.seconds === 'number' && Number.isFinite(obj.seconds) && obj.seconds >= 0
        ? Math.floor(obj.seconds)
        : null;
    if (!label || seconds === null) continue;
    const topic =
      typeof obj.topic === 'string' && obj.topic.trim()
        ? obj.topic.trim().slice(0, 100)
        : undefined;
    cleaned.push(topic ? { label, seconds, topic } : { label, seconds });
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

export function sanitizeChatMessage(raw: unknown): VideoChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const role = obj.role === 'user' || obj.role === 'assistant' ? obj.role : null;
  const content =
    typeof obj.content === 'string'
      ? obj.content.trim().slice(0, MAX_MESSAGE_CONTENT_CHARS)
      : '';
  if (!role || !content) return null;

  const id =
    typeof obj.id === 'string' && obj.id.trim()
      ? obj.id.trim().slice(0, 64)
      : `${role[0]}-${Date.now()}`;
  const createdAt =
    typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) && obj.createdAt > 0
      ? Math.floor(obj.createdAt)
      : Date.now();
  const citations = sanitizeCitations(obj.citations);
  const isError = obj.isError === true ? true : undefined;
  const failedQuestion =
    isError && typeof obj.failedQuestion === 'string' && obj.failedQuestion.trim()
      ? obj.failedQuestion.trim().slice(0, 600)
      : undefined;

  return {
    id,
    role,
    content,
    ...(citations ? { citations } : {}),
    ...(isError ? { isError } : {}),
    ...(failedQuestion ? { failedQuestion } : {}),
    createdAt,
  };
}

export function createEmptyChatStore(): PersistedChatStore {
  return {
    version: CHAT_STORAGE_VERSION,
    byVideo: {},
  };
}

/**
 * Enforces video count, per-video message count, and total serialized byte budgets
 * by keeping the most recently active conversations first.
 */
export function pruneChatStore(
  store: PersistedChatStore,
  options?: {
    maxVideos?: number;
    maxMessagesPerVideo?: number;
    maxTotalChars?: number;
  }
): PersistedChatStore {
  const maxVideos = options?.maxVideos ?? MAX_STORED_CHAT_VIDEOS;
  const maxMsgs = options?.maxMessagesPerVideo ?? MAX_MESSAGES_PER_VIDEO;
  const maxChars = options?.maxTotalChars ?? MAX_TOTAL_STORAGE_CHARS;

  const entries = Object.entries(store.byVideo)
    .map(([videoId, thread]) => {
      const cleanId = videoId.trim().slice(0, 80);
      const messages = (Array.isArray(thread?.messages) ? thread.messages : [])
        .map(sanitizeChatMessage)
        .filter((m): m is VideoChatMessage => m !== null)
        .slice(-maxMsgs);
      const updatedAt =
        typeof thread?.updatedAt === 'number' && Number.isFinite(thread.updatedAt)
          ? thread.updatedAt
          : messages[messages.length - 1]?.createdAt ?? 0;
      return { videoId: cleanId, updatedAt, messages };
    })
    .filter((entry) => entry.videoId.length > 0 && entry.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxVideos);

  // Build final map and drop oldest threads if total serialized size exceeds budget
  let kept = entries;
  while (kept.length > 0) {
    const candidate: PersistedChatStore = {
      version: CHAT_STORAGE_VERSION,
      byVideo: Object.fromEntries(
        kept.map((e) => [e.videoId, { updatedAt: e.updatedAt, messages: e.messages }])
      ),
    };
    const serialized = JSON.stringify(candidate);
    if (serialized.length <= maxChars) {
      return candidate;
    }
    // If even 1 thread exceeds budget, trim its oldest messages
    if (kept.length === 1 && kept[0].messages.length > 2) {
      kept = [
        {
          ...kept[0],
          messages: kept[0].messages.slice(Math.ceil(kept[0].messages.length / 2)),
        },
      ];
    } else {
      kept = kept.slice(0, -1);
    }
  }

  return createEmptyChatStore();
}

/**
 * Safely parses stored JSON from localStorage (v2) or legacy sessionStorage (v1).
 * Handles corrupt JSON, wrong types, or unknown schema versions without throwing.
 */
export function parseStoredChatPayload(raw: string | null | undefined): PersistedChatStore {
  if (!raw || typeof raw !== 'string') return createEmptyChatStore();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return createEmptyChatStore();
    }
    const obj = parsed as Record<string, unknown>;

    // Versioned v2 format
    if (obj.version === CHAT_STORAGE_VERSION && obj.byVideo && typeof obj.byVideo === 'object') {
      const rawByVideo = obj.byVideo as Record<string, unknown>;
      const byVideo: Record<string, StoredVideoChatThread> = {};
      for (const [vid, val] of Object.entries(rawByVideo)) {
        if (!val || typeof val !== 'object') continue;
        const threadObj = val as Record<string, unknown>;
        const rawMsgs = Array.isArray(threadObj.messages) ? threadObj.messages : [];
        const cleanMsgs = rawMsgs
          .map(sanitizeChatMessage)
          .filter((m): m is VideoChatMessage => m !== null);
        if (cleanMsgs.length > 0) {
          byVideo[vid] = {
            updatedAt:
              typeof threadObj.updatedAt === 'number' && Number.isFinite(threadObj.updatedAt)
                ? threadObj.updatedAt
                : cleanMsgs[cleanMsgs.length - 1].createdAt,
            messages: cleanMsgs,
          };
        }
      }
      return pruneChatStore({ version: CHAT_STORAGE_VERSION, byVideo });
    }

    // Reject unknown future/incompatible schema versions safely
    if ('version' in obj && obj.version !== 1) {
      return createEmptyChatStore();
    }

    // Legacy v1 flat Record<videoId, VideoChatMessage[]> migration support
    const byVideo: Record<string, StoredVideoChatThread> = {};
    for (const [vid, val] of Object.entries(obj)) {
      if (!Array.isArray(val)) continue;
      const cleanMsgs = val
        .map(sanitizeChatMessage)
        .filter((m): m is VideoChatMessage => m !== null);
      if (cleanMsgs.length > 0) {
        byVideo[vid] = {
          updatedAt: cleanMsgs[cleanMsgs.length - 1].createdAt,
          messages: cleanMsgs,
        };
      }
    }
    return pruneChatStore({ version: CHAT_STORAGE_VERSION, byVideo });
  } catch {
    return createEmptyChatStore();
  }
}

export function appendChatMessageToStore(
  store: PersistedChatStore,
  videoId: string,
  message: VideoChatMessage
): PersistedChatStore {
  const cleanId = videoId.trim();
  const cleanMsg = sanitizeChatMessage(message);
  if (!cleanId || !cleanMsg) return store;

  const existing = store.byVideo[cleanId]?.messages ?? [];
  const next: PersistedChatStore = {
    version: CHAT_STORAGE_VERSION,
    byVideo: {
      ...store.byVideo,
      [cleanId]: {
        updatedAt: cleanMsg.createdAt,
        messages: [...existing, cleanMsg],
      },
    },
  };
  return pruneChatStore(next);
}

export function removeChatMessageFromStore(
  store: PersistedChatStore,
  videoId: string,
  messageId: string
): PersistedChatStore {
  const existing = store.byVideo[videoId];
  if (!existing) return store;
  const filtered = existing.messages.filter((m) => m.id !== messageId);
  if (filtered.length === existing.messages.length) return store;
  if (filtered.length === 0) {
    return clearVideoChatFromStore(store, videoId);
  }
  return {
    version: CHAT_STORAGE_VERSION,
    byVideo: {
      ...store.byVideo,
      [videoId]: {
        updatedAt: existing.updatedAt,
        messages: filtered,
      },
    },
  };
}

/**
 * Finds the most recent failed assistant turn and its originating user question
 * so "Retry last question" works reliably even after reopening the chat or reloading.
 */
export function findLastFailedTurn(
  messages: VideoChatMessage[]
): { errorMessageId: string; question: string } | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || !last.isError) return null;

  if (typeof last.failedQuestion === 'string' && last.failedQuestion.trim()) {
    return { errorMessageId: last.id, question: last.failedQuestion.trim() };
  }

  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content.trim()) {
      return { errorMessageId: last.id, question: messages[i].content.trim() };
    }
  }
  return null;
}

export function clearVideoChatFromStore(
  store: PersistedChatStore,
  videoId: string
): PersistedChatStore {
  if (!store.byVideo[videoId]) return store;
  const nextByVideo = { ...store.byVideo };
  delete nextByVideo[videoId];
  return {
    version: CHAT_STORAGE_VERSION,
    byVideo: nextByVideo,
  };
}

export function getMessagesForVideo(
  store: PersistedChatStore,
  videoId: string
): VideoChatMessage[] {
  return store.byVideo[videoId]?.messages ?? [];
}

export function loadChatStoreFromStorage(storage?: Pick<Storage, 'getItem'>): PersistedChatStore {
  try {
    const target =
      storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return createEmptyChatStore();

    const raw = target.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      return parseStoredChatPayload(raw);
    }

    // One-time seamless migration from legacy sessionStorage if present
    if (!storage && typeof window !== 'undefined') {
      const legacyRaw = window.sessionStorage?.getItem(LEGACY_SESSION_CHAT_KEY);
      if (legacyRaw) {
        return parseStoredChatPayload(legacyRaw);
      }
    }

    return createEmptyChatStore();
  } catch {
    return createEmptyChatStore();
  }
}

export function saveChatStoreToStorage(
  store: PersistedChatStore,
  storage?: Pick<Storage, 'setItem'>
): boolean {
  try {
    const target =
      storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return false;

    let pruned = pruneChatStore(store);
    try {
      target.setItem(CHAT_STORAGE_KEY, JSON.stringify(pruned));
      return true;
    } catch {
      // Progressive fallback if browser storage quota is tight
      for (const maxVideos of [10, 5, 2, 1]) {
        try {
          pruned = pruneChatStore(pruned, {
            maxVideos,
            maxMessagesPerVideo: Math.min(16, MAX_MESSAGES_PER_VIDEO),
          });
          target.setItem(CHAT_STORAGE_KEY, JSON.stringify(pruned));
          return true;
        } catch {
          // Keep trimming
        }
      }
      return false;
    }
  } catch {
    return false;
  }
}
