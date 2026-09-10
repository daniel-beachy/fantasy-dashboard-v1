import { z } from 'zod';
import type { Game } from '../src/types';
import { AppError } from './errors';
import { canonicalOwner, DISCOVERY_WARNING, extractLeagueIds, normalizeScoreboard, parseLeague } from './normalize';
import { credentialsSchema, leagueIdSchema, scoreboardSchema, seasonSchema, weekSchema, type Credentials, type EspnLeague } from './schemas';

const READ_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const FAN_BASE = 'https://fan.api.espn.com/apis/v2/fans';
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const identitySchema = z.object({
  id: z.string().optional(), swid: z.string().optional(), guid: z.string().optional(),
  profile: z.object({ id: z.string().optional(), swid: z.string().optional(), guid: z.string().optional() }).optional(),
}).passthrough();
const READ_LIMIT = 8 * 1024 * 1024;

export interface Discovery { leagueIds: string[]; warning: string }
export interface EspnGateway {
  validate(credentials: Credentials): Promise<unknown>;
  discover(credentials: Credentials, season: number, profile?: unknown): Promise<Discovery>;
  league(credentials: Credentials, id: string, season: number, week?: number, matchup?: number): Promise<EspnLeague>;
  currentWeek(season: number): Promise<number>;
  scoreboard(season: number, week: number): Promise<Game[]>;
}

export class EspnClient implements EspnGateway {
  constructor(private readonly transport: typeof fetch = fetch.bind(globalThis)) {}

  private async request(url: URL, credentials?: Credentials, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
    const requestHeaders = new Headers({ Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; LocalFantasyDashboard/1.0)', ...headers });
    if (credentials) {
      const parsed = credentialsSchema.safeParse(credentials);
      if (!parsed.success) throw new AppError(400, 'Invalid ESPN cookie format. Paste only your own SWID and espn_s2 cookie values.');
      requestHeaders.set('Cookie', `SWID=${parsed.data.swid}; espn_s2=${parsed.data.espnS2}`);
    }
    const signal = AbortSignal.timeout(12_000);
    try {
      const response = await this.transport(url, { method: 'GET', headers: requestHeaders, redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new AppError(502, 'ESPN redirected this request unexpectedly. No account cookies were forwarded; please retry later.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { status: response.status, body: null };
      }
      if (Number(response.headers.get('content-length')) > READ_LIMIT) {
        await response.body?.cancel();
        throw new AppError(502, 'ESPN returned an unexpectedly large response.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new AppError(502, 'ESPN returned an empty response.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > READ_LIMIT) {
          await reader.cancel();
          throw new AppError(502, 'ESPN returned an unexpectedly large response.');
        }
        chunks.push(value);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const body: unknown = JSON.parse(text);
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, signal.aborted
        ? 'ESPN request timed out. Please retry.'
        : 'ESPN could not be reached or returned an unreadable response. Please retry.');
    }
  }

  private accepted(response: { status: number; body: unknown }): unknown {
    if (response.status === 401 || response.status === 403) throw new AppError(401, 'ESPN denied access. Sign in again and confirm this account can access the league.');
    if (response.status === 404) throw new AppError(404, 'ESPN could not find this league or season. Check the league ID and season.');
    if (response.status === 429) throw new AppError(503, 'ESPN is rate-limiting requests. Wait a minute before refreshing.');
    if (response.status !== 200) throw new AppError(502, 'ESPN is temporarily unavailable. Please retry.');
    return response.body;
  }

  private fanUrl(credentials: Credentials): URL {
    const parsed = credentialsSchema.safeParse(credentials);
    if (!parsed.success) throw new AppError(400, 'Invalid ESPN cookie format.');
    const url = new URL(`${FAN_BASE}/${encodeURIComponent(parsed.data.swid)}`);
    url.search = new URLSearchParams({
      context: 'fantasy', displayHiddenPrefs: 'true', useCookieAuth: 'true',
      source: 'fantasyapp-ios', featureFlags: 'challengeEntries',
    }).toString();
    return url;
  }

  async validate(credentials: Credentials): Promise<unknown> {
    const url = this.fanUrl(credentials);
    const response = await this.request(url, credentials);
    const message = 'Could not verify the ESPN session. Sign in using the official browser, or import fresh cookies from your own signed-in ESPN account.';
    if (response.status !== 200) throw new AppError(401, message);
    const identity = identitySchema.safeParse(response.body);
    if (!identity.success) throw new AppError(401, message);
    const value = identity.data;
    const owner = value.id ?? value.swid ?? value.guid ?? value.profile?.id ?? value.profile?.swid ?? value.profile?.guid;
    if (!owner || canonicalOwner(owner) !== canonicalOwner(credentials.swid)) throw new AppError(401, message);
    // A publicly readable profile cannot prove that a cookie is valid.
    const anonymous = await this.request(url);
    if (![401, 403, 404].includes(anonymous.status)) {
      throw new AppError(401, 'ESPN session verification is unavailable: its account endpoint did not require authentication. Use official browser sign-in and retry later.');
    }
    return response.body;
  }

  async discover(credentials: Credentials, season: number, profile?: unknown): Promise<Discovery> {
    const body = profile ?? this.accepted(await this.request(this.fanUrl(credentials), credentials));
    return { leagueIds: extractLeagueIds(body, season), warning: DISCOVERY_WARNING };
  }

  async league(credentials: Credentials, id: string, season: number, week?: number, matchup?: number): Promise<EspnLeague> {
    if (!leagueIdSchema.safeParse(id).success || !seasonSchema.safeParse(season).success
      || (week !== undefined && !weekSchema.safeParse(week).success)
      || (matchup !== undefined && (!Number.isInteger(matchup) || matchup < 1 || matchup > 30))) {
      throw new AppError(400, 'Invalid league ID, season, or scoring week.');
    }
    const url = new URL(`${READ_BASE}/seasons/${season}/segments/0/leagues/${id}`);
    const views = week === undefined ? ['mTeam', 'mSettings'] : ['mTeam', 'mSettings', 'mRoster', 'mMatchupScore', 'mScoreboard'];
    for (const view of views) url.searchParams.append('view', view);
    if (week !== undefined) url.searchParams.set('scoringPeriodId', String(week));
    const headers = matchup !== undefined ? { 'x-fantasy-filter': JSON.stringify({ schedule: { filterMatchupPeriodIds: { value: [matchup] } } }) } : undefined;
    const league = parseLeague(this.accepted(await this.request(url, credentials, headers)));
    if (String(league.id) !== id || (league.seasonId !== undefined && league.seasonId !== season)) {
      throw new AppError(502, 'ESPN returned a different league or season than requested.');
    }
    return league;
  }

  async currentWeek(season: number): Promise<number> {
    if (!seasonSchema.safeParse(season).success) throw new AppError(400, 'Invalid season.');
    const url = new URL(`${READ_BASE}/seasons/${season}`);
    url.searchParams.set('view', 'kona_game_state');
    const parsed = z.object({ currentScoringPeriod: z.object({ id: weekSchema }) }).safeParse(this.accepted(await this.request(url)));
    if (!parsed.success) throw new AppError(502, 'ESPN has no current regular-season fantasy scoring week. The season may not have started or may be over.');
    return parsed.data.currentScoringPeriod.id;
  }

  async scoreboard(season: number, week: number): Promise<Game[]> {
    if (!seasonSchema.safeParse(season).success || !weekSchema.safeParse(week).success) throw new AppError(400, 'Invalid NFL season or week.');
    const url = new URL(SCOREBOARD);
    url.search = new URLSearchParams({ dates: String(season), seasontype: '2', week: String(week) }).toString();
    let upstream = await this.request(url);
    if (upstream.status === 403) {
      url.hostname = 'site.web.api.espn.com';
      upstream = await this.request(url);
    }
    const response = scoreboardSchema.safeParse(this.accepted(upstream));
    if (!response.success) throw new AppError(502, 'ESPN NFL schedule has an unexpected format.');
    if (response.data.season?.year !== season || response.data.season?.type !== 2 || response.data.week?.number !== week) {
      throw new AppError(502, 'ESPN returned a schedule for a different season or week.');
    }
    return normalizeScoreboard(response.data);
  }
}
