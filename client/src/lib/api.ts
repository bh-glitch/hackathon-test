import type { CreateRoomRequest, Room, SessionResponse } from '../../../shared/types';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin' });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : `Request failed (${response.status})`;
    throw new Error(error);
  }
  return response.json() as Promise<T>;
}
let sessionRequest: Promise<SessionResponse> | null = null;
/** Share in-flight bootstrap calls, including React StrictMode's repeated effects. */
export function createSession(): Promise<SessionResponse> {
  sessionRequest ??= request<SessionResponse>('/api/session', { method: 'POST' })
    .finally(() => { sessionRequest = null; });
  return sessionRequest;
}
export const createRoom = (input: CreateRoomRequest) => request<Room>('/api/rooms', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
export const getRoom = (roomId: string) => request<Room>(`/api/rooms/${encodeURIComponent(roomId)}`);
