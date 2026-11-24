export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? 'same-origin',
  });

  if (response.status === 401) {
    const payload = (await response.clone().json().catch(() => null)) as
      | { code?: string }
      | null;
    if (payload?.code === 'AUTH_REQUIRED') {
      window.dispatchEvent(new Event('mindflow:auth-required'));
    }
  }

  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (
    response.ok &&
    requestUrl.startsWith('/api/') &&
    !requestUrl.startsWith('/api/auth/') &&
    requestUrl !== '/api/health'
  ) {
    window.dispatchEvent(new Event('mindflow:usage-updated'));
  }

  return response;
}
