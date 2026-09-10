import type { DashboardData, LeagueSelection, SessionStatus } from '../types';

const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
let csrfToken = '';

async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-Dashboard-Token': csrfToken } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new Error('The local ESPN companion is not running. Start it with npm run dev, then open http://127.0.0.1:3000.');
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Request failed (${response.status}). Try again.`);
  return result as T;
}
export const api = {
  isLocal: local,
  session: async () => {
    const result = await request<SessionStatus>('session');
    csrfToken = result.csrfToken;
    return result;
  },
  login: () => request<{ ok: boolean }>('login', {}),
  logout: () => request<{ ok: boolean }>('logout', {}),
  connect: (swid: string, espnS2: string) => request<{ ok: boolean }>('connect', { swid, espnS2 }),
  leagues: () => request<{ leagues: LeagueSelection[] }>('leagues'),
  addLeague: (leagueId: string, teamId?: number) => request('leagues', { leagueId, teamId }),
  dashboard: (signal?: AbortSignal) => request<DashboardData>('dashboard', undefined, signal),
};
