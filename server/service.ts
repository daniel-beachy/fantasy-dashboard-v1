import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { DashboardData, LeagueSelection, SessionStatus } from '../src/types';
import type { LoginResult } from './auth';
import { AppError, safeMessage } from './errors';
import { EspnClient, type EspnGateway } from './espn';
import { currentSeason, DISCOVERY_WARNING, leagueSelection, matchupPeriod, normalizeLeague, parseLeague } from './normalize';
import { connectSchema, credentialsSchema, leagueIdSchema, seasonSchema, selectLeagueSchema, type Credentials, type EspnLeague } from './schemas';

const selectionSchema = z.object({
  id: leagueIdSchema, name: z.string(),
  teams: z.array(z.object({ id: z.number().int(), name: z.string(), owned: z.boolean() })),
  teamId: z.number().int().positive().optional(),
});
const stateSchema = z.object({
  version: z.literal(1),
  credentials: credentialsSchema.optional(),
  season: seasonSchema.optional(),
  selections: z.array(selectionSchema).max(50),
  discoveryWarning: z.string().optional(),
});
export type DashboardState = z.infer<typeof stateSchema>;

async function mapBounded<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) break;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}
interface ServiceOptions {
  client?: EspnGateway;
  login?: (signal: AbortSignal) => Promise<LoginResult>;
  now?: () => Date;
  state?: unknown;
  maxAutoLeagues?: number;
}
export class DashboardService {
  private readonly client: EspnGateway;
  private readonly login: (signal: AbortSignal) => Promise<LoginResult>;
  private readonly now: () => Date;
  private readonly maxAutoLeagues: number;
  private readonly csrfToken = randomBytes(32).toString('base64url');
  private credentials?: Credentials;
  private season?: number;
  private generation = 0;
  private revision = 0;
  private loginController?: AbortController;
  private loginPending = false;
  private loginError?: string;
  private discoveryWarning?: string;
  private selections = new Map<string, LeagueSelection>();
  private cache = new Map<string, { expires: number; value: DashboardData }>();
  private inFlight = new Map<string, Promise<DashboardData>>();

  constructor(options: ServiceOptions = {}) {
    this.client = options.client ?? new EspnClient();
    this.login = options.login ?? (async () => { throw new AppError(501, 'Official browser sign-in is available only in the local companion. Use your ESPN session cookies here.'); });
    this.now = options.now ?? (() => new Date());
    this.maxAutoLeagues = Math.max(1, Math.min(50, options.maxAutoLeagues ?? 50));
    if (options.state !== undefined) {
      const state = stateSchema.safeParse(options.state);
      if (!state.success) throw new AppError(502, 'The stored dashboard has an unsupported format. Disconnect and reconnect your ESPN account.');
      this.credentials = state.data.credentials;
      this.season = state.data.season;
      this.discoveryWarning = state.data.discoveryWarning;
      this.selections = new Map(state.data.selections.map(selection => [selection.id, selection]));
    }
  }
  exportState(): DashboardState {
    return structuredClone({
      version: 1, credentials: this.credentials, season: this.season,
      selections: [...this.selections.values()], discoveryWarning: this.discoveryWarning,
    });
  }
  status(): SessionStatus {
    return {
      authenticated: this.credentials !== undefined, loginPending: this.loginPending, csrfToken: this.csrfToken,
      loginError: this.loginError, discoveryWarning: this.discoveryWarning,
    };
  }
  private reset(): number {
    this.generation++;
    this.revision++;
    this.loginController?.abort();
    this.loginController = undefined;
    this.loginPending = false;
    this.loginError = undefined;
    this.discoveryWarning = undefined;
    this.credentials = undefined;
    this.season = undefined;
    this.selections.clear();
    this.cache.clear();
    this.inFlight.clear();
    return this.generation;
  }
  private checkGeneration(generation: number): void {
    if (this.generation !== generation) throw new AppError(409, 'The local ESPN session changed. Please retry.');
  }
  private requireCredentials(): Credentials {
    if (!this.credentials) throw new AppError(401, 'Connect your ESPN account before loading private league data.');
    return this.credentials;
  }
  async logout(): Promise<void> { this.reset(); }
  startLogin(): void {
    if (this.loginPending) return;
    const generation = this.reset();
    const controller = new AbortController();
    this.loginController = controller;
    this.loginPending = true;
    void (async () => {
      try {
        const captured = await this.login(controller.signal);
        this.checkGeneration(generation);
        await this.establish(captured.credentials, currentSeason(this.now()), captured.leagueIds, generation);
      } catch (error) {
        if (this.generation === generation) {
          this.credentials = undefined;
          this.loginError = safeMessage(error, 'ESPN sign-in could not finish. Retry official browser sign-in, or import fresh cookies from your own account.');
        }
      } finally {
        if (this.generation === generation) {
          this.loginPending = false;
          this.loginController = undefined;
        }
      }
    })();
  }
  async connect(input: unknown): Promise<void> {
    const parsed = connectSchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, 'Invalid ESPN cookie, season, or league ID format. Enter cookie values only, not a Cookie header.');
    const generation = this.reset();
    const { swid, espnS2, season, leagueIds } = parsed.data;
    await this.establish({ swid, espnS2 }, season ?? currentSeason(this.now()), leagueIds ?? [], generation);
  }
  private async establish(credentials: Credentials, season: number, hints: string[], generation: number): Promise<void> {
    const profile = await this.client.validate(credentials);
    this.checkGeneration(generation);
    let ids = hints;
    let warning = DISCOVERY_WARNING;
    try {
      const discovered = await this.client.discover(credentials, season, profile);
      ids = [...new Set([...ids, ...discovered.leagueIds])];
      warning = discovered.warning || DISCOVERY_WARNING;
    } catch {
      warning = `Automatic discovery is unavailable. ${DISCOVERY_WARNING}`;
    }
    if (ids.length > this.maxAutoLeagues) {
      warning = `Automatically connected the first ${this.maxAutoLeagues} discovered leagues. Add other leagues individually using their league IDs. ${warning}`;
      ids = ids.slice(0, this.maxAutoLeagues);
    }
    this.checkGeneration(generation);
    const errors: string[] = [];
    const selected = await mapBounded(ids, async id => {
      try {
        this.checkGeneration(generation);
        const league = parseLeague(await this.client.league(credentials, id, season));
        if (league.status?.isActive === false) return undefined;
        return leagueSelection(league, credentials.swid);
      } catch (error) {
        errors.push(`League ${id}: ${safeMessage(error)}`);
        return undefined;
      }
    });
    this.checkGeneration(generation);
    this.credentials = credentials;
    this.season = season;
    this.selections = new Map(selected.filter((selection): selection is LeagueSelection => selection !== undefined).map(selection => [selection.id, selection]));
    this.discoveryWarning = [warning, ...errors].join(' ');
    this.cache.clear();
  }
  leagues(): LeagueSelection[] {
    this.requireCredentials();
    return [...this.selections.values()];
  }
  async selectLeague(input: unknown): Promise<void> {
    const parsed = selectLeagueSchema.safeParse(input);
    if (!parsed.success) throw new AppError(400, 'Provide a numeric ESPN league ID and, optionally, an owned team ID.');
    const credentials = this.requireCredentials();
    const generation = this.generation;
    if (this.selections.size >= 50 && !this.selections.has(parsed.data.leagueId)) throw new AppError(400, 'A maximum of 50 leagues can be tracked in one dashboard.');
    const raw = parseLeague(await this.client.league(credentials, parsed.data.leagueId, this.season ?? currentSeason(this.now())));
    this.checkGeneration(generation);
    if (raw.status?.isActive === false) throw new AppError(400, 'This league is not active for the selected season.');
    const selection = leagueSelection(raw, credentials.swid, parsed.data.teamId);
    this.selections.set(selection.id, selection);
    this.revision++;
    this.cache.clear();
  }
  async dashboard(options: { season?: number; week?: number } = {}): Promise<DashboardData> {
    this.requireCredentials();
    if (!this.selections.size) throw new AppError(400, 'No football leagues are connected yet. Add your ESPN league ID to continue.');
    const season = options.season ?? this.season ?? currentSeason(this.now());
    const key = `${this.generation}:${this.revision}:${season}:${options.week ?? 'current'}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now().getTime()) return cached.value;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const generation = this.generation;
    const revision = this.revision;
    const task = this.buildDashboard(season, options.week).then(value => {
      this.checkGeneration(generation);
      if (this.revision !== revision) throw new AppError(409, 'Your selected leagues changed. Please refresh.');
      if (this.cache.size >= 12) this.cache.clear();
      this.cache.set(key, { value, expires: this.now().getTime() + 25_000 });
      return value;
    }).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, task);
    return task;
  }
  private async buildDashboard(season: number, requestedWeek?: number): Promise<DashboardData> {
    const credentials = this.requireCredentials();
    const generation = this.generation;
    const selections = [...this.selections.values()];
    const warnings = this.discoveryWarning ? [this.discoveryWarning] : [];
    let week = requestedWeek;
    if (week === undefined) {
      try {
        week = await this.client.currentWeek(season);
      } catch {
        for (const selection of selections) {
          this.checkGeneration(generation);
          try {
            const raw = parseLeague(await this.client.league(credentials, selection.id, season));
            const latest = raw.status?.latestScoringPeriod;
            if (latest !== undefined && latest >= 1 && latest <= 18) { week = latest; break; }
          } catch { /* Another owned league may expose the current ESPN scoring period. */ }
        }
        if (week === undefined) throw new AppError(502, 'The current NFL scoring week could not be determined. The season may be inactive; retry when ESPN has current league data.');
        warnings.push('Current scoring week came from ESPN league status because the public game-state endpoint was unavailable.');
      }
    }
    const scoringWeek = week;
    const games = await this.client.scoreboard(season, scoringWeek).catch(() => {
      warnings.push('NFL schedule is unavailable. Player game links and bye/game status cannot be verified; fantasy points remain ESPN league data.');
      return [];
    });
    if (!games.length && !warnings.some(warning => warning.startsWith('NFL schedule'))) warnings.push('ESPN returned no NFL games for this week. Unlinked players may be on bye, inactive, or not yet scheduled.');
    const results = await mapBounded(selections, async selection => {
      try {
        this.checkGeneration(generation);
        let raw: EspnLeague = parseLeague(await this.client.league(credentials, selection.id, season, scoringWeek));
        const period = matchupPeriod(raw, scoringWeek);
        if (period !== undefined) {
          this.checkGeneration(generation);
          raw = parseLeague(await this.client.league(credentials, selection.id, season, scoringWeek, period));
        }
        return normalizeLeague(raw, { swid: credentials.swid, season, week: scoringWeek, teamId: selection.teamId, games });
      } catch (error) {
        warnings.push(`${selection.name} (league ${selection.id}): ${safeMessage(error)}`);
        return undefined;
      }
    });
    this.checkGeneration(generation);
    const successful = results.filter((result): result is NonNullable<typeof result> => result !== undefined);
    if (!successful.length) throw new AppError(502, 'No connected league could be refreshed from ESPN. Check your connection and sign in again if your session expired.');
    return {
      source: 'espn', season, week: scoringWeek, fetchedAt: this.now().toISOString(),
      leagues: successful.map(result => result.league), games, players: successful.flatMap(result => result.players),
      warnings: [...new Set([...warnings, ...successful.flatMap(result => result.warnings)])],
    };
  }
}
