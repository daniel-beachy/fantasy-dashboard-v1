import type { DashboardData, LeagueSelection, SessionStatus } from '../types';

const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const hostedBuild = import.meta.env.VITE_CLOUD_HOSTED === true || import.meta.env.VITE_CLOUD_HOSTED === 'true';
let cloud = hostedBuild;
let csrfToken = '';

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-Dashboard-Token': csrfToken } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new RequestError(cloud
    ? 'Your private dashboard service is unavailable. Please try again.'
    : 'The local ESPN companion is not running. Start it with npm run dev, then open http://127.0.0.1:3000.', response.status);
  const result = await response.json();
  if (!response.ok) throw new RequestError(typeof result?.error === 'string' ? result.error : `Request failed (${response.status}). Try again.`, response.status);
  return result as T;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const score = (value: unknown) => value === null || numeric(value);

function validDashboard(value: unknown): value is DashboardData {
  if (!record(value) || value.source !== 'espn' || !Number.isInteger(value.season) || !Number.isInteger(value.week)
    || typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt)) || !strings(value.warnings)) return false;
  return Array.isArray(value.leagues) && value.leagues.every(league => record(league)
    && strings([league.id, league.name, league.scoring, league.teamName, league.opponentName])
    && numeric(league.teamId) && [league.score, league.opponentScore, league.projected, league.opponentProjected].every(score)
    && ['live', 'upcoming', 'final', 'bye'].includes(String(league.matchupStatus)))
    && Array.isArray(value.games) && value.games.every(game => record(game)
      && strings([game.id, game.homeTeam, game.awayTeam, game.kickoff, game.detail])
      && ['live', 'upcoming', 'final', 'postponed', 'bye'].includes(String(game.status))
      && (game.broadcast === undefined || typeof game.broadcast === 'string')
      && [game.homeScore, game.awayScore].every(points => points === undefined || numeric(points)))
    && Array.isArray(value.players) && value.players.every(player => record(player)
      && strings([player.id, player.playerId, player.name, player.position, player.nflTeam, player.leagueId, player.slot])
      && ['you', 'opponent'].includes(String(player.side)) && (player.gameId === null || typeof player.gameId === 'string')
      && score(player.points) && score(player.projected)
      && Array.isArray(player.stats) && player.stats.every(stat => record(stat) && strings([stat.label, stat.value])));
}

async function getLeagues(signal?: AbortSignal) {
  const result = await request<{ leagues: LeagueSelection[] }>('leagues', undefined, signal);
  if (!record(result) || !Array.isArray(result.leagues) || !result.leagues.every(league => record(league)
    && strings([league.id, league.name]) && (league.teamId === undefined || numeric(league.teamId))
    && Array.isArray(league.teams) && league.teams.every(team => record(team) && numeric(team.id) && typeof team.name === 'string' && typeof team.owned === 'boolean'))) {
    throw new Error('The service returned an invalid league list. Please try again.');
  }
  return result;
}

async function cloudDashboard(signal?: AbortSignal): Promise<DashboardData> {
  const controller = new AbortController();
  const sharedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const { leagues } = await getLeagues(sharedSignal);
  const selected = [...new Map(leagues.filter(league => league.teamId !== undefined).map(league => [league.id, league])).values()];
  if (!selected.length) throw new Error('No owned teams are selected. Add a league in Manage leagues first.');
  const results: (DashboardData | undefined)[] = new Array(selected.length);
  const warnings: string[] = [];
  let next = 0;
  async function fetchNext() {
    while (next < selected.length) {
      sharedSignal.throwIfAborted();
      const index = next++;
      const league = selected[index];
      try {
        const result = await request<unknown>(`dashboard?leagueId=${encodeURIComponent(league.id)}`, undefined, sharedSignal);
        if (!validDashboard(result) || result.leagues.length !== 1 || result.leagues[0].id !== league.id
          || result.players.some(player => player.leagueId !== league.id)) {
          throw new Error('The service returned an invalid ESPN dashboard. Please try again.');
        }
        results[index] = result;
      } catch (cause) {
        if (sharedSignal.aborted || (cause instanceof Error && ['AbortError', 'TimeoutError'].includes(cause.name)) || (cause instanceof RequestError && cause.status === 401)) throw cause;
        warnings.push(`${league.name}: ${cause instanceof Error ? cause.message : 'Unable to load this league.'}`);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(4, selected.length) }, fetchNext));
    sharedSignal.throwIfAborted();
  } catch (cause) {
    controller.abort();
    throw cause;
  }
  const successes = results.filter((result): result is DashboardData => Boolean(result));
  if (!successes.length) throw new Error(warnings.join(' ') || 'No ESPN leagues could be loaded. Please try again.');
  const first = successes[0];
  if (successes.some(result => result.season !== first.season || result.week !== first.week)) {
    throw new Error('ESPN returned different seasons or weeks across your leagues. Refresh to get a consistent snapshot.');
  }
  return {
    source: 'espn', season: first.season, week: first.week,
    fetchedAt: successes.reduce((oldest, result) => Date.parse(result.fetchedAt) < Date.parse(oldest) ? result.fetchedAt : oldest, first.fetchedAt),
    leagues: successes.flatMap(result => result.leagues),
    players: successes.flatMap(result => result.players),
    games: [...new Map(successes.flatMap(result => result.games).map(game => [game.id, game])).values()],
    warnings: [...new Set([...successes.flatMap(result => result.warnings), ...warnings])],
  };
}

export const api = {
  isLocal: local,
  get isCloud() { return cloud; },
  get canConnect() { return local || cloud; },
  session: async () => {
    const result = await request<SessionStatus>('session');
    cloud = hostedBuild || result.mode === 'cloud';
    csrfToken = result.csrfToken;
    return result;
  },
  login: () => request<{ ok: boolean }>('login', {}),
  logout: () => request<{ ok: boolean }>('logout', {}),
  createVault: () => request<{ recoveryKey: string }>('vaults', {}),
  loginVault: (recoveryKey: string) => request<{ ok: boolean }>('vaults/login', { recoveryKey }),
  logoutVault: () => request<{ ok: boolean }>('vaults/logout', {}),
  deleteVault: () => request<{ ok: boolean }>('vaults/delete', { confirm: true }),
  connect: (swid: string, espnS2: string) => request<{ ok: boolean }>('connect', { swid, espnS2 }),
  leagues: getLeagues,
  addLeague: (leagueId: string, teamId?: number) => request('leagues', { leagueId, teamId }),
  dashboard: (signal?: AbortSignal) => cloud ? cloudDashboard(signal) : request<DashboardData>('dashboard', undefined, signal),
};
