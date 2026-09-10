import type { Game, PlayerAppearance, Side } from '../types';

export interface PlayerFilters {
  leagueIds: string[];
  side: Side | 'all';
  query: string;
  position: string;
  onlyWatchlist: boolean;
  watchlist: string[];
  gameId?: string | null;
}
export interface PlayerGroup {
  key: 'live' | 'today' | 'later' | 'final' | 'unscheduled';
  title: string;
  subtitle: string;
  players: PlayerAppearance[];
}
export interface RootingPlayer {
  playerId: string;
  name: string;
  nflTeam: string;
  position: string;
  forCount: number;
  againstCount: number;
  kind: 'for' | 'against' | 'conflicted';
}
export function filterPlayers(players: PlayerAppearance[], filters: PlayerFilters): PlayerAppearance[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return players.filter(player =>
    (!filters.leagueIds.length || filters.leagueIds.includes(player.leagueId)) &&
    (filters.side === 'all' || player.side === filters.side) &&
    (!query || `${player.name} ${player.nflTeam} ${player.position}`.toLocaleLowerCase().includes(query)) &&
    (filters.position === 'all' || player.position === filters.position) &&
    (!filters.onlyWatchlist || filters.watchlist.includes(player.playerId)) &&
    (!filters.gameId || player.gameId === filters.gameId)
  );
}
export function groupPlayers(players: PlayerAppearance[], games: Game[], now: Date, timezone?: string): PlayerGroup[] {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const gameMap = new Map(games.map(game => [game.id, game]));
  const groups: PlayerGroup[] = [
    { key: 'live', title: 'Currently playing', subtitle: 'Every snap. Every point. Right here.', players: [] },
    { key: 'today', title: 'Upcoming games today', subtitle: 'Your next reasons to tune in.', players: [] },
    { key: 'later', title: 'Later this week', subtitle: 'There is still football to be played.', players: [] },
    { key: 'final', title: 'In the books', subtitle: 'Final whistles. Fantasy points locked in.', players: [] },
    { key: 'unscheduled', title: 'Off the field', subtitle: 'Bye weeks, postponed games, or schedule unavailable.', players: [] },
  ];
  for (const player of players) {
    const game = gameMap.get(player.gameId ?? '');
    let key: PlayerGroup['key'] = 'unscheduled';
    if (game?.status === 'live') key = 'live';
    else if (game?.status === 'final') key = 'final';
    else if (game?.status === 'upcoming' && Number.isFinite(Date.parse(game.kickoff))) {
      key = day.format(new Date(game.kickoff)) === day.format(now) ? 'today' : 'later';
    }
    groups.find(group => group.key === key)!.players.push(player);
  }
  for (const group of groups) {
    group.players.sort((a, b) => {
      const aTime = Date.parse(gameMap.get(a.gameId ?? '')?.kickoff ?? '') || 0;
      const bTime = Date.parse(gameMap.get(b.gameId ?? '')?.kickoff ?? '') || 0;
      return aTime - bTime || (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.name.localeCompare(b.name);
    });
  }
  return groups.filter(group => group.players.length);
}
export function rootingGuide(players: PlayerAppearance[]): RootingPlayer[] {
  const map = new Map<string, RootingPlayer>();
  const appearances = new Set<string>();
  for (const player of players) {
    const key = `${player.playerId}:${player.leagueId}:${player.side}`;
    if (appearances.has(key)) continue;
    appearances.add(key);
    const item = map.get(player.playerId) ?? {
      playerId: player.playerId, name: player.name, nflTeam: player.nflTeam,
      position: player.position, forCount: 0, againstCount: 0, kind: 'for',
    };
    if (player.side === 'you') item.forCount++;
    else item.againstCount++;
    item.kind = item.forCount && item.againstCount ? 'conflicted' : item.forCount ? 'for' : 'against';
    map.set(player.playerId, item);
  }
  return [...map.values()].sort((a, b) =>
    Number(b.kind === 'conflicted') - Number(a.kind === 'conflicted') ||
    (b.forCount + b.againstCount) - (a.forCount + a.againstCount) || a.name.localeCompare(b.name)
  );
}
export function seasonForDate(date: Date): number {
  return date.getFullYear() - (date.getMonth() < 3 ? 1 : 0);
}

export function formatPoints(value: number | null, digits = 1): string {
  return value === null ? '--' : value.toFixed(digits);
}

export function kickoffLabel(game: Game): string {
  if (game.status === 'live' || game.status === 'final' || game.status === 'postponed') return game.detail;
  if (!Number.isFinite(Date.parse(game.kickoff))) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(game.kickoff));
}
