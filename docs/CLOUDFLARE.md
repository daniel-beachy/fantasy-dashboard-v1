# Cloudflare hosting

Connected site: https://fantasy-dashboard-v1.daniel-beachy.workers.dev/

The frontend and private API share one origin. A Worker serves static Vite assets and calls fixed ESPN read endpoints; D1 persists isolated private dashboards. The local Express/browser-login companion and the GitHub Pages demo remain separate, supported modes.

## Authentication and private data

There is no supported ESPN OAuth integration. Users import their own `SWID` and `espn_s2` cookies after signing in directly to ESPN. Hosted code never launches a login browser or collects ESPN passwords. ESPN can expire cookies, change its unofficial APIs, or block cloud-origin requests; failures are surfaced instead of silently showing demo data.

Each dashboard has a randomly generated 256-bit recovery key, shown only when created. Treat it like a password. Only its keyed hash is stored. A different random token authenticates each browser through a `__Host-` cookie: Secure, HttpOnly, SameSite=Strict, Path=/, no Domain. Sessions expire after 30 days, without sliding extension.

The Worker encrypts ESPN credentials, league selections, and cached snapshots using AES-256-GCM with unique random nonces. Authenticated context binds records to the dashboard ID, revision, and record type. HKDF derives separate encryption and signing keys from the Worker secret. This protects database contents at rest, **not against the deployment operator or platform**, which can access the application's decryption capability. It is not end-to-end encryption.

Keys/cookies are never put in URLs or browser localStorage. The hosted UI holds a newly generated recovery key only long enough to show and acknowledge it. Local storage remains limited to theme and watchlist choices. Private API responses use `Cache-Control: no-store`, never shared CDN caching. Errors/logs do not include request bodies, credentials, upstream bodies, or stack traces.

Every mutation requires exact same-origin `Origin`, JSON, and `X-Dashboard-Token` from `/api/session`. A signed ten-minute pre-auth challenge supports creation/login without allocating a database session to every demo visitor. Authenticated reads reject cross-site browser requests.

- **Disconnect ESPN:** clear encrypted credentials, selections, and cached scores; preserve the dashboard and its browser sessions.
- **Sign out:** revoke only the current browser session; retain the encrypted dashboard.
- **Delete:** remove the dashboard's active records and all sessions/cache through foreign-key cascades. Cloudflare-managed backups may retain deleted records until their provider retention period ends.

Long-running mutations use revision checks and verify the initiating session is still active. Concurrent disconnect, deletion, or sign-out cannot resurrect an in-flight connection. Cache writes require the same unchanged revision and active session.

## API

Errors use `{ "error": "actionable message" }`. All mutation bodies are JSON and at most 16 KiB.

| Method | Route | Body/query | Result |
| --- | --- | --- | --- |
| GET | `/api/session` | None | Session status, `mode: "cloud"`, `vaultAuthenticated`, ESPN `authenticated`, CSRF token |
| POST | `/api/vaults` | `{}` | `{ recoveryKey }`, plus authenticated browser cookie |
| POST | `/api/vaults/login` | `{ recoveryKey }` | `{ ok: true }`, plus new browser session |
| POST | `/api/vaults/logout` | `{}` | Revoke this browser |
| POST | `/api/vaults/delete` | `{ confirm: true }` | Delete the private dashboard |
| POST | `/api/connect` | `{ swid, espnS2, season?, leagueIds? }` | Verify ESPN identity, discover owned leagues, persist encrypted state |
| POST | `/api/logout` | `{}` | Disconnect ESPN |
| GET | `/api/leagues` | None | `{ leagues }` |
| POST | `/api/leagues` | `{ leagueId, teamId? }` | Verify ownership and update selections |
| GET | `/api/dashboard` | `leagueId` | One owned league's `DashboardData` |

The browser refreshes leagues with at most four parallel API calls. Successful leagues survive individual failures, with warnings; inconsistent seasons/weeks and session expiry are not silently merged. The earliest successful snapshot timestamp represents the merged data's age. The local companion still accepts its original single dashboard request.

## Free-tier design and limits

Workers Free currently allows 100,000 requests/day, 10 ms CPU/request, and 50 subrequests/request. D1 Free currently allows 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage. Network waiting does not count as CPU. Quotas and API availability are not an uptime guarantee; consult [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Automatic connection processes at most 20 discovered leagues per request and explicitly reports omissions. Discovery/team selection fetches metadata only, not full rosters, to reduce payload parsing and CPU. Missing leagues can be added individually, up to 50 total. Each dashboard call fetches one selected league; per-dashboard/per-league encrypted snapshots expire after 25 seconds. The frontend refreshes every 30 seconds only while visible.

Application rate limits are keyed hashes, not plaintext IP addresses: five creations per IP/hour, 20 recovery attempts per IP/15 minutes, 200 total creations/day, 15 ESPN mutations per dashboard/five minutes, and 200 dashboard fetches per dashboard/minute. These limits help bound abuse but do not guarantee the service cannot exhaust its free allowance. A daily scheduled job deletes expired sessions, cache records, and rate buckets.

Large ESPN league payloads can still challenge the free CPU allowance. Real private-account payloads and authentication require account-holder verification; fixture tests are not proof that all ESPN accounts or payload sizes work. No paid upgrade is required by this configuration or enabled by the deployment commands.

Runtime probes confirmed ESPN's Fan API and fantasy game-state endpoint are reachable from Cloudflare. Its primary public scoreboard host denied the tested cloud requests; the alternate ESPN public schedule host responded successfully. The adapter handles that specific denial with a credential-free retry and validates the returned season/week. Redirects remain explicitly rejected in both runtimes.

## Local Cloudflare development

Requirements: Node.js 22+, npm, and the repository's Wrangler dependency.

```powershell
npm ci
npx wrangler d1 migrations apply DB --local
node -e "require('node:fs').writeFileSync('.dev.vars','VAULT_KEY='+require('node:crypto').randomBytes(32).toString('base64url')+'\n',{flag:'wx'})"
npm run dev:cloud
```

Open Wrangler's printed localhost URL. `.dev.vars` and `.wrangler` are ignored by Git. The command intentionally refuses to overwrite an existing local secret: changing it makes previously encrypted local records unreadable. Local D1 is separate from production.

## Deploy your own instance

1. Run `npx wrangler login` and approve Cloudflare's official authorization page. Select a free account; do not upgrade plans unless desired.
2. Choose your own Worker name in `wrangler.jsonc`. Create a database with `npx wrangler d1 create <your-database-name>`, then replace `database_name` and `database_id` while retaining binding `DB`.
3. Provision a unique `VAULT_KEY` containing 32 cryptographically random bytes encoded as unpadded base64url. For a new instance:

   ```powershell
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put VAULT_KEY
   ```

4. Register a `workers.dev` subdomain in Cloudflare if this is the account's first Worker.
5. Run `npm run deploy:cloud`. This builds root-path assets, applies migrations, and publishes the Worker.

**Do not regenerate an existing production `VAULT_KEY` during routine deployment.** It is retained in Cloudflare's secret store. Replacing or losing it makes existing encrypted dashboards inaccessible and invalidates their hashed recovery/session lookups. A future key-rotation mechanism must migrate records before switching secrets.

The repository's GitHub workflow still publishes only the static demo. Connected deployments are explicit Wrangler deployments from an authenticated machine; no personal OAuth token or Cloudflare secret is committed or copied into GitHub Actions.

## Verification

```powershell
npm test
npm run build:cloud
# Against a running local Worker:
node scripts\smoke-cloud.mjs
# Against your own hosted instance:
$env:TEST_URL = 'https://<your-worker>.<your-subdomain>.workers.dev'
node scripts\smoke-cloud.mjs
```

The smoke script creates one disposable dashboard, verifies recovery/sign-out/deletion, and cleans up without printing recovery keys. It consumes a creation-rate-limit slot. Optional `SMOKE_ESPN=1` sends fabricated credentials and requires rejection; this does **not** verify a real ESPN login.

For real browser/D1 integration, point `TEST_URL` at a running Worker, set `REAL_CLOUD=1`, and run `npx playwright test cloud-runtime`. This opt-in test creates and deletes one disposable dashboard per viewport. It disables traces/videos/automatic screenshots; optional `SCREENSHOT_DIR` captures only credential-free screens. Normal browser tests use fixtures and do not modify a hosted account.
