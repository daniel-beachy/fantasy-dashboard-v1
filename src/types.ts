export type GameStatus = 'live' | 'upcoming' | 'final' | 'postponed' | 'bye';
export type Side = 'you' | 'opponent';

export interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  kickoff: string;
  status: GameStatus;
  detail: string;
  broadcast?: string;
}

export interface League {
  id: string;
  name: string;
  scoring: string;
  teamId: number;
  teamName: string;
  opponentName: string;
  score: number | null;
  opponentScore: number | null;
  projected: number | null;
  opponentProjected: number | null;
  matchupStatus: 'live' | 'upcoming' | 'final' | 'bye';
}

export interface PlayerAppearance {
  id: string;
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  leagueId: string;
  side: Side;
  slot: string;
  gameId: string | null;
  points: number | null;
  projected: number | null;
  stats: { label: string; value: string }[];
  injuryStatus?: string;
  headshot?: string;
}

export interface DashboardData {
  source: 'demo' | 'espn';
  season: number;
  week: number;
  fetchedAt: string;
  leagues: League[];
  games: Game[];
  players: PlayerAppearance[];
  warnings: string[];
}

export interface LeagueSelection {
  id: string;
  name: string;
  teams: { id: number; name: string; owned: boolean }[];
  teamId?: number;
}

export interface SessionStatus {
  authenticated: boolean;
  loginPending: boolean;
  csrfToken: string;
  loginError?: string;
  discoveryWarning?: string;
}
