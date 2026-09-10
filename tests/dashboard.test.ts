import { describe, expect, it } from 'vitest';
import { filterPlayers, groupPlayers, rootingGuide, seasonForDate } from '../src/lib/dashboard';
import type { Game, PlayerAppearance } from '../src/types';
import { demoData } from '../src/data/demo';

const player = (id: string, changes: Partial<PlayerAppearance> = {}): PlayerAppearance => ({
  id, playerId: id, name: 'Josh Allen', position: 'QB', nflTeam: 'BUF',
  leagueId: '1', side: 'you', slot: 'QB', gameId: 'live', points: 10,
  projected: 20, stats: [], ...changes,
});
const games: Game[] = [
  { id: 'live', homeTeam: 'BUF', awayTeam: 'BAL', kickoff: '2026-09-13T17:00:00Z', status: 'live', detail: 'Q2 8:00' },
  { id: 'today', homeTeam: 'KC', awayTeam: 'LAC', kickoff: '2026-09-13T20:25:00Z', status: 'upcoming', detail: 'Scheduled' },
  { id: 'later', homeTeam: 'NYJ', awayTeam: 'SF', kickoff: '2026-09-15T00:15:00Z', status: 'upcoming', detail: 'Scheduled' },
  { id: 'final', homeTeam: 'DAL', awayTeam: 'PHI', kickoff: '2026-09-11T00:15:00Z', status: 'final', detail: 'Final' },
];
const now = new Date('2026-09-13T19:00:00Z');

describe('gameday model', () => {
  it('groups live, today, later, final and unscheduled players without losing any', () => {
    const players = [player('1'), player('2', { gameId: 'today' }), player('3', { gameId: 'later' }), player('4', { gameId: 'final' }), player('5', { gameId: null })];
    const groups = groupPlayers(players, games, now, 'America/New_York');
    expect(groups.map(g => g.key)).toEqual(['live', 'today', 'later', 'final', 'unscheduled']);
    expect(groups.flatMap(g => g.players)).toHaveLength(5);
  });
  it('uses the viewer timezone rather than UTC for today', () => {
    const result = groupPlayers([player('1', { gameId: 'later' })], games, new Date('2026-09-14T23:00:00Z'), 'America/Los_Angeles');
    expect(result[0].key).toBe('today');
  });
  it('composes league, ownership, search, position and watchlist filters', () => {
    const players = [player('1'), player('2', { side: 'opponent' }), player('3', { leagueId: '2' })];
    expect(filterPlayers(players, { leagueIds: ['1'], side: 'you', query: 'buf', position: 'QB', onlyWatchlist: true, watchlist: ['1'] }).map(p => p.id)).toEqual(['1']);
  });
  it('calculates rooting conflicts from unique player identities, not appearance IDs', () => {
    const result = rootingGuide([player('1'), player('2', { playerId: '1', leagueId: '2', side: 'opponent' }), player('3', { playerId: '1', leagueId: '3' })]);
    expect(result[0]).toMatchObject({ playerId: '1', forCount: 2, againstCount: 1, kind: 'conflicted' });
  });
  it('assigns January to the previous NFL season', () => {
    expect(seasonForDate(new Date('2027-01-08T12:00:00Z'))).toBe(2026);
    expect(seasonForDate(new Date('2026-09-08T12:00:00Z'))).toBe(2026);
  });
  it('does not multiply rooting exposure when an appearance is repeated', () => {
    const result = rootingGuide([player('1'), player('1')]);
    expect(result[0].forCount).toBe(1);
  });
  it('matches no players when a watchlist is empty', () => {
    expect(filterPlayers([player('1')], { leagueIds: [], side: 'all', query: '', position: 'all', onlyWatchlist: true, watchlist: [] })).toEqual([]);
  });
  it('keeps unknown points unknown while grouping and filtering', () => {
    const result = groupPlayers([player('1', { points: null, projected: null })], games, now);
    expect(result[0].players[0].points).toBeNull();
  });
  it('demo has complete lineups, unique appearance IDs, and consistent matchup totals', () => {
    expect(demoData.players).toHaveLength(54);
    expect(new Set(demoData.players.map(p => p.id)).size).toBe(54);
    for (const league of demoData.leagues) {
      const mine = demoData.players.filter(p => p.leagueId === league.id && p.side === 'you');
      expect(mine).toHaveLength(9);
      expect(league.score).toBeCloseTo(mine.reduce((n, p) => n + (p.points ?? 0), 0));
    }
    for (const item of demoData.players) {
      const game = demoData.games.find(g => g.id === item.gameId);
      expect([game?.awayTeam, game?.homeTeam]).toContain(item.nflTeam);
    }
  });
});
