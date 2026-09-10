import type { EspnGateway } from '../server/espn';
import type { SqlDatabase } from './storage';
import { z } from 'zod';
import { DashboardService, type DashboardState } from '../server/service';
import { AppError, safeMessage } from '../server/errors';
import { leagueIdSchema } from '../server/schemas';
import { randomToken, VaultCrypto } from './crypto';

export interface Env {
  DB: SqlDatabase;
  VAULT_KEY: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
interface SessionRow {
  id: string;
  ciphertext: string;
  revision: number;
  csrf: string;
  token_hash: string;
}
const SESSION = '__Host-hq_session';
const PREAUTH = '__Host-hq_pre';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const empty = z.object({}).strict();
const recoveryInput = z.object({ recoveryKey: z.string().regex(/^hq_[A-Za-z0-9_-]{43}$/) }).strict();
const deletionInput = z.object({ confirm: z.literal(true) }).strict();
const cookies = (request: Request) => new Map((request.headers.get('Cookie') ?? '').split(';').map(part => {
  const index = part.indexOf('=');
  return [part.slice(0, index).trim(), part.slice(index + 1)];
}));
const cookieHeader = (name: string, value: string, seconds: number) => `${name}=${value}; Max-Age=${seconds}; Path=/; HttpOnly; Secure; SameSite=Strict`;
const context = (row: Pick<SessionRow, 'id' | 'revision'>) => `state:${row.id}:${row.revision}`;
const requireEmpty = (body: unknown) => {
  if (!empty.safeParse(body).success) throw new AppError(400, 'This action accepts an empty JSON object only.');
};
async function bodyOf(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AppError(415, 'Use an application/json request body.');
  if (Number(request.headers.get('Content-Length') ?? 0) > 16_384) throw new AppError(413, 'Request body is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); throw new AppError(413, 'Request body is too large.'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'Invalid JSON request body.'); }
}
async function limit(env: Env, crypto: VaultCrypto, scope: string, identity: string, maximum: number, seconds: number, now: number) {
  const bucket = await crypto.sign('rate', `${scope}:${Math.floor(now / seconds)}:${identity}`);
  const result = await env.DB.prepare(
    'INSERT INTO rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits',
  ).bind(bucket, now + seconds * 2).first<{ hits: number }>();
  if (!result || result.hits > maximum) throw new AppError(429, 'Too many requests. Wait a few minutes before trying again.');
}
async function loadSession(request: Request, env: Env, cryptography: VaultCrypto, now: number) {
  const token = cookies(request).get(SESSION);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = await cryptography.sign('session-lookup', token);
  return env.DB.prepare(
    'SELECT v.id,v.ciphertext,v.revision,s.csrf,s.token_hash FROM sessions s JOIN vaults v ON v.id=s.vault_id WHERE s.token_hash=? AND s.expires_at>?',
  ).bind(hash, now).first<SessionRow>();
}
async function preauth(request: Request, cryptography: VaultCrypto, now: number): Promise<string | undefined> {
  const value = cookies(request).get(PREAUTH);
  if (!value || value.length > 150) return undefined;
  const [expires, nonce, signature, extra] = value.split('.');
  if (extra || !/^\d+$/.test(expires) || !/^[A-Za-z0-9_-]{43}$/.test(nonce ?? '') || Number(expires) <= now || Number(expires) > now + 600) return undefined;
  return await cryptography.verify('preauth', `${expires}.${nonce}`, signature ?? '') ? value : undefined;
}
export function createHandler(client?: EspnGateway) {
  let currentKey: string | undefined;
  let cryptography: VaultCrypto;
  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    try {
      const origin = request.headers.get('Origin');
      const site = request.headers.get('Sec-Fetch-Site');
      if ((origin !== null && origin !== url.origin) || (site !== null && !['same-origin', 'none'].includes(site))) throw new AppError(403, 'Cross-origin requests are not allowed. Open your dashboard directly.');
      if (!['GET', 'POST'].includes(request.method)) throw new AppError(405, 'This method is not supported.');
      if (currentKey !== env.VAULT_KEY) {
        cryptography = new VaultCrypto(env.VAULT_KEY);
        currentKey = env.VAULT_KEY;
      }
      const now = Math.floor(Date.now() / 1000);
      const session = await loadSession(request, env, cryptography, now);
      const pre = session ? undefined : await preauth(request, cryptography, now);
      const token = session?.csrf ?? (pre ? await cryptography.sign('csrf', pre) : undefined);
      let body: unknown;
      if (request.method === 'POST') {
        const supplied = request.headers.get('X-Dashboard-Token') ?? '';
        if (origin !== url.origin || !token || !await cryptography.verify('csrf-check', supplied, await cryptography.sign('csrf-check', token))) throw new AppError(403, 'Your dashboard token expired or is invalid. Reload this page and retry.');
        body = await bodyOf(request);
      }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        if (session) {
          const state = await cryptography.decrypt(session.ciphertext, context(session));
          const service = new DashboardService({ state, client });
          return json({ ...service.status(), mode: 'cloud', vaultAuthenticated: true, csrfToken: session.csrf });
        }
        const unsigned = `${now + 600}.${randomToken()}`;
        const challenge = pre ?? `${unsigned}.${await cryptography.sign('preauth', unsigned)}`;
        if (!pre) headers.append('Set-Cookie', cookieHeader(PREAUTH, challenge, 600));
        if (cookies(request).get(SESSION)) headers.append('Set-Cookie', cookieHeader(SESSION, '', 0));
        return json({ mode: 'cloud', authenticated: false, vaultAuthenticated: false, loginPending: false, csrfToken: await cryptography.sign('csrf', challenge) });
      }
      if (request.method === 'POST' && ['/api/vaults', '/api/vaults/login'].includes(url.pathname)) {
        if (session) throw new AppError(409, 'Sign out before opening a different private dashboard.');
        const create = url.pathname === '/api/vaults';
        if (create) requireEmpty(body);
        const input = create ? undefined : recoveryInput.safeParse(body);
        if (input && !input.success) throw new AppError(400, 'Enter the complete recovery key beginning with hq_.');
        await limit(env, cryptography, create ? 'create' : 'login', request.headers.get('CF-Connecting-IP') ?? 'local', create ? 5 : 20, create ? 3600 : 900, now);
        let id: string;
        let recoveryKey: string | undefined;
        if (create) {
          await limit(env, cryptography, 'global-create', 'all', 200, 86_400, now);
          id = crypto.randomUUID();
          recoveryKey = `hq_${randomToken()}`;
        } else {
          if (!input?.success) throw new AppError(400, 'A recovery key is required.');
          const hash = await cryptography.sign('recovery-lookup', input.data.recoveryKey);
          const row = await env.DB.prepare('SELECT id FROM vaults WHERE recovery_hash=?').bind(hash).first<{ id: string }>();
          if (!row) throw new AppError(401, 'That recovery key does not match a private dashboard.');
          id = row.id;
        }
        const sessionToken = randomToken();
        const sessionHash = await cryptography.sign('session-lookup', sessionToken);
        const csrf = randomToken();
        const insertSession = env.DB.prepare('INSERT INTO sessions(token_hash,vault_id,csrf,expires_at) SELECT ?,id,?,? FROM vaults WHERE id=?').bind(sessionHash, csrf, now + SESSION_SECONDS, id);
        if (recoveryKey) {
          const ciphertext = await cryptography.encrypt({ version: 1, selections: [] }, `state:${id}:0`);
          await env.DB.batch([
            env.DB.prepare('INSERT INTO vaults(id,recovery_hash,ciphertext,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id, await cryptography.sign('recovery-lookup', recoveryKey), ciphertext, now, now),
            insertSession,
          ]);
        } else {
          const result = await insertSession.run();
          if (!result.meta.changes) throw new AppError(409, 'The private dashboard changed. Please retry.');
        }
        headers.append('Set-Cookie', cookieHeader(SESSION, sessionToken, SESSION_SECONDS));
        headers.append('Set-Cookie', cookieHeader(PREAUTH, '', 0));
        return json(recoveryKey ? { recoveryKey } : { ok: true });
      }
      if (!session) throw new AppError(401, 'Open your private dashboard with its recovery key first.');
      if (request.method === 'POST' && url.pathname === '/api/vaults/logout') {
        requireEmpty(body);
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session.token_hash).run();
        headers.append('Set-Cookie', cookieHeader(SESSION, '', 0));
        return json({ ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/vaults/delete') {
        if (!deletionInput.safeParse(body).success) throw new AppError(400, 'Explicitly confirm deletion of this private dashboard.');
        await env.DB.prepare('DELETE FROM vaults WHERE id=?').bind(session.id).run();
        headers.append('Set-Cookie', cookieHeader(SESSION, '', 0));
        return json({ ok: true });
      }
      const service = new DashboardService({ state: await cryptography.decrypt(session.ciphertext, context(session)), client, maxAutoLeagues: 20 });
      if (request.method === 'GET' && url.pathname === '/api/leagues') return json({ leagues: service.leagues() });
      if (request.method === 'POST' && ['/api/connect', '/api/leagues', '/api/logout'].includes(url.pathname)) {
        if (url.pathname === '/api/logout') { requireEmpty(body); await service.logout(); }
        else {
          await limit(env, cryptography, 'mutate', session.id, 15, 300, now);
          if (url.pathname === '/api/connect') await service.connect(body);
          else await service.selectLeague(body);
        }
        const nextRevision = session.revision + 1;
        const ciphertext = await cryptography.encrypt(service.exportState(), `state:${session.id}:${nextRevision}`);
        const [updated] = await env.DB.batch([
          env.DB.prepare('UPDATE vaults SET ciphertext=?,revision=?,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?)')
            .bind(ciphertext, nextRevision, now, session.id, session.revision, session.token_hash, Math.floor(Date.now() / 1000)),
          env.DB.prepare('DELETE FROM dashboard_cache WHERE vault_id=? AND revision<?').bind(session.id, nextRevision),
        ]);
        if (!updated.meta.changes) throw new AppError(409, 'Your dashboard changed while this request was running. Reload before retrying.');
        return json(url.pathname === '/api/leagues' ? { leagues: service.leagues() } : { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        const query = z.object({ leagueId: leagueIdSchema }).strict().safeParse(Object.fromEntries(url.searchParams));
        if (!query.success) throw new AppError(400, 'Choose exactly one connected league ID to refresh.');
        const selection = service.leagues().find(league => league.id === query.data.leagueId);
        if (!selection) throw new AppError(403, 'This league is not connected to your private dashboard.');
        await limit(env, cryptography, 'dashboard', session.id, 200, 60, now);
        const cacheContext = `cache:${session.id}:${session.revision}:${selection.id}`;
        const cached = await env.DB.prepare('SELECT ciphertext FROM dashboard_cache WHERE vault_id=? AND league_id=? AND revision=? AND expires_at>?')
          .bind(session.id, selection.id, session.revision, now).first<{ ciphertext: string }>();
        if (cached) return json(await cryptography.decrypt(cached.ciphertext, cacheContext));
        const state: DashboardState = service.exportState();
        state.selections = [selection];
        const data = await new DashboardService({ state, client }).dashboard();
        const ciphertext = await cryptography.encrypt(data, cacheContext);
        const result = await env.DB.prepare(
          'INSERT INTO dashboard_cache(vault_id,league_id,revision,ciphertext,expires_at) SELECT id,?,?,?,? FROM vaults WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?) ON CONFLICT(vault_id,league_id) DO UPDATE SET revision=excluded.revision,ciphertext=excluded.ciphertext,expires_at=excluded.expires_at',
        ).bind(selection.id, session.revision, ciphertext, Math.floor(Date.now() / 1000) + 25, session.id, session.revision, session.token_hash, Math.floor(Date.now() / 1000)).run();
        if (!result.meta.changes) throw new AppError(409, 'Your dashboard changed while refreshing. Reload this page.');
        return json(data);
      }
      throw new AppError(404, 'Unknown dashboard API route.');
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Hosted dashboard operation failed.', { kind: error instanceof Error ? error.name : 'UnknownError' });
      return json({ error: safeMessage(error, 'The hosted dashboard could not complete this request. Please retry.') }, error instanceof AppError ? error.status : 500);
    }
  };
}

export default {
  fetch: createHandler(),
  async scheduled(_event: unknown, env: Env) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM dashboard_cache WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now),
    ]);
  },
};
