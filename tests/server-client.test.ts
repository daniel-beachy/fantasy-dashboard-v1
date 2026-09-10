import { describe, expect, it, vi } from 'vitest';
import { EspnClient } from '../server/espn';

const swid = '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}';
const credentials = { swid, espnS2: 'valid-test-only-cookie' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('read-only ESPN transport', () => {
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
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not accept a public fan response as credential validation', async () => {
    const client = new EspnClient(vi.fn<typeof fetch>().mockImplementation(async () => json({ id: swid, preferences: [] })));
    await expect(client.validate(credentials)).rejects.toThrow(/verify|verification/i);
  });
  it('accepts verified cookie-only fan identity but never returns cookies', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Headers(init?.headers).has('cookie') ? json({ id: swid, preferences: [] }) : json({}, 401));
    const result = await new EspnClient(transport).validate(credentials);
    expect(result).toMatchObject({ id: swid });
    expect(JSON.stringify(result)).not.toContain(credentials.espnS2);
  });
  it('redacts upstream failures and rejects redirects without leaking credentials', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error(`request ${swid} ${credentials.espnS2}`));
    await expect(new EspnClient(transport).league(credentials, '123', 2026)).rejects.not.toThrow(credentials.espnS2);
    await expect(new EspnClient(async () => json({ secret: credentials.espnS2 }, 403)).league(credentials, '123', 2026)).rejects.toThrow(/ESPN/i);
  });
  it('rejects invalid cookie values and arbitrary league URLs before network access', async () => {
    const transport = vi.fn<typeof fetch>();
    const client = new EspnClient(transport);
    await expect(client.validate({ swid, espnS2: 'abc; injected=x' })).rejects.toThrow();
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
