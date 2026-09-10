import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '../src/data/demo';
import type { DashboardData } from '../src/types';

const selection = (id: string) => ({ id, name: `League ${id}`, teamId: 1, teams: [{ id: 1, name: 'My team', owned: true }] });
const snapshot = (id: string, changes: Partial<DashboardData> = {}): DashboardData => ({
  ...demoData, source: 'espn', leagues: [{ ...demoData.leagues[0], id }],
  players: [{ ...demoData.players[0], id: `${id}-player`, leagueId: id }],
  warnings: ['Shared warning'], ...changes,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function client(cloud = true) {
  const { api } = await import('../src/lib/api');
  await api.session();
  expect(api.isCloud).toBe(cloud);
  return api;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('hosted dashboard client', () => {
  it('combines owned leagues, unique games and warnings using the oldest successful timestamp', async () => {
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      paths.push(path);
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf', authenticated: true, vaultAuthenticated: true, loginPending: false });
      if (path.endsWith('leagues')) return json({ leagues: [selection('1'), selection('2')] });
      return json(snapshot(new URL(path, 'https://hq.example').searchParams.get('leagueId')!, {
        fetchedAt: path.endsWith('1') ? '2026-09-10T12:00:00Z' : '2026-09-10T12:00:15Z',
      }));
    }));
    const api = await client();
    const result = await api.dashboard();
    expect(result.leagues.map(league => league.id)).toEqual(['1', '2']);
    expect(result.players).toHaveLength(2);
    expect(result.games).toHaveLength(demoData.games.length);
    expect(result.warnings).toEqual(['Shared warning']);
    expect(result.fetchedAt).toBe('2026-09-10T12:00:00Z');
    expect(paths).toEqual(['/api/session', '/api/leagues', '/api/dashboard?leagueId=1', '/api/dashboard?leagueId=2']);
  });

  it('limits concurrent league requests to four', async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      if (path.endsWith('leagues')) return json({ leagues: Array.from({ length: 9 }, (_, i) => selection(String(i))) });
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return json(snapshot(new URL(path, 'https://hq.example').searchParams.get('leagueId')!));
    }));
    expect((await (await client()).dashboard()).leagues).toHaveLength(9);
    expect(peak).toBe(4);
  });

  it('retains successful leagues and exposes failed-league warnings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      if (path.endsWith('leagues')) return json({ leagues: [selection('1'), selection('2')] });
      return path.endsWith('1') ? json(snapshot('1')) : json({ error: 'ESPN unavailable.' }, 502);
    }));
    const result = await (await client()).dashboard();
    expect(result.leagues).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/League 2.*ESPN unavailable/);
  });

  it.each([['week', 9], ['season', 2027]] as const)('rejects mismatched %s instead of mixing snapshots', async (field, value) => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      if (path.endsWith('leagues')) return json({ leagues: [selection('1'), selection('2')] });
      return json(snapshot(path.slice(-1), path.endsWith('2') ? { [field]: value } : {}));
    }));
    await expect((await client()).dashboard()).rejects.toThrow(/different seasons or weeks/i);
  });

  it('propagates session expiration even when another league succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      if (path.endsWith('leagues')) return json({ leagues: [selection('1'), selection('2')] });
      return path.endsWith('1') ? json(snapshot('1')) : json({ error: 'Session expired. Sign in again.' }, 401);
    }));
    await expect((await client()).dashboard()).rejects.toMatchObject({ status: 401 });
  });

  it('propagates cancellation to league discovery and all in-flight requests', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      signals.push(init.signal as AbortSignal);
      if (path.endsWith('leagues')) return json({ leagues: [selection('1'), selection('2')] });
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
    }));
    const api = await client();
    const controller = new AbortController();
    const result = api.dashboard(controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(signals).toHaveLength(3));
    controller.abort();
    await rejected;
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('does not turn an aborted request timeout into partial success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      if (path.endsWith('leagues')) return json({ leagues: [selection('1'), selection('2')] });
      if (path.endsWith('2')) throw new DOMException('The operation timed out.', 'TimeoutError');
      return json(snapshot('1'));
    }));
    await expect((await client()).dashboard()).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('fails when no league succeeds or the owned list is empty', async () => {
    let empty = false;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      if (path.endsWith('leagues')) return json({ leagues: empty ? [] : [selection('1')] });
      return json({ error: 'ESPN unavailable.' }, 502);
    }));
    const api = await client();
    await expect(api.dashboard()).rejects.toThrow(/ESPN unavailable/);
    empty = true;
    await expect(api.dashboard()).rejects.toThrow(/league/i);
  });

  it('rejects invalid snapshot metadata without fabricating a dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.endsWith('session')) return json({ mode: 'cloud', csrfToken: 'csrf' });
      if (path.endsWith('leagues')) return json({ leagues: [selection('1')] });
      return json(snapshot('1', { fetchedAt: 'not-a-date' }));
    }));
    await expect((await client()).dashboard()).rejects.toThrow(/invalid.*dashboard/i);
  });

  it('preserves local single-request dashboards', async () => {
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      paths.push(path);
      return json(path.endsWith('session') ? { csrfToken: 'csrf', authenticated: true } : snapshot('1'));
    }));
    await (await client(false)).dashboard();
    expect(paths).toEqual(['/api/session', '/api/dashboard']);
  });

  it('recognizes a hosted build on a public hostname before the session probe', async () => {
    vi.stubGlobal('window', { location: { hostname: 'sunday-hq.example' } });
    vi.stubEnv('VITE_CLOUD_HOSTED', 'true');
    const { api } = await import('../src/lib/api');
    expect(api.isLocal).toBe(false);
    expect(api.isCloud).toBe(true);
    expect(api.canConnect).toBe(true);
  });
});
