import { chromium, type Browser, type BrowserContext } from 'playwright';
import { AppError } from './errors';
import { currentSeason, extractLeagueIds, leagueIdFromLink } from './normalize';
import { credentialsSchema, type Credentials } from './schemas';

export interface LoginResult { credentials: Credentials; leagueIds: string[] }
const LOGIN_URL = 'https://fantasy.espn.com/football/';
const MAX_LOGIN_MS = 5 * 60_000;

async function launchBrowser(signal: AbortSignal): Promise<Browser> {
  const channels: (string | undefined)[] = process.platform === 'win32' ? ['msedge', 'chrome', undefined] : ['chrome', undefined];
  for (const channel of channels) {
    signal.throwIfAborted();
    try {
      const browser = await chromium.launch({ channel, headless: false, timeout: 20_000 });
      if (signal.aborted) { await browser.close(); signal.throwIfAborted(); }
      return browser;
    } catch {
      if (signal.aborted) throw new AppError(409, 'ESPN sign-in was canceled.');
    }
  }
  throw new AppError(503, 'Could not open a sign-in browser. Install Microsoft Edge or Chrome, or run npx playwright install chromium in the app folder, then retry.');
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new AppError(409, 'ESPN sign-in was canceled.')); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new AppError(409, 'ESPN sign-in was canceled.')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function readCredentials(context: BrowserContext): Promise<Credentials | undefined> {
  const cookies = await context.cookies(LOGIN_URL);
  const swid = cookies.find(cookie => cookie.name === 'SWID')?.value;
  const espnS2 = cookies.find(cookie => cookie.name === 'espn_s2')?.value;
  const parsed = credentialsSchema.safeParse({ swid, espnS2 });
  return parsed.success ? parsed.data : undefined;
}

export async function officialLogin(parentSignal: AbortSignal): Promise<LoginResult> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  const timeout = setTimeout(() => controller.abort(), MAX_LOGIN_MS);
  let browser: Browser | undefined;
  let close: (() => void) | undefined;
  try {
    browser = await launchBrowser(signal);
    const activeBrowser = browser;
    close = () => { void activeBrowser.close().catch(() => undefined); };
    signal.addEventListener('abort', close, { once: true });
    signal.throwIfAborted();
    const context = await browser.newContext({ acceptDownloads: false });
    const leagueIds = new Set<string>();
    const season = currentSeason();
    context.on('response', response => {
      void (async () => {
        try {
          const url = new URL(response.url());
          if (!['fan.api.espn.com', 'lm-api-reads.fantasy.espn.com', 'fantasy.espn.com'].includes(url.hostname)) return;
          if (url.protocol !== 'https:' || response.status() !== 200 || !response.headers()['content-type']?.includes('json')) return;
          const league = url.pathname.match(new RegExp(`/games/ffl/seasons/${season}/segments/0/leagues/([1-9]\\d{0,11})$`));
          if (league) leagueIds.add(league[1]);
          // Only inspect membership responses, never login/password/identity payloads.
          if (url.hostname === 'fan.api.espn.com' && url.pathname.startsWith('/apis/v2/fans/')) {
            const length = Number(response.headers()['content-length'] ?? 0);
            if (length > 2_000_000) return;
            const body: unknown = await response.json();
            for (const id of extractLeagueIds(body, season)) leagueIds.add(id);
          }
        } catch { /* Closing a login browser can cancel in-flight ESPN responses. */ }
      })();
    });
    const page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    while (!signal.aborted && browser.isConnected()) {
      if (!context.pages().length) throw new AppError(409, 'The ESPN sign-in window was closed. Choose sign in to try again.');
      const credentials = await readCredentials(context);
      if (credentials) {
        await pause(1500, signal);
        for (const openPage of context.pages()) {
          try {
            if (new URL(openPage.url()).hostname !== 'fantasy.espn.com') continue;
            const links = await openPage.locator('a[href*="leagueId="]').evaluateAll(elements =>
              elements.map(element => element.getAttribute('href')).filter((href): href is string => href !== null));
            for (const link of links) {
              const id = leagueIdFromLink(link, season);
              if (id) leagueIds.add(id);
            }
          } catch { /* Page navigation or closing can invalidate its DOM. */ }
        }
        signal.throwIfAborted();
        return { credentials, leagueIds: [...leagueIds].slice(0, 50) };
      }
      await pause(1000, signal);
    }
    throw new AppError(409, 'The ESPN sign-in window was closed. Choose sign in to try again.');
  } catch (error) {
    if (parentSignal.aborted) throw new AppError(409, 'ESPN sign-in was canceled.');
    if (controller.signal.aborted) throw new AppError(408, 'ESPN sign-in timed out after five minutes. Choose sign in to try again.');
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'Could not complete official ESPN sign-in. Check your connection, finish any ESPN verification prompts, and retry.');
  } finally {
    clearTimeout(timeout);
    if (close) signal.removeEventListener('abort', close);
    await browser?.close().catch(() => undefined);
  }
}
