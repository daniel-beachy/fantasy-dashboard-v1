import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { createApp } from '../server/app';
import { DashboardService } from '../server/service';
import type { LoginResult } from '../server/auth';
import type { EspnGateway } from '../server/espn';

const swid = '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}';
const input = { swid, espnS2: 'test-cookie-never-returned', leagueIds: ['123'], season: 2026 };
const raw = (id = 123) => ({
  id, seasonId: 2026, scoringPeriodId: 1,
  settings: { name: `League ${id}`, scheduleSettings: { matchupPeriods: { '1': [1] } } },
  status: { latestScoringPeriod: 1, currentMatchupPeriod: 1 },
  teams: [{ id: 1, name: 'Owned', owners: [swid], roster: { entries: [] } }, { id: 2, name: 'Other', owners: ['other'] }],
  schedule: [{ matchupPeriodId: 1, home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 } }],
});
const gateway = (): EspnGateway => ({
  profile: vi.fn().mockResolvedValue({ id: swid, preferences: [] }),
  discover: vi.fn().mockResolvedValue({ leagueIds: ['123'], warning: 'Enumeration may be incomplete. Add missing league IDs.' }),
  league: vi.fn().mockImplementation(async (_credentials, id) => raw(Number(id))),
  currentWeek: vi.fn().mockResolvedValue(1),
  scoreboard: vi.fn().mockResolvedValue([]),
});
const servers: Server[] = [];
const services: DashboardService[] = [];
async function setup(client = gateway(), login?: (signal: AbortSignal) => Promise<LoginResult>) {
  const service = new DashboardService({ client, login, now: () => new Date('2026-09-09T20:00:00Z') });
  services.push(service);
  const server = createApp(service).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const origin = `http://127.0.0.1:${address.port}`;
  const session = await (await fetch(`${origin}/api/session`)).json();
  const post = (path: string, body: unknown = {}, headers = {}) => fetch(`${origin}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Dashboard-Token': session.csrfToken, ...headers }, body: JSON.stringify(body),
  });
  return { service, server, origin, session, post, client };
}
afterEach(async () => {
  await Promise.all(services.splice(0).map(s => s.logout()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('localhost API boundary and lifecycle', () => {
  it('returns memory-only session state and a cryptographically sized CSRF token', async () => {
    const { session, origin } = await setup();
    expect(session).toMatchObject({ authenticated: false, loginPending: false });
    expect(session.csrfToken.length).toBeGreaterThanOrEqual(43);
    const response = await fetch(`${origin}/api/leagues`);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects cross-origin GETs, DNS-rebinding Host, same-site other ports, and absent mutation origin/token', async () => {
    const { origin, post } = await setup();
    const blockedHeaders: Record<string, string>[] = [{ Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://localhost:9999' }];
    for (const headers of blockedHeaders) {
      expect((await fetch(`${origin}/api/session`, { headers })).status, JSON.stringify(headers)).toBe(403);
    }
    const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
      httpRequest(`${origin}/api/session`, { headers: { Host: 'evil.test' } }, response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      }).on('error', reject).end();
    });
    expect(rebindingStatus).toBe(403);
    expect((await post('/api/login', {}, { 'X-Dashboard-Token': '' })).status).toBe(403);
    expect((await post('/api/login', {}, { Origin: '' })).status).toBe(403);
    expect((await post('/api/login', {}, { Origin: 'null' })).status).toBe(403);
  });
  it('validates imported cookies, enforces ownership, and emits exact data shapes without secrets', async () => {
    const { post, origin } = await setup();
    expect((await post('/api/connect', { ...input, espnS2: 'x\r\nCookie: injected' })).status).toBe(400);
    expect((await post('/api/connect', input)).status).toBe(200);
    expect((await post('/api/leagues', { leagueId: '123', teamId: 2 })).status).toBe(403);
    const leagues = await (await fetch(`${origin}/api/leagues`)).json();
    expect(leagues.leagues[0]).toMatchObject({ id: '123', teamId: 1 });
    const response = await fetch(`${origin}/api/dashboard`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ source: 'espn', season: 2026, week: 1 });
    expect(JSON.stringify(body)).not.toContain(input.espnS2);
    expect((await post('/api/logout')).status).toBe(200);
    expect((await fetch(`${origin}/api/dashboard`)).status).toBe(401);
  });
  it('does not save a connection when profile lookup fails', async () => {
    const client = gateway();
    vi.mocked(client.profile).mockRejectedValue(new Error(input.espnS2));
    const { post, service } = await setup(client);
    const response = await post('/api/connect', input);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain(input.espnS2);
    expect(service.status().authenticated).toBe(false);
  });
  it('starts login immediately, and logout prevents a late cookie capture from restoring auth', async () => {
    let finish!: (result: LoginResult) => void;
    let observedSignal: AbortSignal | undefined;
    const login = (signal: AbortSignal) => { observedSignal = signal; return new Promise<LoginResult>(resolve => { finish = resolve; }); };
    const { post, service } = await setup(gateway(), login);
    expect((await post('/api/login')).status).toBe(200);
    expect(service.status().loginPending).toBe(true);
    await post('/api/logout');
    expect(observedSignal?.aborted).toBe(true);
    finish({ credentials: input, leagueIds: ['123'] });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(service.status().authenticated).toBe(false);
    expect(service.status().loginPending).toBe(false);
  });
  it('clears pending login on failure with a safe actionable error', async () => {
    const { post, service } = await setup(gateway(), async () => { throw new Error(input.espnS2); });
    await post('/api/login');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(service.status()).toMatchObject({ authenticated: false, loginPending: false });
    expect(service.status().loginError).toBeTruthy();
    expect(service.status().loginError).not.toContain(input.espnS2);
  });
  it('preserves successful leagues on partial failure, caches requests and fails if none succeed', async () => {
    const client = gateway();
    const { post, origin } = await setup(client);
    await post('/api/connect', { ...input, leagueIds: ['123', '456'] });
    vi.mocked(client.league).mockImplementation(async (_credentials, id) => {
      if (id === '456') throw new Error(input.espnS2);
      return raw();
    });
    const data = await (await fetch(`${origin}/api/dashboard`)).json();
    expect(data.leagues).toHaveLength(1);
    expect(data.warnings.join(' ')).toContain('456');
    expect(JSON.stringify(data)).not.toContain(input.espnS2);
    const calls = vi.mocked(client.league).mock.calls.length;
    await fetch(`${origin}/api/dashboard`);
    expect(vi.mocked(client.league).mock.calls.length).toBe(calls);
    vi.mocked(client.league).mockRejectedValue(new Error('offline'));
    expect((await fetch(`${origin}/api/dashboard?week=2`)).status).toBe(502);
  });
  it('rejects malformed JSON, extra fields and invalid dashboard query values', async () => {
    const { post, origin, session } = await setup();
    expect((await post('/api/login', { password: 'not-accepted' })).status).toBe(400);
    expect((await fetch(`${origin}/api/dashboard?week=0`)).status).toBe(400);
    const malformed = await fetch(`${origin}/api/connect`, { method: 'POST', headers: { Origin: origin, 'X-Dashboard-Token': session.csrfToken, 'Content-Type': 'application/json' }, body: '{' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON request body.' });
  });
  it('applies same-origin safeguards to frontend requests without leaking error stacks', async () => {
    const { origin } = await setup();
    const result = await fetch(origin, { headers: { Origin: 'https://evil.test' } });
    expect(result.status).toBe(403);
    expect(result.headers.get('content-type')).toContain('application/json');
    expect(await result.text()).not.toContain('server\\');
  });
  it('does not restore cookies if an in-flight connect finishes after logout', async () => {
    const client = gateway();
    let finish!: (profile: unknown) => void;
    vi.mocked(client.profile).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { service } = await setup(client);
    const connecting = service.connect(input);
    const assertion = expect(connecting).rejects.toThrow(/session changed/i);
    await service.logout();
    finish({ id: swid });
    await assertion;
    expect(service.status().authenticated).toBe(false);
  });
  it('allows manual league fallback when automatic discovery is empty', async () => {
    const client = gateway();
    vi.mocked(client.discover).mockResolvedValue({ leagueIds: [], warning: 'Add missing league IDs.' });
    const { post, origin } = await setup(client);
    expect((await post('/api/connect', { swid, espnS2: input.espnS2 })).status).toBe(200);
    expect((await fetch(`${origin}/api/dashboard`)).status).toBe(400);
    expect((await post('/api/leagues', { leagueId: '123' })).status).toBe(200);
    expect((await fetch(`${origin}/api/dashboard`)).status).toBe(200);
  });
  it('retains valid fantasy data with an explicit warning when the NFL schedule fails', async () => {
    const client = gateway();
    vi.mocked(client.scoreboard).mockRejectedValue(new Error('network'));
    const { post, origin } = await setup(client);
    await post('/api/connect', input);
    const data = await (await fetch(`${origin}/api/dashboard`)).json();
    expect(data.leagues).toHaveLength(1);
    expect(data.games).toEqual([]);
    expect(data.warnings.join(' ')).toMatch(/NFL schedule is unavailable/i);
  });
});
