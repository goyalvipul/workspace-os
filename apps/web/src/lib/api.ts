export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: Record<string, unknown>,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}
export class NetworkError extends Error {
  constructor(message = 'You appear to be offline') {
    super(message);
  }
}

let csrf = '';
let onUnauthenticated: (() => void) | null = null;
export const setCsrf = (t: string) => {
  csrf = t;
};
export const setUnauthenticatedHandler = (fn: () => void) => {
  onUnauthenticated = fn;
};

export interface ApiOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError();
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: { field: string; message: string }[] } } | null)?.error;
    if (res.status === 401 && !path.startsWith('/auth/') && !path.startsWith('/bootstrap/')) onUnauthenticated?.();
    if (res.status >= 502 && res.status <= 504 && !err) throw new NetworkError('The server is unreachable');
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status})`, (err ?? {}) as Record<string, unknown>, err?.details);
  }
  return data as T;
}

export async function download(path: string, filename: string, method = 'GET', body?: unknown): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new ApiError(res.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong');
