# ESPN local companion

The hosted dashboard is a demo. Private ESPN data is available only when this app runs on your computer:

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. To use a different port, run `$env:PORT = '3001'; npm run dev`. For a built local frontend, run `npm run build`, then `npm start`.

## Official sign-in and privacy

Select **Sign in** in the local dashboard. The companion opens ESPN's official `https://fantasy.espn.com/football/` page in a headed, non-persistent Playwright browser context. Enter your password and complete verification **only on ESPN's page**. The companion does not receive passwords, automate the login form, modify your ESPN account, or write your league rosters.

The browser closes after capturing the `SWID` and `espn_s2` session cookies, cancellation, or a five-minute timeout. Microsoft Edge is tried first on Windows, followed by Chrome and bundled Chromium. If no supported browser is available, install Edge/Chrome or run:

```powershell
npx playwright install chromium
```

The app stores credentials and selected teams only in its server process memory. It never returns credentials to frontend JavaScript, writes a credential file, or uses localStorage for authentication. Browser contexts are ephemeral, not your normal browser profile. Logout clears the process session, league choices, cached data, and pending sign-in; shutting down the app also clears the session. This is one local-machine session, shared by tabs opened on that companion.

Own-cookie import is an optional fallback. Copy only the values of **your own** `SWID` and `espn_s2` cookies from an already signed-in ESPN page. Treat `espn_s2` like a password. Never put it in an issue, URL, screenshot, source file, or committed environment file.

### Honest authentication and discovery limitations

ESPN does not provide this app an official OAuth integration. Its unofficial read endpoints can change, deny access, or rate-limit requests. Cookies are not considered authenticated merely because they have the right format: the server requires a matching account identity from the Fan API with cookies, and verifies that an anonymous request is denied. If that endpoint becomes publicly readable or cannot verify identity, the app **fails closed** with an actionable error rather than claiming successful authentication.

Discovery uses the Fan API's current-season football preferences and league links / read-request URLs observed in the official sign-in browser. It verifies league access and SWID team ownership before tracking a league. Discovery is **not guaranteed exhaustive**; `discoveryWarning` always explains that missing league IDs can be added manually. The ID is the numeric `leagueId` in your ESPN league URL. No historical-league endpoint is treated as a list of your leagues.

No real user login was performed during implementation. Browser lifecycle and authenticated responses are tested with fixtures; public ESPN NFL schedule, game-state, and player-position endpoints were checked without credentials.

## Local API

All responses containing data are JSON, with `Cache-Control: no-store`. Errors are always `{ "error": "safe actionable message" }`; no upstream bodies, credentials, or stack traces are reflected.

The server binds to **127.0.0.1 only**. Host must be `127.0.0.1:<actual-port>` or `localhost:<actual-port>` (IPv6 loopback Host is recognized, but the default listener is IPv4). Origin, when supplied, must exactly match the HTTP Host. Cross-origin and cross-site private reads are rejected; there is no permissive CORS or hosted-page-to-localhost bridge. Do not expose this port through a reverse proxy or tunnel.

Every mutation requires all of:

- `Content-Type: application/json`
- Exact same-origin `Origin`, supplied automatically by browsers
- `X-Dashboard-Token` equal to the secure, in-memory token returned by `GET /api/session`

| Method | Route | Body/query | Successful response |
|---|---|---|---|
| GET | `/api/session` | None | `SessionStatus`: `authenticated`, `loginPending`, `csrfToken`, optional `loginError`, `discoveryWarning` |
| POST | `/api/login` | `{}` | `{ "ok": true }` immediately; poll `/api/session` |
| POST | `/api/connect` | `{ "swid": "...", "espnS2": "...", "season"?: 2026, "leagueIds"?: ["123"] }` | `{ "ok": true }` only after account verification and discovery |
| POST | `/api/logout` | `{}` | `{ "ok": true }` |
| GET | `/api/leagues` | None | `{ "leagues": LeagueSelection[] }` |
| POST | `/api/leagues` | `{ "leagueId": "123", "teamId"?: 1 }` | `{ "leagues": LeagueSelection[] }`; team must be owned by the signed-in SWID |
| GET | `/api/dashboard` | Optional `season`, `week` | `DashboardData` with `source: "espn"` |

Unknown fields are rejected on mutations and dashboard queries. League IDs are decimal strings, team IDs positive integers, supported seasons 2019–2100, and NFL regular-season scoring weeks 1–18. Request bodies are capped at 16 KiB. Cookie import rejects semicolons, control characters, spaces, and header-injection syntax.

Common statuses: `400` invalid input/no connected leagues, `401` sign-in needed/ESPN access denied, `403` invalid origin/token or unowned team, `404` missing league/route, `409` session changed during a request, `413` oversized body, `415` unsupported content type, `502` unavailable/malformed upstream data, `503` unavailable browser/rate limit.

## Scoring and schedule semantics

- Default season is the current calendar year, except January/February use the previous NFL season. The current scoring week is read from ESPN's `kona_game_state`, falling back to freshly fetched league `status.latestScoringPeriod`; it is not guessed from the date.
- League requests use `mTeam`, `mSettings`, `mRoster`, `mMatchupScore`, and `mScoreboard`. Box-score filtering uses `schedule.filterMatchupPeriodIds`; matchup periods are resolved using `settings.scheduleSettings.matchupPeriods`, not confused with NFL scoring weeks.
- `rosterForCurrentScoringPeriod` is preferred to the current team roster. Bench 20, IR 21, empty 22, and rookie reserve 25 are excluded. Unknown slots are excluded with a warning. A requested week that ESPN ignores is rejected, not shown with stale scores.
- Player points are **only** the league-applied `appliedTotal` for the requested `seasonId`, `scoringPeriodId`, `statSplitTypeId: 1`, `statSourceId: 0`. Projections use source 1. Season aggregates, other weeks, and unweighted raw statistics are never substituted.
- Matchup scores prefer `totalPointsLive`, then `totalPoints`; projections prefer ESPN's corresponding projected total. Only a complete known starting lineup can supply a fallback sum of weekly projections, and that fallback is disabled for multi-week matchups.
- Multi-week playoff **matchup totals** can include prior weeks, while individual player points are current-week only; an explicit warning explains that difference. A missing score is `null`, never fabricated zero. Zero remains zero.
- Player appearance IDs are `leagueId-teamId-playerId`, preserving players appearing across multiple leagues or on opposite sides.
- Natural positions use `defaultPositionId`, separately from lineup-slot IDs; e.g. QB 1, RB 2, WR 3, TE 4, K 5, DE 10, LB 11, S 13, D/ST 16. Per-week `proTeamId` is preferred after trades.
- NFL scoreboard data supplies kickoff, home/away scores, live/final/upcoming/postponed state, detailed clock/status, and broadcast. Team abbreviations are normalized. Bye/unmapped players have `gameId: null`; schedule failures generate a warning rather than fake games.
- Successful leagues survive partial failures with per-league warnings. If none refresh, the dashboard request fails. League fetch work is bounded to four concurrent leagues; each external request has a 12-second timeout and 8-MiB response limit. Identical dashboard requests coalesce and cache for 25 seconds.

## Upstream references

Read-only contract research, not a promise of official API stability:

- [espn-api league / box-score requests](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/league.py)
- [espn-api player statistics](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/player.py)
- [espn-api roster and matchup totals](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/box_score.py)
- [espn-api pro-team and stat mappings](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/constant.py)
- [Fan API preference schema](https://github.com/jdguggs10/flaim/blob/main/workers/auth-worker/src/v3/league-discovery.ts): `preferences[].metaData.entry`, football `gameId: 1`, `seasonId`, `groups[].groupId`

Fixed upstream URL patterns:

```text
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{id}
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}?view=kona_game_state
https://fan.api.espn.com/apis/v2/fans/{encodedSWID}?context=fantasy&displayHiddenPrefs=true&useCookieAuth=true&source=fantasyapp-ios&featureFlags=challengeEntries
https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={year}&seasontype=2&week={week}
```

External redirects are rejected. No user-provided upstream URLs or general proxy endpoint exist.

## Targeted verification

```powershell
npm test -- tests\server-normalize.test.ts tests\server-client.test.ts tests\server-api.test.ts tests\server-auth.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop --types node server\index.ts tests\server-normalize.test.ts tests\server-client.test.ts tests\server-api.test.ts tests\server-auth.test.ts
```
