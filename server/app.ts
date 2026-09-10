import { timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError, safeMessage } from './errors';
import { DashboardService } from './service';
import { seasonSchema, weekSchema } from './schemas';

const emptyBody = z.object({}).strict();
const querySchema = z.object({
  season: z.string().regex(/^\d{4}$/).transform(Number).pipe(seasonSchema).optional(),
  week: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(weekSchema).optional(),
}).strict();

export function localGuard(service: DashboardService): RequestHandler {
  return (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const host = request.headers.host;
    const port = request.socket.localPort;
    const remote = request.socket.remoteAddress;
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
    if (port === 80) { allowedHosts.add('localhost'); allowedHosts.add('127.0.0.1'); allowedHosts.add('[::1]'); }
    if (!remote || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) || !host || !allowedHosts.has(host)) {
      next(new AppError(403, 'This app only accepts direct localhost requests with a trusted Host header.'));
      return;
    }
    const origin = request.get('Origin');
    const site = request.get('Sec-Fetch-Site');
    if ((origin !== undefined && origin !== `http://${host}`) || (site !== undefined && !['same-origin', 'none'].includes(site))) {
      next(new AppError(403, 'Cross-origin requests are not allowed. Open the local dashboard directly.'));
      return;
    }
    const mutation = !['GET', 'HEAD'].includes(request.method);
    if (mutation) {
      const token = request.get('X-Dashboard-Token') ?? '';
      const expected = service.status().csrfToken;
      const tokenBuffer = Buffer.from(token);
      const expectedBuffer = Buffer.from(expected);
      if (origin !== `http://${host}` || tokenBuffer.length !== expectedBuffer.length || !timingSafeEqual(tokenBuffer, expectedBuffer)) {
        next(new AppError(403, 'Invalid local dashboard token or origin. Reload this local page and retry.'));
        return;
      }
      if (!request.is('application/json')) {
        next(new AppError(415, 'Use an application/json request body.'));
        return;
      }
    }
    next();
  };
}

export function createApp(service = new DashboardService()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(localGuard(service));
  app.use('/api', express.json({ limit: '16kb', strict: true }));
  app.get('/api/session', (_request, response) => { response.json(service.status()); });
  app.post('/api/login', (request, response) => {
    if (!emptyBody.safeParse(request.body).success) throw new AppError(400, 'Sign-in accepts an empty JSON object only. Enter your password only on ESPN’s official page.');
    service.startLogin();
    response.json({ ok: true });
  });
  app.post('/api/connect', async (request, response) => {
    await service.connect(request.body);
    response.json({ ok: true });
  });
  app.post('/api/logout', async (request, response) => {
    if (!emptyBody.safeParse(request.body).success) throw new AppError(400, 'Logout accepts an empty JSON object only.');
    await service.logout();
    response.json({ ok: true });
  });
  app.get('/api/leagues', (_request, response) => { response.json({ leagues: service.leagues() }); });
  app.post('/api/leagues', async (request, response) => {
    await service.selectLeague(request.body);
    response.json({ leagues: service.leagues() });
  });
  app.get('/api/dashboard', async (request, response) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) throw new AppError(400, 'Invalid season or week. Use a season from 2019–2100 and a scoring week from 1–18.');
    response.json(await service.dashboard(query.data));
  });
  app.use('/api', (_request, response) => { response.status(404).json({ error: 'Unknown local API route.' }); });
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (response.headersSent) return;
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body is too large.' });
      return;
    }
    response.status(error instanceof AppError ? error.status : 502).json({ error: safeMessage(error) });
  };
  app.use(handleError);
  return app;
}
