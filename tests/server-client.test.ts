import { describe, expect, it, vi } from 'vitest';
import { EspnClient } from '../server/espn';
import { DashboardService } from '../server/service';
import { fixtureLeague } from './helpers/espn';

const swid = '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}';
const credentials = { swid, espnS2: 'valid-test-only-cookie' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('read-only ESPN transport', () => {
  it('binds the native fetch receiver for the Cloudflare runtime', async () => {
    vi.stubGlobal('fetch', function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation: incorrect fetch receiver.');
      return Promise.resolve(json({ id: 123, seasonId: 2026, teams: [] }));
    });
    try {
      await expect(new EspnClient().league(credentials, '123', 2026)).resolves.toMatchObject({ id: 123 });
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses fixed read-only hosts, bounded requests and correct box-score filters', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ id: 123, seasonId: 2026, teams: [] }));
    const client = new EspnClient(transport);
    await client.league(credentials, '123', 2026, 3, 2);
    const [url, options] = transport.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.hostname).toBe('lm-api-reads.fantasy.espn.com');
    expect(parsed.searchParams.getAll('view')).toContain('mScoreboard');
    expect(parsed.searchParams.get('scoringPeriodId')).toBe('3');
    expect(new Headers(options?.headers).get('x-fantasy-filter')).toContain('"value":[2]');
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it('loads only league metadata during discovery and team selection', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ id: 123, seasonId: 2026, teams: [] }));
    await new EspnClient(transport).league(credentials, '123', 2026);
    expect(new URL(String(transport.mock.calls[0][0])).searchParams.getAll('view')).toEqual(['mTeam', 'mSettings']);
  });
  it('reads the matching public Fan profile for discovery without requiring anonymous denial', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => json({ id: swid, preferences: [] }));
    const client = new EspnClient(transport);
    await expect(client.profile(credentials)).resolves.toMatchObject({ id: swid });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('includes the supplied cookies in the profile request but never returns them', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Headers(init?.headers).has('cookie') ? json({ id: swid, preferences: [] }) : json({}, 401));
    const result = await new EspnClient(transport).profile(credentials);
    expect(result).toMatchObject({ id: swid });
    expect(JSON.stringify(result)).not.toContain(credentials.espnS2);
  });
  it('rejects a missing or mismatched profile rather than using another account for discovery', async () => {
    for (const profile of [{}, { id: '{11111111-2222-3333-4444-555555555555}' }]) {
      const client = new EspnClient(async () => json(profile));
      await expect(client.profile(credentials)).rejects.toThrow(/SWID|profile/i);
    }
  });
  it('redacts upstream failures and rejects redirects without leaking credentials', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error(`request ${swid} ${credentials.espnS2}`));
    await expect(new EspnClient(transport).league(credentials, '123', 2026)).rejects.not.toThrow(credentials.espnS2);
    await expect(new EspnClient(async () => json({ secret: credentials.espnS2 }, 403)).league(credentials, '123', 2026)).rejects.toThrow(/ESPN/i);
  });

  describe('cookie import with a publicly readable ESPN profile', () => {
    const profile = {
      id: swid,
      preferences: [{ metaData: { entry: { gameId: 1, seasonId: 2026, groups: [{ groupId: 123 }] } } }],
    };
    function transport(allowLeague: boolean, discover = true) {
      return vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
        if (new URL(String(url)).hostname === 'fan.api.espn.com') return json(discover ? profile : { id: swid });
        const cookie = new Headers(options?.headers).get('Cookie');
        if (!allowLeague || !cookie?.includes(`espn_s2=${credentials.espnS2}`)) return json({}, 401);
        return json(fixtureLeague());
      });
    }
    it('connects an owned league with working cookies even when its Fan profile is public', async () => {
      const fetcher = transport(true);
      const service = new DashboardService({ client: new EspnClient(fetcher) });
      await service.connect({ ...credentials, season: 2026 });
      expect(service.leagues()).toMatchObject([{ id: '123', teamId: 1 }]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it('rejects a connection when ESPN denies every discovered league despite a public profile', async () => {
      const fetcher = transport(false);
      const service = new DashboardService({ client: new EspnClient(fetcher) });
      await expect(service.connect({ ...credentials, season: 2026 })).rejects.toMatchObject({ status: 401 });
      expect(fetcher.mock.calls.some(([url]) => new URL(String(url)).hostname === 'lm-api-reads.fantasy.espn.com')).toBe(true);
      expect(service.status().authenticated).toBe(false);
      expect(service.exportState().credentials).toBeUndefined();
    });
    it('keeps manual setup available without claiming league access before a league is checked', async () => {
      const service = new DashboardService({ client: new EspnClient(transport(false, false)) });
      await service.connect({ ...credentials, season: 2026 });
      expect(service.leagues()).toEqual([]);
      expect(service.status().discoveryWarning).toMatch(/access.*not.*verified/i);
      await expect(service.selectLeague({ leagueId: '123' })).rejects.toMatchObject({ status: 401 });
      expect(service.leagues()).toEqual([]);
      await expect(service.dashboard()).rejects.toMatchObject({ status: 400 });
    });
  });
  it('rejects redirected account requests without following the location', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://other.example/collect' } }));
    await expect(new EspnClient(transport).league(credentials, '123', 2026)).rejects.toThrow(/redirect/i);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.redirect).toBe('manual');
  });
  it('uses the alternate ESPN public schedule host when the primary denies cloud requests', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(json({ season: { year: 2026, type: 2 }, week: { number: 1 }, events: [] }));
    expect(await new EspnClient(transport).scoreboard(2026, 1)).toEqual([]);
    expect(new URL(String(transport.mock.calls[1][0])).hostname).toBe('site.web.api.espn.com');
    for (const [, options] of transport.mock.calls) expect(new Headers(options?.headers).has('Cookie')).toBe(false);
  });
  it('rejects invalid cookie values and arbitrary league URLs before network access', async () => {
    const transport = vi.fn<typeof fetch>();
    const client = new EspnClient(transport);
    await expect(client.profile({ swid, espnS2: 'abc; injected=x' })).rejects.toThrow();
    await expect(client.league(credentials, 'https://evil.test', 2026)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('obtains an actual scoring period and verifies scoreboard season/week', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes('kona_game_state') ? json({ currentScoringPeriod: { id: 4 } }) : json({ season: { year: 2026, type: 2 }, week: { number: 4 }, events: [] }));
    const client = new EspnClient(transport);
    expect(await client.currentWeek(2026)).toBe(4);
    expect(await client.scoreboard(2026, 4)).toEqual([]);
    transport.mockResolvedValue(json({ season: { year: 2025, type: 2 }, week: { number: 4 }, events: [] }));
    await expect(client.scoreboard(2026, 4)).rejects.toThrow(/season|week/i);
  });
});
