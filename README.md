# Sunday HQ

**Every player. Every league. One view.**

A responsive ESPN Fantasy Football command center for the multi-league life. See the players you need to go off, the opponents you need to slow down, and the games that matter across your starting lineups.

**[Try the public demo](https://daniel-beachy.github.io/fantasy-dashboard-v1/)** · **[Connect your ESPN account](#connect-your-espn-account)**

## What you get

- **A chronological gameday feed:** currently playing, upcoming today, later this week, completed games, and byes or unavailable schedules.
- **Both sides of every matchup:** starting players, positions, NFL teams, league names, lineup slots, injury designations, live stats, and league-specific fantasy points.
- **League pulse:** matchup scores, projected totals, and current leads or deficits.
- **A rooting guide:** players you own, players you face, and mixed allegiances across leagues. Counts are appearances, not a claimed win-probability model.
- **A persistent watchlist:** star a player once and follow every appearance across your leagues.
- **Composable filters:** league, NFL game, position, name, team, ownership, and watchlist. Press `/` to search.
- **Gameday-friendly behavior:** 30-second refresh while the page is visible, pause/resume, manual refresh, last-success timestamps, explicit stale-data warnings, dark/light themes, and mobile layouts.

## Public demo versus your real leagues

| Mode | Where it runs | What it shows |
| --- | --- | --- |
| Public demo | GitHub Pages | An explicitly labeled, fixed illustrative Week 1 snapshot with three leagues and 54 starting appearances. Not current NFL scores, schedules, or rosters. |
| ESPN-connected | Your computer | Your current ESPN football season, owned teams, active matchups, starters, opponents, league scoring, and the NFL game slate. |

GitHub Pages serves static files; it cannot run the server needed for private ESPN cookies. ESPN does not provide this project with a supported third-party OAuth login. **The public site does not collect passwords or session cookies and does not connect to a remote credential proxy.** Run the local companion to use your account. You cannot sign in to private leagues entirely on GitHub Pages.

## Connect your ESPN account

Requirements: **Node.js 22 or later**, npm, and an installed Microsoft Edge or Google Chrome browser. The optional bundled Chromium browser can be installed if needed.

```sh
git clone https://github.com/daniel-beachy/fantasy-dashboard-v1.git
cd fantasy-dashboard-v1
npm install
npm run dev
```

Open **http://127.0.0.1:3000**.

1. Select **Connect ESPN**, then **Sign in with ESPN**.
2. Sign in inside the separate, official ESPN browser window. Complete any verification ESPN requests. This application never receives your ESPN password.
3. Review the discovered leagues. If ESPN does not expose all memberships, add the numeric `leagueId` from each missing league's ESPN URL and select your owned team.
4. Select **Open my gameday**. Reconnect after restarting the companion; credentials are deliberately not persisted.

Alternatively, **Connect with ESPN cookies** accepts your own `SWID` and `espn_s2` from an existing ESPN browser session. In that browser, use Developer Tools -> Application -> Cookies -> `fantasy.espn.com`. Treat these values like passwords: never commit them, send them to anyone, or paste them into the public demo.

If the companion cannot launch a browser:

```sh
npx playwright install chromium
```

Use **Disconnect ESPN** to clear the in-memory session. Closing a dashboard tab does not stop its local server; `Ctrl+C` in the terminal stops the companion. This app is not a lineup editor and never changes your ESPN roster.

### Production build on your computer

```sh
npm run build
npm start
```

Open the same localhost address. `npm run dev:ui` starts only the Vite frontend on port 5173; it is useful for UI development but **does not run the ESPN companion**.

## Data and privacy

- The companion binds to loopback, not your LAN. Do not expose it with a tunnel, reverse proxy, or a public server.
- Session cookies are retained in server memory and sent only to ESPN. They are not returned to the frontend, saved in local storage, written into the repository, or sent to GitHub Pages.
- Local storage contains only your color theme and watchlist player IDs.
- Account operations require a per-process anti-CSRF token. The server restricts Host/Origin and does not enable cross-origin access.
- Browser sign-in uses an ephemeral context rather than reading an existing personal browser profile.
- ESPN endpoints are **unofficial** and can change or block requests. Discovery is best effort; the UI provides manual league entry rather than pretending enumeration is guaranteed.
- Points are league-specific. Different scoring rules can produce different scores for the same NFL performance. Missing values display `--`, not a fabricated zero.
- Multi-week fantasy matchups and NFL scoring weeks are distinct. Detailed player production uses the selected NFL scoring period; matchup totals can span a fantasy matchup period.
- Data may lag ESPN's own interface. On failed refresh, the last successful snapshot remains visible with an explicit error. A failed authenticated load never silently becomes demo data.
- Player headshots are loaded directly from ESPN's public image CDN. If blocked or unavailable, initials or a defense icon remain visible. ESPN sees those image requests even in demo mode.
- **Real-account authentication cannot be verified without the account holder signing in.** Automated coverage exercises the session contract and ESPN-shaped fixtures; it is not a claim that a particular private account has been tested.

## Development

```sh
npm test          # Model, adapter, and server tests
npm run build    # TypeScript check and production assets
npm run test:e2e # Desktop/mobile Playwright workflows
```

If Playwright reports a missing browser, run `npx playwright install chromium`. Browser tests use their own contexts and do not require or access a real ESPN account.

See [ESPN companion details](docs/ESPN.md) for the local API contract, identity verification, membership discovery, scoring semantics, request limits, and troubleshooting.

The app uses React, TypeScript, Vite, Lucide icons, Express, and Playwright. Styling uses the Clawpilot light/dark theme variables with no external font dependency.

```text
src/
  App.tsx                 Dashboard state, views, filters, refresh lifecycle
  components/             Player cards, matchup cards, dialogs
  data/demo.ts            Explicit illustrative snapshot
  lib/                    API client and pure gameday transformations
  types.ts                Frontend/companion contract
server/                   Local authentication and ESPN integration
tests/                    Model/server tests and browser workflows
.github/workflows/        GitHub Pages deployment
```

## GitHub Pages

The `pages.yml` workflow runs the tests, builds the frontend with the repository base path, and publishes only `dist`. No server code or credentials are needed by the deployed site.

In the repository's **Settings -> Pages**, choose **GitHub Actions** as the source. Push to `main` or manually run **Deploy Sunday HQ**. The public URL is:

https://daniel-beachy.github.io/fantasy-dashboard-v1/

## Attribution

An independent fan project, not affiliated with or endorsed by ESPN, the NFL, or any NFL team. Names, marks, and player images belong to their respective owners. No ESPN password capture, roster modifications, or supported/public ESPN API agreement is implied.
