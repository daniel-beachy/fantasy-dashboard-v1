import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from '../server/service';
import type { EspnGateway } from '../server/espn';
import { fixtureLeague as league, SWID } from './helpers/espn';

const credentials = { swid: SWID, espnS2: 'fixture-espn-session' };
const gateway = (): EspnGateway => ({
  validate: vi.fn().mockResolvedValue({ id: credentials.swid }),
  discover: vi.fn().mockResolvedValue({ leagueIds: ['123'], warning: 'Add missing leagues.' }),
  league: vi.fn().mockImplementation(async (_credentials, id) => league(Number(id))),
  currentWeek: vi.fn().mockResolvedValue(1),
  scoreboard: vi.fn().mockResolvedValue([]),
});

describe('portable dashboard state', () => {
  it('restores authenticated leagues after the server instance is replaced', async () => {
    const client = gateway();
    const first = new DashboardService({ client });
    await first.connect({ ...credentials, season: 2026 });
    const state = first.exportState();
    const second = new DashboardService({ client, state });
    expect(second.status().authenticated).toBe(true);
    expect(second.leagues()).toEqual(first.leagues());
    expect((await second.dashboard()).leagues[0].name).toBe('Fixture League');
    expect(second.status()).not.toHaveProperty('credentials');
  });
  it('copies snapshot state rather than retaining mutable references', async () => {
    const first = new DashboardService({ client: gateway() });
    await first.connect({ ...credentials, season: 2026 });
    const state = first.exportState();
    state.selections.length = 0;
    expect(first.leagues()).toHaveLength(1);
  });
  it('rejects malformed stored credentials and unsupported state versions', () => {
    expect(() => new DashboardService({ state: { version: 2 } })).toThrow(/stored dashboard/i);
    expect(() => new DashboardService({ state: { version: 1, credentials: { ...credentials, espnS2: 'bad;\r\n' }, selections: [] } })).toThrow(/stored dashboard/i);
  });
  it('bounds automatic discovery for constrained hosted requests and warns about omitted leagues', async () => {
    const client = gateway();
    vi.mocked(client.discover).mockResolvedValue({ leagueIds: ['123', '456', '789'], warning: '' });
    const service = new DashboardService({ client, maxAutoLeagues: 2 });
    await service.connect({ ...credentials, season: 2026 });
    expect(service.leagues()).toHaveLength(2);
    expect(service.status().discoveryWarning).toMatch(/first 2/i);
  });
  it('disconnected snapshots contain no ESPN credentials or leagues', async () => {
    const service = new DashboardService({ client: gateway() });
    await service.connect({ ...credentials, season: 2026 });
    await service.logout();
    const state = service.exportState();
    expect(state.credentials).toBeUndefined();
    expect(state.selections).toEqual([]);
  });
});
