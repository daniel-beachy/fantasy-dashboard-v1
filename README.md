# Sunday HQ

**Every player. Every league. One view.**

A responsive ESPN Fantasy Football command center for the multi-league life. See the players you need to go off, the opponents you need to slow down, and the games that matter across your starting lineups.

**[Open Sunday HQ](https://fantasy-dashboard-v1.daniel-beachy.workers.dev/)** · **[Static demo](https://daniel-beachy.github.io/fantasy-dashboard-v1/)** · **[Run locally](#connect-your-espn-account-locally)**

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
| Connected web app | Cloudflare Workers + D1 | Your ESPN leagues in a private, encrypted dashboard that can be reopened on another device. |
| Local companion | Your computer | The same ESPN data with official browser sign-in and in-memory-only credentials. |

GitHub Pages remains a static demo and never accepts account cookies. The connected web app runs its backend on Cloudflare. ESPN does not provide this project with a supported third-party OAuth login: **the hosted app connects an existing ESPN session, not an ESPN username/password**.

## Connect your ESPN account

1. Open [Sunday HQ on Cloudflare](https://fantasy-dashboard-v1.daniel-beachy.workers.dev/) and select **Connect ESPN**.
2. Create a private dashboard and save its generated **recovery key** in a password manager. This key is the only way to reopen that dashboard after signing out or on another device.
3. Sign in to ESPN in your normal browser. Copy your own `SWID` and `espn_s2` values from Developer Tools -> Application -> Cookies on the ESPN fantasy site, then import them into your private dashboard.
4. Review discovered leagues, add missing numeric league IDs, and open your gameday view.

No local server is needed for the hosted version. For another device, open the same site and use your saved recovery key; you do not need to import cookies again until ESPN expires the session. Cookie extraction may require a desktop browser even though the dashboard works on phones.

**Trust and privacy:** ESPN cookies are account credentials. The Cloudflare application encrypts them at rest, but its backend must decrypt them to call ESPN. This is not end-to-end encryption: the deployment operator and hosting platform are part of the trust boundary. Never share a recovery key or cookie in an issue, message, screenshot, or URL. This application never asks for your ESPN password.

**Disconnect ESPN** removes the stored ESPN session but keeps the private dashboard. **Sign out** ends this browser's session only. **Delete private dashboard** removes its active stored credentials, cached data, and every browser session. Save the recovery key before closing its creation screen; lost keys cannot be recovered.

See [Cloudflare hosting and privacy](docs/CLOUDFLARE.md) for the API, free-tier limits, and deployment instructions.

## Connect your ESPN account locally

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
- In local mode, ESPN cookies stay in server memory. In hosted mode, they are encrypted in Cloudflare D1. The backend sends them only to fixed ESPN endpoints, never returns them to the frontend, and never sends them to GitHub Pages.
- Local storage contains only your color theme and watchlist player IDs.
- Account operations require anti-CSRF tokens and exact same-origin requests. Hosted browser sessions use host-only Secure, HttpOnly, SameSite=Strict cookies; no permissive CORS is enabled.
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
npm run build:cloud # TypeScript check and Cloudflare assets
```

If Playwright reports a missing browser, run `npx playwright install chromium`. Browser tests use their own contexts and do not require or access a real ESPN account.

See [ESPN companion details](docs/ESPN.md) for the local API contract, identity verification, membership discovery, scoring semantics, request limits, and troubleshooting.

The app uses React, TypeScript, Vite, Lucide icons, Cloudflare Workers/D1, Express, and Playwright. Styling uses the Clawpilot light/dark theme variables with no external font dependency.

```text
src/
  App.tsx                 Dashboard state, views, filters, refresh lifecycle
  components/             Player cards, matchup cards, dialogs
  data/demo.ts            Explicit illustrative snapshot
  lib/                    API client and pure gameday transformations
  types.ts                Frontend/companion contract
server/                   Local authentication and ESPN integration
worker/                   Hosted sessions, encrypted state, private API
migrations/               Cloudflare D1 schema
scripts/                  Credential-free runtime smoke checks
tests/                    Model/server tests and browser workflows
.github/workflows/        GitHub Pages deployment
```

## GitHub Pages

The `pages.yml` workflow runs the tests, builds the frontend with the repository base path, and publishes only `dist`. No server code or credentials are needed by the deployed site.

In the repository's **Settings -> Pages**, choose **GitHub Actions** as the source. Push to `main` or manually run **Deploy Sunday HQ**. The public URL is:

https://daniel-beachy.github.io/fantasy-dashboard-v1/

## Attribution

An independent fan project, not affiliated with or endorsed by ESPN, the NFL, or any NFL team. Names, marks, and player images belong to their respective owners. No ESPN password capture, roster modifications, or supported/public ESPN API agreement is implied.
