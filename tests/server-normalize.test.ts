import { describe, expect, it } from 'vitest';
import { currentSeason, leagueSelection, normalizeLeague, normalizeScoreboard, parseLeague, extractLeagueIds } from '../server/normalize';

const swid = '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}';
const stat = (overrides = {}) => ({ seasonId: 2026, scoringPeriodId: 3, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 12.5, stats: { '3': 250, '4': 1 }, ...overrides });
const entry = (id: number, slot = 0, overrides = {}) => ({
  lineupSlotId: slot, playerPoolEntry: { player: {
    id, fullName: `Player ${id}`, defaultPositionId: 1, proTeamId: 12,
    stats: [stat(), stat({ statSourceId: 1, appliedTotal: 19 }), stat({ scoringPeriodId: 0, appliedTotal: 999 }), stat({ seasonId: 2025, appliedTotal: 888 })],
    ...overrides,
  } },
});
const fixture = () => ({
  id: 123, seasonId: 2026, scoringPeriodId: 3,
  status: { currentMatchupPeriod: 2, latestScoringPeriod: 3 },
  settings: { name: 'Test League', scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] }, scheduleSettings: { matchupPeriods: { '1': [1], '2': [2, 3] } } },
  teams: [
    { id: 1, name: 'My Team', owners: [swid.toLowerCase().replace(/[{}]/g, '')], roster: { entries: [entry(999)] } },
    { id: 2, name: 'Opponent', owners: ['OTHER'], roster: { entries: [entry(998)] } },
  ],
  schedule: [
    { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 777 }, away: { teamId: 2, totalPoints: 777 } },
    { matchupPeriodId: 2, winner: 'UNDECIDED', home: { teamId: 1, totalPoints: 0, totalPointsLive: 0, rosterForCurrentScoringPeriod: { entries: [entry(1), entry(2, 20), entry(3, 21)] } }, away: { teamId: 2, rosterForCurrentScoringPeriod: { entries: [entry(1)] } } },
  ],
});

describe('ESPN normalization', () => {
  it('uses the previous NFL season during January and February', () => {
    expect(currentSeason(new Date('2027-02-05T12:00:00Z'))).toBe(2026);
    expect(currentSeason(new Date('2027-03-05T12:00:00Z'))).toBe(2027);
  });
  it('normalizes ownership and rejects selection of another owner’s team', () => {
    const raw = parseLeague(fixture());
    expect(leagueSelection(raw, swid).teamId).toBe(1);
    expect(() => leagueSelection(raw, swid, 2)).toThrow(/own/i);
  });
  it('selects the matchup period, excludes reserves, and keeps every player exposure', () => {
    const result = normalizeLeague(fixture(), { swid, season: 2026, week: 3, teamId: 1, games: [] });
    expect(result.league.score).toBe(0);
    expect(result.league.opponentScore).toBeNull();
    expect(result.league.projected).toBeNull();
    expect(result.players.map(p => p.id)).toEqual(['123-1-1', '123-2-1']);
    expect(result.players[0]).toMatchObject({ points: 12.5, projected: 19, position: 'QB', nflTeam: 'KC', gameId: null });
    expect(result.players[0].stats).toContainEqual({ label: 'Pass YDS', value: '250' });
    expect(result.warnings.join(' ')).toMatch(/multi.week/i);
  });
  it('never uses unweighted raw stats, wrong season, wrong split, or aggregate stats for points', () => {
    const raw = fixture();
    raw.schedule[1].home.rosterForCurrentScoringPeriod!.entries = [
      entry(4, 2, { stats: [stat({ appliedTotal: undefined }), stat({ statSplitTypeId: 0, appliedTotal: 999 }), stat({ scoringPeriodId: 0, appliedTotal: 1000 })] }),
    ];
    const result = normalizeLeague(raw, { swid, season: 2026, week: 3, games: [] });
    expect(result.players[0].points).toBeNull();
    expect(result.players[0].projected).toBeNull();
  });
  it('prefers per-week NFL team after a trade and links real games', () => {
    const raw = fixture();
    raw.schedule[1].home.rosterForCurrentScoringPeriod!.entries = [entry(1, 0, { stats: [stat({ proTeamId: 2 })] })];
    const result = normalizeLeague(raw, { swid, season: 2026, week: 3, games: [{ id: 'g', homeTeam: 'BUF', awayTeam: 'KC', kickoff: '2026-09-20T17:00:00Z', status: 'final', detail: 'Final' }] });
    expect(result.players[0].nflTeam).toBe('BUF');
    expect(result.players[0].gameId).toBe('g');
  });
  it('distinguishes an explicit bye from unavailable matchup data', () => {
    const raw = fixture();
    raw.schedule = [{ matchupPeriodId: 2, home: { teamId: 1, totalPoints: 0 } }] as ReturnType<typeof fixture>['schedule'];
    expect(normalizeLeague(raw, { swid, season: 2026, week: 3, games: [] }).league.matchupStatus).toBe('bye');
    raw.schedule = [];
    const missing = normalizeLeague(raw, { swid, season: 2026, week: 3, games: [] });
    expect(missing.league.opponentName).toMatch(/unavailable/i);
    expect(missing.warnings.join(' ')).toMatch(/matchup/i);
  });
  it('rejects malformed upstream shapes rather than trusting casts', () => {
    expect(() => parseLeague({ id: 123, teams: 'oops' })).toThrow(/format/i);
    expect(() => normalizeScoreboard({ events: {} })).toThrow(/format/i);
  });
  it('uses ESPN defaultPositionId rather than confusing it with lineup slot IDs', () => {
    const raw = fixture();
    raw.schedule[1].home.rosterForCurrentScoringPeriod!.entries = [
      entry(-16012, 16, { defaultPositionId: 16, stats: [stat({ stats: { '99': 3, '120': 7 } })] }),
      entry(3045282, 9, { defaultPositionId: 10 }),
      entry(3915189, 10, { defaultPositionId: 11 }),
      entry(3127287, 13, { defaultPositionId: 13 }),
    ];
    const result = normalizeLeague(raw, { swid, season: 2026, week: 3, games: [] });
    expect(result.players.slice(0, 4).map(p => p.position)).toEqual(['DST', 'DE', 'LB', 'S']);
    expect(result.players[0].headshot).toBeUndefined();
    expect(result.players[0].stats).toContainEqual({ label: 'SACK', value: '3' });
  });
  it('normalizes live, final, postponed and upcoming NFL games including scores and broadcasts', () => {
    const events = ['STATUS_IN_PROGRESS', 'STATUS_FINAL', 'STATUS_POSTPONED', 'STATUS_SCHEDULED'].map((name, index) => ({
      id: `${index}`, date: '2026-09-20T17:00Z',
      status: { type: { name, state: index === 0 ? 'in' : index === 1 ? 'post' : 'pre', completed: index === 1, detail: name } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { abbreviation: 'WSH' }, score: '0' },
        { homeAway: 'away', team: { abbreviation: 'JAC' }, score: '7' },
      ], broadcasts: [{ names: ['FOX'] }] }],
    }));
    const result = normalizeScoreboard({ events });
    expect(result.map(g => g.status)).toEqual(['live', 'final', 'postponed', 'upcoming']);
    expect(result[0]).toMatchObject({ homeTeam: 'WSH', awayTeam: 'JAX', homeScore: 0, awayScore: 7, broadcast: 'FOX' });
    expect(result[3].homeScore).toBeUndefined();
  });
  it('discovers only explicit current-season football links and structured league keys', () => {
    const result = extractLeagueIds({
      preferences: [
        { metaData: { entry: { gameId: 'ffl', seasonId: 2026, leagueId: 123 } } },
        { metaData: { entry: { gameId: 'fba', seasonId: 2026, leagueId: 999 } } },
        { href: 'https://fantasy.espn.com/football/team?leagueId=456&seasonId=2026' },
        { href: 'https://fantasy.espn.com/football/team?leagueId=888&seasonId=2025' },
        { href: 'https://evil.example/football/team?leagueId=111&seasonId=2026' },
      ],
    }, 2026);
    expect(result).toEqual(['123', '456']);
  });
  it('reads the real Fan API fantasy preference entry.groups contract', () => {
    expect(extractLeagueIds({ preferences: [
      { type: { code: 'fantasy' }, metaData: { entry: { gameId: 1, seasonId: 2026, entryId: 2, groups: [{ groupId: 123 }, { groupId: 456 }] } } },
      { type: { code: 'fantasy' }, metaData: { entry: { gameId: 3, seasonId: 2026, groups: [{ groupId: 888 }] } } },
      { type: { code: 'fantasy' }, metaData: { entry: { gameId: 1, seasonId: 2025, groups: [{ groupId: 999 }] } } },
      { metaData: { entry: { gameId: 1, seasonId: 2026, groups: [{ groupId: 'https://evil.test' }] } } },
    ] }, 2026)).toEqual(['123', '456']);
  });
  it('does not render stale week scores when ESPN ignored the requested scoring period', () => {
    expect(() => normalizeLeague(fixture(), { swid, season: 2026, week: 4, games: [] })).toThrow(/week|period/i);
  });
  it('does not infer final while a tracked player has no verified NFL game', () => {
    const raw = fixture();
    raw.settings.scheduleSettings.matchupPeriods = { '2': [3] } as typeof raw.settings.scheduleSettings.matchupPeriods;
    raw.schedule[1].home.rosterForCurrentScoringPeriod!.entries = [entry(1), entry(2, 2, { proTeamId: 2 })];
    const result = normalizeLeague(raw, {
      swid, season: 2026, week: 3,
      games: [{ id: 'g', homeTeam: 'KC', awayTeam: 'SEA', kickoff: '2026-09-20T17:00Z', status: 'final', detail: 'Final' }],
    });
    expect(result.league.matchupStatus).not.toBe('final');
  });
});
