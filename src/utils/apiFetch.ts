/**
 * Thin fetch wrapper for MindFlow API calls.
 * - Adds the visitor's own Gemini key (if they saved one) as `x-user-gemini-key`,
 *   so their usage is billed to THEIR quota, not the site owner's.
 * - Fires `mindflow:quota-limit` when the free shared limit is reached so the UI can offer the key dialog.
 */
export const USER_GEMINI_KEY_STORAGE = 'mindflow_user_gemini_key_v1';

export function getStoredGeminiKey(): string {
  try {
    return (window.localStorage.getItem(USER_GEMINI_KEY_STORAGE) ?? '').trim();
  } catch {
    return '';
  }
}

export function saveStoredGeminiKey(key: string): void {
  try {
    const cleaned = key.trim();
    if (cleaned) window.localStorage.setItem(USER_GEMINI_KEY_STORAGE, cleaned);
    else window.localStorage.removeItem(USER_GEMINI_KEY_STORAGE);
  } catch {
    // Storage unavailable (private mode) — key just won't persist.
  }
  window.dispatchEvent(new Event('mindflow:key-changed'));
}

const QUOTA_CODES = new Set(['ANALYSIS_DAILY_LIMIT', 'USER_DAILY_LIMIT', 'GLOBAL_DAILY_LIMIT']);

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const ownKey = getStoredGeminiKey();
  if (ownKey && !headers.has('x-user-gemini-key')) {
    headers.set('x-user-gemini-key', ownKey);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status === 429) {
    const payload = (await response.clone().json().catch(() => null)) as { code?: string } | null;
    if (payload?.code && QUOTA_CODES.has(payload.code)) {
      window.dispatchEvent(new Event('mindflow:quota-limit'));
    }
  }
  return response;
}
