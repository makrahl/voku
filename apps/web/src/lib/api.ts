/**
 * Thin typed wrapper over fetch. Every call goes through here so error shapes
 * and credential handling are decided in one place.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const payload = parsed as { error?: string; details?: unknown } | null;
    throw new ApiError(
      res.status,
      payload?.error ?? `Request failed (${res.status})`,
      payload?.details,
    );
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export const admin = (path: string) => `/api/admin${path}`;
export const student = (path: string) => `/api/s${path}`;

/** Polls a background job to completion, reporting progress along the way. */
export async function waitForJob<T>(
  jobId: string,
  onProgress?: (progress: number, total: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  for (;;) {
    if (signal?.aborted) throw new Error('cancelled');
    const job = await api.get<{
      status: string;
      progress: number;
      total: number;
      error: string | null;
      result: T;
    }>(admin(`/jobs/${jobId}`));

    onProgress?.(job.progress, job.total);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new ApiError(502, job.error ?? 'The job failed');
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}
