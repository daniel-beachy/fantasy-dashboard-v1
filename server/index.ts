import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { DashboardService } from './service';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer from 1 to 65535.');
  process.exit(1);
}
const production = process.argv.includes('--production');
const service = new DashboardService();
const app = createApp(service);
let closeVite: (() => Promise<void>) | undefined;
if (production) {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error('Built frontend not found. Run npm run build before npm start.');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false }));
  app.get('/{*path}', (_request, response) => { response.sendFile(path.join(dist, 'index.html')); });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    server: { middlewareMode: true, host: '127.0.0.1', allowedHosts: ['localhost', '127.0.0.1'] },
    appType: 'spa',
  });
  closeVite = () => vite.close();
  app.use(vite.middlewares);
}
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Fantasy dashboard: http://127.0.0.1:${port} — ESPN credentials stay in memory.`);
});
server.on('error', () => {
  console.error('Could not bind the local dashboard port. Close the other server or set PORT to another free port.');
  void shutdown();
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await service.logout();
  await closeVite?.();
  server.close();
  server.closeAllConnections();
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
