import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch } }));
import { officialLogin } from '../server/auth';
const swid = '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}';
function browserFixture(cookies: { name: string; value: string }[] = []) {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    url: () => 'https://fantasy.espn.com/football/',
    locator: () => ({ evaluateAll: vi.fn().mockResolvedValue(['https://fantasy.espn.com/football/team?leagueId=123&seasonId=2026']) }),
  };
  const context = { cookies: vi.fn().mockResolvedValue(cookies), pages: () => [page], on: vi.fn(), newPage: vi.fn().mockResolvedValue(page) };
  const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn().mockResolvedValue(undefined), isConnected: () => true };
  return { browser, context, page };
}
beforeEach(() => {
  launch.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-09T20:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });
describe('official sign-in browser', () => {
  it('uses an ephemeral headed browser and only official ESPN navigation, then closes it', async () => {
    const { browser, page } = browserFixture([{ name: 'SWID', value: swid }, { name: 'espn_s2', value: 'test-cookie' }]);
    launch.mockResolvedValue(browser);
    const result = officialLogin(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1600);
    expect(await result).toEqual({ credentials: { swid, espnS2: 'test-cookie' }, leagueIds: ['123'] });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false }));
    expect(browser.newContext).toHaveBeenCalledWith({ acceptDownloads: false });
    expect(page.goto).toHaveBeenCalledWith('https://fantasy.espn.com/football/', expect.any(Object));
    expect(browser.close).toHaveBeenCalled();
  });
  it('closes a browser that launches after cancellation instead of creating a login page', async () => {
    const { browser } = browserFixture();
    let finish!: (value: typeof browser) => void;
    launch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const result = officialLogin(controller.signal);
    const assertion = expect(result).rejects.toThrow(/canceled/i);
    controller.abort();
    finish(browser);
    await assertion;
    expect(browser.close).toHaveBeenCalled();
    expect(browser.newContext).not.toHaveBeenCalled();
  });
  it('bounds login to five minutes and closes the browser on timeout', async () => {
    const { browser } = browserFixture();
    launch.mockResolvedValue(browser);
    const result = officialLogin(new AbortController().signal);
    const assertion = expect(result).rejects.toThrow(/five minutes/i);
    await vi.advanceTimersByTimeAsync(300_001);
    await assertion;
    expect(browser.close).toHaveBeenCalled();
  });
  it('gives a browser installation instruction without exposing Playwright errors', async () => {
    launch.mockRejectedValue(new Error('sensitive internal browser paths'));
    await expect(officialLogin(new AbortController().signal)).rejects.toThrow(/npx playwright install chromium/);
    expect(launch).toHaveBeenCalledTimes(process.platform === 'win32' ? 3 : 2);
  });
});
