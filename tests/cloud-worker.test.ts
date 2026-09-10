import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHandler, type Env } from '../worker';
import { randomToken } from '../worker/crypto';
import type { SqlDatabase, SqlStatement } from '../worker/storage';
import { fixtureLeague, SWID } from './helpers/espn';
import type { EspnGateway } from '../server/espn';

class Statement implements SqlStatement {
  private values: SQLInputValue[] = [];
  constructor(private database: DatabaseSync, private sql: string) {}
  bind(...values: (string | number | null)[]) { this.values = values; return this; }
  async first<T>() { return (this.database.prepare(this.sql).get(...this.values) ?? null) as T | null; }
  execute() { return { meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } }; }
  async run() { return this.execute(); }
}
class Database implements SqlDatabase {
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string) { return new Statement(this.sqlite, sql); }
  async batch(statements: SqlStatement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const result = statements.map(statement => {
        if (!(statement instanceof Statement)) throw new Error('Unexpected SQL statement.');
        return statement.execute();
      });
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
const origin = 'https://dashboard.example';
describe('hosted private dashboard API', () => {
  let database: DatabaseSync;
  let env: Env;
  let handler: ReturnType<typeof createHandler>;
  let client: EspnGateway;
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec(readFileSync(new URL('../migrations/0001_vaults.sql', import.meta.url), 'utf8'));
    env = { DB: new Database(database), VAULT_KEY: randomToken(), ASSETS: { fetch: async () => new Response('assets') } };
    client = {
      validate: vi.fn(async () => ({})),
      discover: vi.fn(async () => ({ leagueIds: ['123'], warning: '' })),
      league: vi.fn(async () => fixtureLeague()),
      currentWeek: vi.fn(async () => 1),
      scoreboard: vi.fn(async () => []),
    };
    handler = createHandler(client);
  });
  afterEach(() => database.close());
  class Browser {
    cookie = '';
    token = '';
    async request(path: string, body?: unknown, extra: Record<string, string> = {}) {
      const response = await handler(new Request(`${origin}/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie: this.cookie, origin, 'content-type': 'application/json', 'x-dashboard-token': this.token, ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), env);
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const name = pair.split('=')[0];
        this.cookie = [...this.cookie.split('; ').filter(value => value && !value.startsWith(`${name}=`)), pair].join('; ');
      }
      return response;
    }
    async session() {
      const response = await this.request('session');
      const session = await response.json();
      this.token = session.csrfToken;
      return session;
    }
    async create() {
      await this.session();
      const response = await this.request('vaults', {});
      expect(response.status).toBe(200);
      const { recoveryKey } = await response.json();
      await this.session();
      return recoveryKey as string;
    }
  }
  it('creates private sessions without exposing recovery keys in storage or readable cookies', async () => {
    const browser = new Browser();
    const initial = await browser.session();
    expect(initial).toMatchObject({ mode: 'cloud', authenticated: false, vaultAuthenticated: false });
    const recovery = await browser.create();
    expect(recovery).toMatch(/^hq_[A-Za-z0-9_-]{43}$/);
    expect(await browser.session()).toMatchObject({ vaultAuthenticated: true, authenticated: false });
    expect(JSON.stringify(database.prepare('SELECT * FROM vaults').all())).not.toContain(recovery);
    const other = new Browser();
    expect((await other.request('leagues')).status).toBe(401);
    await other.session();
    expect((await other.request('vaults/login', { recoveryKey: recovery })).status).toBe(200);
    expect(await other.session()).toMatchObject({ vaultAuthenticated: true });
  });
  it('uses host-only HttpOnly browser cookies and rejects cross-site reads', async () => {
    const browser = new Browser();
    const response = await browser.request('session');
    expect(response.headers.get('Set-Cookie')).toMatch(/__Host-hq_pre=.*HttpOnly; Secure; SameSite=Strict/);
    expect(response.headers.get('Set-Cookie')).not.toContain('Domain=');
    expect((await browser.request('session', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
  it('requires origin, CSRF, valid bodies, and an authenticated vault', async () => {
    const browser = new Browser();
    await browser.session();
    expect((await browser.request('vaults', {}, { origin: 'https://other.example' })).status).toBe(403);
    expect((await browser.request('vaults', {}, { 'x-dashboard-token': 'wrong' })).status).toBe(403);
    expect((await browser.request('connect', { swid: SWID, espnS2: 'cookie' })).status).toBe(401);
    await browser.create();
    expect((await browser.request('connect', { swid: SWID, espnS2: 'cookie\r\nInjected:yes' })).status).toBe(400);
    expect((await browser.request('vaults/delete', { confirm: false })).status).toBe(400);
  });
  it('encrypts ESPN cookies, isolates leagues, disconnects, and revokes every session on deletion', async () => {
    const owner = new Browser();
    const key = await owner.create();
    expect((await owner.request('connect', { swid: SWID, espnS2: 'private-espn-cookie', season: 2026 })).status).toBe(200);
    expect(JSON.stringify(database.prepare('SELECT * FROM vaults').all())).not.toContain('private-espn-cookie');
    expect((await (await owner.request('leagues')).json()).leagues).toHaveLength(1);
    const stranger = new Browser();
    await stranger.create();
    expect((await stranger.request('dashboard?leagueId=123')).status).toBe(401);
    const second = new Browser();
    await second.session();
    await second.request('vaults/login', { recoveryKey: key });
    await second.session();
    await owner.request('logout', {});
    expect(await second.session()).toMatchObject({ authenticated: false, vaultAuthenticated: true });
    await owner.request('vaults/delete', { confirm: true });
    expect(await second.session()).toMatchObject({ vaultAuthenticated: false });
    expect(database.prepare('SELECT count(*) AS count FROM sessions').get()?.count).toBe(1);
    expect(database.prepare('SELECT count(*) AS count FROM dashboard_cache').get()?.count).toBe(0);
  });
  it.each(['logout', 'vaults/logout', 'vaults/delete'])('never resurrects an in-flight ESPN connection after %s', async action => {
    const browser = new Browser();
    await browser.create();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(client.validate).mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return {}; });
    const pending = browser.request('connect', { swid: SWID, espnS2: 'cookie', season: 2026 });
    await started;
    expect((await browser.request(action, action.endsWith('/delete') ? { confirm: true } : {})).status).toBe(200);
    release();
    expect((await pending).status).toBe(409);
    expect(await browser.session()).toMatchObject({ authenticated: false });
  });
  it('refreshes only a selected league, encrypts cached scores, and invalidates cache on disconnect', async () => {
    const browser = new Browser();
    await browser.create();
    await browser.request('connect', { swid: SWID, espnS2: 'cookie', season: 2026 });
    expect((await browser.request('dashboard?leagueId=456')).status).toBe(403);
    expect((await browser.request('dashboard?leagueId=123&other=456')).status).toBe(400);
    const first = await browser.request('dashboard?leagueId=123');
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ source: 'espn', season: 2026, week: 1, leagues: [{ id: '123' }] });
    expect(JSON.stringify(database.prepare('SELECT * FROM dashboard_cache').all())).not.toContain('Fixture League');
    vi.mocked(client.league).mockClear();
    expect((await browser.request('dashboard?leagueId=123')).status).toBe(200);
    expect(client.league).not.toHaveBeenCalled();
    await browser.request('logout', {});
    expect(database.prepare('SELECT count(*) AS count FROM dashboard_cache').get()?.count).toBe(0);
    expect((await browser.request('dashboard?leagueId=123')).status).toBe(401);
  });
  it('rejects oversized streamed bodies and inappropriate content types', async () => {
    const browser = new Browser();
    await browser.create();
    expect((await browser.request('connect', { padding: 'x'.repeat(17_000) })).status).toBe(413);
    expect((await browser.request('logout', {}, { 'content-type': 'text/plain' })).status).toBe(415);
  });
  it('signs out only this browser and refuses expired or revoked sessions', async () => {
    const browser = new Browser();
    const key = await browser.create();
    const oldCookie = browser.cookie;
    await browser.request('vaults/logout', {});
    browser.cookie = oldCookie;
    expect(await browser.session()).toMatchObject({ vaultAuthenticated: false });
    await browser.request('vaults/login', { recoveryKey: key });
    database.exec('UPDATE sessions SET expires_at = 0');
    expect(await browser.session()).toMatchObject({ vaultAuthenticated: false });
  });
  it('rate limits repeated recovery attempts and returns private response headers', async () => {
    const browser = new Browser();
    await browser.session();
    let response!: Response;
    for (let attempt = 0; attempt < 21; attempt++) response = await browser.request('vaults/login', { recoveryKey: `hq_${randomToken()}` });
    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
