import type { BookingDto, ValidationError } from '@kelmer/shared';
import { getAccessToken } from './auth';

export interface Session {
  user: { id: string; name: string };
  room: { name: string; capacity: number };
  timeZone: string;
  serverTime: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public clash?: ValidationError['clash']) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? 'Something went wrong. Try again.', err.clash);
  }
  return data as T;
}

export const api = {
  session: () => request<Session>('GET', '/api/me'),
  bookings: (from: string, to: string) =>
    request<{ bookings: BookingDto[] }>('GET', `/api/bookings?from=${from}&to=${to}`).then(r => r.bookings),
  mine: () => request<{ bookings: BookingDto[] }>('GET', '/api/my-bookings').then(r => r.bookings),
  create: (b: { title: string; startsAt: string; endsAt: string; attendees: number }) =>
    request<{ booking: BookingDto }>('POST', '/api/bookings', b).then(r => r.booking),
  cancel: (id: string) => request<void>('DELETE', `/api/bookings/${encodeURIComponent(id)}`),
};
