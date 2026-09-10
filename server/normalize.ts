import type { Game, League, LeagueSelection, PlayerAppearance } from '../src/types';
import { AppError } from './errors';
import { fanEntrySchema, leagueSchema, scoreboardSchema, type EspnLeague, type EspnRoster } from './schemas';

export const DISCOVERY_WARNING = 'League discovery may be incomplete. Add any missing current-season football league using its ESPN league ID.';
const PRO_TEAMS: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB',
  10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE',
  18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF',
  26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};
const POSITIONS: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 6: 'P',
  9: 'DT', 10: 'DE', 11: 'LB', 12: 'CB', 13: 'S', 16: 'DST',
};
const SLOTS: Record<number, string> = {
  0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'SUPERFLEX',
  8: 'DT', 9: 'DE', 10: 'LB', 11: 'DL', 12: 'CB', 13: 'S', 14: 'DB', 15: 'IDP', 16: 'DST',
  17: 'K', 18: 'P', 19: 'HC', 23: 'FLEX', 24: 'EDGE',
};
const STAT_LABELS: Record<string, string> = {
  '0': 'Pass ATT', '1': 'Pass CMP', '3': 'Pass YDS', '4': 'Pass TD', '20': 'INT',
  '23': 'Rush ATT', '24': 'Rush YDS', '25': 'Rush TD', '41': 'REC', '42': 'Rec YDS',
  '43': 'Rec TD', '58': 'TGT', '72': 'FUM LOST', '83': 'FG', '84': 'FG ATT', '86': 'XP',
  '87': 'XP ATT', '95': 'DEF INT', '96': 'FR', '97': 'BLK', '98': 'SFTY', '99': 'SACK',
  '105': 'DEF/ST TD', '106': 'FF', '107': 'AST TKL', '108': 'SOLO TKL', '109': 'TKL',
  '113': 'PD', '120': 'PTS ALLOWED', '127': 'YDS ALLOWED',
};

export function currentSeason(date = new Date()): number {
  return date.getUTCFullYear() - (date.getUTCMonth() < 2 ? 1 : 0);
}
export function canonicalOwner(value: string): string {
  return value.replace(/[{}]/g, '').toUpperCase();
}
export function parseLeague(raw: unknown): EspnLeague {
  const result = leagueSchema.safeParse(raw);
  if (!result.success) throw new AppError(502, 'ESPN league data has an unexpected format. Please retry; ESPN may have changed its API.');
  return result.data;
}
function teamName(team: EspnLeague['teams'][number]): string {
  return team.name || [team.location, team.nickname].filter(Boolean).join(' ') || team.abbrev || `Team ${team.id}`;
}
export function leagueSelection(raw: EspnLeague, swid: string, chosenTeam?: number): LeagueSelection {
  const teams = raw.teams.map(team => ({
    id: team.id, name: teamName(team),
    owned: team.owners?.some(owner => canonicalOwner(owner) === canonicalOwner(swid)) ?? false,
  }));
  if (!teams.some(team => team.owned)) throw new AppError(403, 'The signed-in ESPN account does not own a team in this league.');
  if (chosenTeam !== undefined && !teams.some(team => team.id === chosenTeam && team.owned)) {
    throw new AppError(403, 'You can only select a team owned by the signed-in ESPN account.');
  }
  return { id: String(raw.id), name: raw.settings?.name || `League ${raw.id}`, teams, teamId: chosenTeam ?? teams.find(team => team.owned)?.id };
}
export function matchupPeriod(raw: EspnLeague, week: number): number | undefined {
  const periods = raw.settings?.scheduleSettings?.matchupPeriods;
  if (periods) {
    const found = Object.entries(periods).find(([, weeks]) => weeks.includes(week));
    if (found) return Number(found[0]);
    return undefined;
  }
  if (raw.scoringPeriodId === week || raw.status?.latestScoringPeriod === week) return raw.status?.currentMatchupPeriod;
  return undefined;
}
const abbreviation = (value: string) => ({ JAC: 'JAX', WAS: 'WSH', WSH: 'WSH', LA: 'LAR', OAK: 'LV', SD: 'LAC' }[value.toUpperCase()] ?? value.toUpperCase());
export function normalizeScoreboard(raw: unknown): Game[] {
  const parsed = scoreboardSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(502, 'ESPN NFL schedule has an unexpected format.');
  return parsed.data.events.map(event => {
    const competition = event.competitions[0];
    const home = competition.competitors.find(team => team.homeAway === 'home');
    const away = competition.competitors.find(team => team.homeAway === 'away');
    if (!home || !away) throw new AppError(502, 'ESPN NFL schedule has an unexpected format.');
    const status = competition.status?.type ?? event.status.type;
    const gameStatus: Game['status'] = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED/i.test(status.name)
      ? 'postponed' : status.completed || status.state === 'post' ? 'final' : status.state === 'in' ? 'live' : 'upcoming';
    const includeScores = gameStatus === 'live' || gameStatus === 'final';
    return {
      id: event.id, homeTeam: abbreviation(home.team.abbreviation), awayTeam: abbreviation(away.team.abbreviation),
      homeScore: includeScores && home.score !== undefined ? Number(home.score) : undefined,
      awayScore: includeScores && away.score !== undefined ? Number(away.score) : undefined,
      kickoff: new Date(event.date).toISOString(), status: gameStatus,
      detail: status.detail || status.shortDetail || status.description || gameStatus,
      broadcast: competition.broadcasts?.flatMap(b => b.names).join(' / ') || competition.broadcast || undefined,
    };
  });
}

interface NormalizeOptions { swid: string; season: number; week: number; teamId?: number; games: Game[] }
export function normalizeLeague(input: unknown, options: NormalizeOptions): { league: League; players: PlayerAppearance[]; warnings: string[] } {
  const raw = parseLeague(input);
  const { season, week, swid, games } = options;
  if (raw.seasonId !== undefined && raw.seasonId !== season) throw new AppError(502, 'ESPN returned the wrong league season.');
  if (raw.scoringPeriodId !== undefined && raw.scoringPeriodId !== week) throw new AppError(502, 'ESPN returned a different scoring week than requested.');
  const selection = leagueSelection(raw, swid, options.teamId);
  const ownTeam = raw.teams.find(team => team.id === selection.teamId)!;
  const period = matchupPeriod(raw, week);
  const matchup = raw.schedule?.find(match => match.matchupPeriodId === period && (match.home?.teamId === ownTeam.id || match.away?.teamId === ownTeam.id));
  const you = matchup?.home?.teamId === ownTeam.id ? matchup.home : matchup?.away;
  const opponent = matchup?.home?.teamId === ownTeam.id ? matchup.away : matchup?.home;
  const opponentTeam = raw.teams.find(team => team.id === opponent?.teamId);
  const periodWeeks = period === undefined ? undefined : raw.settings?.scheduleSettings?.matchupPeriods?.[String(period)];
  const multiweek = (periodWeeks?.length ?? 1) > 1;
  const warnings: string[] = [];
  if (!matchup) warnings.push(`${selection.name}: matchup data is unavailable for scoring week ${week}; no opponent or score was invented.`);
  if (multiweek) warnings.push(`${selection.name}: multi-week matchup totals include weeks ${periodWeeks!.join(', ')}; player points and projections below are for week ${week} only.`);
  const players: PlayerAppearance[] = [];
  const addRoster = (team: EspnLeague['teams'][number] | undefined, side: 'you' | 'opponent', box: typeof you) => {
    if (!team) return;
    // Matchup snapshots preserve the actual lineup; a current roster may have already changed.
    const weekMatches = raw.scoringPeriodId === week || (raw.scoringPeriodId === undefined && raw.status?.latestScoringPeriod === week);
    const roster: EspnRoster | null | undefined = weekMatches ? box?.rosterForCurrentScoringPeriod ?? team.roster : undefined;
    if (!roster) {
      warnings.push(`${selection.name}: ${teamName(team)} starting lineup is unavailable for week ${week}.`);
      return;
    }
    for (const entry of roster.entries) {
      if ([20, 21, 22, 25].includes(entry.lineupSlotId)) continue;
      if (!SLOTS[entry.lineupSlotId]) {
        warnings.push(`${selection.name}: unrecognized lineup slot ${entry.lineupSlotId} was excluded.`);
        continue;
      }
      const player = entry.playerPoolEntry.player;
      const statFor = (source: number) => player.stats?.find(stat => stat.seasonId === season && stat.scoringPeriodId === week && stat.statSplitTypeId === 1 && stat.statSourceId === source);
      const actual = statFor(0);
      const projected = statFor(1);
      const proTeamId = actual?.proTeamId && actual.proTeamId > 0 ? actual.proTeamId : player.proTeamId;
      const nflTeam = PRO_TEAMS[proTeamId] ?? (proTeamId === 0 ? 'FA' : 'UNK');
      const game = games.find(game => game.homeTeam === nflTeam || game.awayTeam === nflTeam);
      players.push({
        id: `${raw.id}-${team.id}-${player.id}`, playerId: String(player.id), name: player.fullName,
        position: POSITIONS[player.defaultPositionId] ?? 'IDP', nflTeam, leagueId: String(raw.id), side,
        slot: SLOTS[entry.lineupSlotId], gameId: game?.id ?? null, points: actual?.appliedTotal ?? null,
        projected: projected?.appliedTotal ?? null,
        stats: Object.entries(actual?.stats ?? {}).filter(([id]) => STAT_LABELS[id]).map(([id, value]) => ({ label: STAT_LABELS[id], value: String(Math.round(value * 100) / 100) })),
        injuryStatus: player.injuryStatus && player.injuryStatus !== 'ACTIVE' ? player.injuryStatus : undefined,
        headshot: player.id > 0 && player.defaultPositionId !== 16 ? `https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png` : undefined,
      });
    }
  };
  addRoster(ownTeam, 'you', you);
  addRoster(opponentTeam, 'opponent', opponent);
  const sumProjection = (side: 'you' | 'opponent') => {
    const lineup = players.filter(player => player.side === side);
    return !multiweek && lineup.length > 0 && lineup.every(player => player.projected !== null)
      ? Math.round(lineup.reduce((sum, player) => sum + player.projected!, 0) * 100) / 100 : null;
  };
  const applicableGames = games.filter(game => players.some(player => player.gameId === game.id));
  let matchupStatus: League['matchupStatus'] = matchup && (!opponent || opponent.teamId <= 0) ? 'bye' : 'upcoming';
  const completed = matchup?.winner && matchup.winner !== 'UNDECIDED';
  if (matchupStatus !== 'bye') {
    if (completed || (periodWeeks?.every(w => w < (raw.status?.latestScoringPeriod ?? 0)))) matchupStatus = 'final';
    else if (applicableGames.some(game => game.status === 'live' || game.status === 'final') || (multiweek && week > Math.min(...periodWeeks!))) matchupStatus = 'live';
    if (!multiweek && applicableGames.length && applicableGames.every(game => game.status === 'final')
      && players.every(player => player.gameId !== null)
      && !warnings.some(warning => warning.includes('starting lineup is unavailable'))) matchupStatus = 'final';
  }
  if (players.some(player => player.nflTeam === 'UNK')) warnings.push(`${selection.name}: an NFL team could not be mapped to the schedule.`);
  return {
    league: {
      id: selection.id, name: selection.name,
      scoring: scoringLabel(raw), teamId: ownTeam.id, teamName: teamName(ownTeam),
      opponentName: opponentTeam ? teamName(opponentTeam) : matchupStatus === 'bye' ? 'Bye week' : 'Opponent unavailable',
      score: you?.totalPointsLive ?? you?.totalPoints ?? null,
      opponentScore: opponent?.totalPointsLive ?? opponent?.totalPoints ?? null,
      projected: you?.totalProjectedPointsLive ?? you?.totalProjectedPoints ?? sumProjection('you'),
      opponentProjected: opponent?.totalProjectedPointsLive ?? opponent?.totalProjectedPoints ?? sumProjection('opponent'),
      matchupStatus,
    },
    players, warnings,
  };
}
function scoringLabel(raw: EspnLeague): string {
  const items = raw.settings?.scoringSettings?.scoringItems;
  const receptions = items?.find(item => item.statId === 53) ?? items?.find(item => item.statId === 41);
  if (receptions) return receptions.points === 1 ? 'PPR' : receptions.points === 0.5 ? 'Half PPR' : receptions.points === 0 ? 'Standard' : `${receptions.points} PPR · custom`;
  return items ? 'Standard / custom' : 'ESPN scoring';
}

export function leagueIdFromLink(value: string, season: number): string | undefined {
  try {
    const url = new URL(value, 'https://fantasy.espn.com');
    if (url.hostname !== 'fantasy.espn.com' || url.protocol !== 'https:' || !url.pathname.startsWith('/football/')) return;
    if (url.searchParams.get('seasonId') !== String(season)) return;
    const id = url.searchParams.get('leagueId');
    return id && /^[1-9]\d{0,11}$/.test(id) ? id : undefined;
  } catch { return; }
}
export function extractLeagueIds(raw: unknown, season: number): string[] {
  const found = new Set<string>();
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (++visited > 20_000 || depth > 12) return;
    if (typeof value === 'string') {
      const id = leagueIdFromLink(value, season);
      if (id) found.add(id);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(child => visit(child, depth + 1)); return; }
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    const entry = fanEntrySchema.safeParse(record);
    if (entry.success && entry.data.seasonId === season) {
      for (const group of entry.data.groups) found.add(String(group.groupId));
    }
    const game = record.gameId ?? record.sport;
    const year = record.seasonId ?? record.season;
    const id = record.leagueId;
    if ((game === 'ffl' || game === 'football' || game === 1) && Number(year) === season
      && (typeof id === 'number' || typeof id === 'string') && /^[1-9]\d{0,11}$/.test(String(id))) found.add(String(id));
    Object.values(record).forEach(child => visit(child, depth + 1));
  };
  visit(raw, 0);
  return [...found].slice(0, 50);
}
