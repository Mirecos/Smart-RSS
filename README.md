# Smart RSS

A self-hosted feed aggregator with **fully customizable sources**:

- **XML**: RSS 2.0, Atom and RDF, detected automatically. You can override any field with JSONPath.
- **JSON**: JSON Feed, or any JSON API. You point to the list of items with JSONPath and map each field.
- **HTML**: any web page, scraped with CSS selectors or XPath. It can optionally render JavaScript in headless Chromium.

Each source has its own request settings, field mapping, transforms, filters, full-text extraction and duplicate detection. A **live preview** shows exactly what will be stored before you save. Access requires a login. Admins manage sources and users, and regular users read, star and mark items as read, each with their own reading state.

## Contents

1. [Quick start (your computer)](#quick-start-your-computer)
2. [Using Smart RSS](#using-smart-rss)
3. [Configuration](#configuration)
4. [Deployment to a server (OVH) with GitHub Actions](#deployment-to-a-server-ovh-with-github-actions)
5. [Development](#development)
6. [Architecture & security](#architecture--security)

---

## Quick start (your computer)

Requirements: Docker (Docker Desktop on Windows/macOS), running.

1. Create `.env` from `.env.example` (the start script does this for you), and set the first administrator:
   ```ini
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=choose-a-long-password
   ```
2. Start the app:

   | | Windows (PowerShell) | Linux / macOS / Git Bash |
   |---|---|---|
   | Start | `.\scripts\start.ps1` | `./scripts/start.sh` |
   | Stop | `.\scripts\stop.ps1` | `./scripts/stop.sh` |
   | Restart | `.\scripts\restart.ps1` | `./scripts/restart.sh` |
   | Rebuild from scratch + restart | `.\scripts\rebuild.ps1` | `./scripts/rebuild.sh` |

3. Open http://localhost:8080 and sign in.

About the scripts:
- `start` rebuilds the image when the code changed, then waits until the app is healthy.
- `stop` keeps your data (in the `rss-data` Docker volume).
- `rebuild` also refreshes the base images. Add `-NoCache` / `--no-cache` to ignore the build cache.
- `-Js` / `--js` also starts the JavaScript renderer, and `-NoBuild` / `--no-build` skips the build.
- If PowerShell refuses to run scripts, use `powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

The admin account is created only when the database has no user yet. After that, `ADMIN_USERNAME` / `ADMIN_PASSWORD` are ignored and you manage accounts in the app.

---

## Using Smart RSS

### Users and roles
- **Admins** add, edit and delete sources and categories, change settings, import/export, and manage users on the **Users** page.
- **Users** are read-only: they read, star and mark items as read, and change their own password.
- **Personal state:** read and starred state belong to each user. Everyone sees the same sources.
- **Your own account:** click your name at the bottom of the sidebar to open **My account** (change password, sign out).
- **Safeguards:** the app always keeps at least one admin, and you can't delete your own account.

### Adding a source
1. **Add source**: pick a template (RSS, JSON Feed, JSON API, web page with CSS selectors or XPath), enter the URL, and watch the **live preview**.
2. **Adjust the format** until the preview looks right:
   - *Raw item* shows the first item as parsed. Use it to write JSONPath expressions such as `media.thumbnails[0].url`.
   - *Response* shows the raw body. Use it to write CSS or XPath selectors.
   - For odd date formats, set a [date-fns format](https://date-fns.org/docs/parse) such as `dd/MM/yyyy HH:mm` on the Date field.
3. **Transforms** rewrite values before they are stored (regex replace, strip HTML, trim, truncate, default value). **Filters** keep or drop items with regular expressions.
4. **Full text** fetches the whole article for sources that only publish excerpts.

### Reading
- Use the unified timeline, categories, **Starred** and full-text search.
- Keyboard: `j`/`k` next/previous, `m` read, `s` star, `o` open the original.

### Starter sources
On the first start with an empty database, the app adds a ready-to-use selection: BBC, Le Monde, Hacker News, Ars Technica, The Verge, Daring Fireball, Node.js releases and GitHub Trending. Together they show every source type. **Add starter sources** on *Manage sources* adds back any that are missing. Set `SEED_STARTER_SOURCES=false` to start empty.

### Output feeds and import/export
- **Output feeds:** aggregated items are published again, for any other reader: `/feeds/all.rss`, `/feeds/all.atom`, `/feeds/all.json`, `/feeds/category-<id>.rss`, `/feeds/source-<id>.json`.
  - These URLs are **public** (no login), so feed readers can subscribe. They contain no personal state.
- **OPML** import/export and a **full JSON backup** of every source's configuration are on *Manage sources*.

---

## Configuration

All settings are environment variables in `.env`. **[`.env.example`](.env.example) documents every one of them.** The most important:

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | First administrator, created when no user exists (password ≥ 8 characters) |
| `BIND_ADDRESS` / `PORT` | `127.0.0.1` / `8080` | Where the app is published |
| `COMPOSE_PROFILES` | – | Optional services: `js` (JavaScript renderer), `https` (Caddy with automatic HTTPS) |
| `DOMAIN` | – | Public domain name, used with the `https` profile |
| `TRUST_PROXY` | `false` | `true` behind the HTTPS proxy (secure cookies, real client IPs) |
| `SESSION_TTL_DAYS` | `30` | How long a login stays valid (extended while you use the app) |
| `SEED_STARTER_SOURCES` | `true` | Add the starter sources on the first start |
| `SCHEDULER_ENABLED` | `true` | `false` stops automatic refreshes |
| `SCHEDULER_TICK_SECONDS` / `SCHEDULER_CONCURRENCY` | `60` / `4` | How often due sources are checked, and how many are fetched in parallel |
| `MAX_CONSECUTIVE_FAILURES` | `10` | A source pauses after this many failures in a row |
| `FETCH_MAX_BYTES` / `FETCH_MAX_REDIRECTS` | `5242880` / `5` | Fetch limits |
| `ALLOWED_ORIGINS` | – | Extra browser origins allowed to call the API |
| `RENDERER_TOKEN` | `change-me-local-renderer` | Shared secret with the JavaScript renderer |
| `LOG_LEVEL` | `info` | `trace` … `fatal`, `silent` |
| `APP_IMAGE` | built locally | Docker image to run. Set automatically on the server by the deploy workflow |

---

## Deployment to a server (OVH) with GitHub Actions

### How it works

```
push to main ──► GitHub Actions
                  1. CI: lint, typecheck, unit/integration tests, E2E tests
                  2. Build the Docker image ──► GitHub Container Registry (ghcr.io/<you>/<repo>:sha-xxxxxxx)
                  3. SSH to the server:
                       - upload docker-compose.yml + deploy/
                       - write /opt/smart-rss/.env from the APP_ENV secret (+ APP_IMAGE)
                       - docker compose pull && up -d, then wait until the app is healthy
OVH server:  your caddy-docker-proxy (via Docker labels) or the built-in Caddy (HTTPS, 80/443)
                  ──► app (Node + SQLite volume) [──► optional renderer]
```

- **All app settings** live in **one GitHub secret, `APP_ENV`**, which holds the complete production `.env`. To change any variable, edit that secret and re-run the workflow.
- **Every build** is kept as its own image tag, so a rollback is one click.
- **The server** needs only Docker. The source code is never copied to it.

### 1. Prepare the OVH server (once)

Any VPS or dedicated server with Ubuntu or Debian works. Connect as root (or a sudoer) and run:

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh

# A dedicated deploy user allowed to run Docker, and the app folder
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/smart-rss && chown deploy:deploy /opt/smart-rss

# Firewall (if you use ufw): SSH + HTTP/HTTPS for the proxy (already open if you run caddy-docker-proxy)
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
```

In your DNS zone (for example in the OVH Control Panel), create an **A record** (and AAAA for IPv6) for your domain, such as `rss.example.com`, pointing to the server's IP address. Caddy needs it to obtain the HTTPS certificate.

> Adding `deploy` to the `docker` group gives it root-equivalent power on the server. That is normal for a Docker deploy user, but use this key for nothing else.

### 2. Create the deploy SSH key (once, on your computer)

```bash
ssh-keygen -t ed25519 -C "github-deploy-smart-rss" -f smart-rss-deploy -N ""
```

- Put the **public** key on the server:
  ```bash
  # as root on the server
  mkdir -p /home/deploy/.ssh
  cat >> /home/deploy/.ssh/authorized_keys   # paste smart-rss-deploy.pub, then Ctrl+D
  chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
  ```
- Record the server's host key, so GitHub can verify it's talking to *your* server:
  ```bash
  ssh-keyscan -p 22 your-server-ip-or-hostname
  ```
- Test from your computer: `ssh -i smart-rss-deploy deploy@your-server-ip docker ps`.

### 3. Configure GitHub (once)

1. Push this project to a GitHub repository (the workflows are in `.github/workflows/`).
2. In the repository, go to **Settings → Environments → New environment**, and name it **`production`**. Optionally, add yourself as a *required reviewer* to approve each deployment.
3. In that environment, add these **secrets**:

   | Secret | Value |
   |---|---|
   | `SSH_HOST` | Server IP or hostname |
   | `SSH_USER` | `deploy` |
   | `SSH_PRIVATE_KEY` | The whole content of the private key file `smart-rss-deploy` |
   | `SSH_KNOWN_HOSTS` | The output of `ssh-keyscan` from step 2 |
   | `APP_ENV` | Your production `.env`. Copy [`deploy/production.env.example`](deploy/production.env.example), fill in the `<…>` values, and paste the whole file |

4. Optionally, add these **variables** (same page, *Environment variables*):

   | Variable | Default | Purpose |
   |---|---|---|
   | `SSH_PORT` | `22` | SSH port of the server |
   | `DEPLOY_PATH` | `/opt/smart-rss` | Folder on the server |

For `APP_ENV`, the template is already set up for a public server, and you choose how HTTPS is handled:

- **Option A: your server already runs [caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy)** (the template's default).
  - `COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.caddy-docker-proxy.yml` gives the app the `caddy` Docker labels (`caddy: ${DOMAIN}`, `caddy.reverse_proxy: {{upstreams 8080}}`).
  - It also joins the app to the proxy's Docker network, set with `CADDY_NETWORK` (default `caddy`; find yours with `docker network ls`).
  - Your main proxy then gets the certificate and routes `DOMAIN` to the app. Nothing else takes ports 80/443.
- **Option B: no proxy on the server yet.** Remove those lines and set `COMPOSE_PROFILES=https`. The app then starts its own Caddy on ports 80/443.

In both cases:
- `DOMAIN` is your public domain name.
- `TRUST_PROXY=true` gives secure cookies and the real client IP.
- `BIND_ADDRESS=127.0.0.1` keeps the app's own port private, so traffic comes only through the proxy.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` create the first admin.
- `RENDERER_TOKEN` is used only if you add `js` to `COMPOSE_PROFILES`.

Any variable from `.env.example` can be added.

### 4. Deploy

- **Automatically:** push to `main`. Follow the progress under **Actions → Deploy**. The deployment fails, and says why, if tests fail or if the app isn't healthy after starting.
- **Manually:** go to **Actions → Deploy → Run workflow**.
- **First login:** open `https://your-domain` and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Then change the password under **My account**.

### Everyday operations

| Task | How |
|---|---|
| Change a setting | Edit the `APP_ENV` secret, then **Actions → Deploy → Run workflow** |
| Roll back | **Actions → Deploy → Run workflow**, with *image tag* set to an earlier `sha-xxxxxxx`. Tags are listed in each run's summary and in the repository's *Packages* |
| See logs | `ssh deploy@server 'cd /opt/smart-rss && docker compose logs -f app'` |
| Restart | `ssh deploy@server 'cd /opt/smart-rss && docker compose restart app'` |
| Redeploy by hand | `ssh deploy@server 'SKIP_PULL=1 bash /opt/smart-rss/deploy/remote-deploy.sh'` |

**Backups.** All data is one SQLite database in the `smart-rss_rss-data` volume. To back it up, on the server:
```bash
cd /opt/smart-rss
docker run --rm -v smart-rss_rss-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/rss-data-$(date +%F).tgz -C /data .
```
To restore, stop the app (`docker compose down`), then run
`docker run --rm -v smart-rss_rss-data:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/<file>.tgz -C /data"`,
then deploy again.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing secrets in the 'production' environment` | A secret is missing, or the job isn't using the `production` environment |
| `Could not resolve hostname` / `SSH_HOST cannot be resolved` | `SSH_HOST` must be only the server's **public IP** (or a public DNS name). Don't use `user@`, a port, a local SSH alias, or a hosts-file name |
| `Host key verification failed` | `SSH_KNOWN_HOSTS` doesn't match the server (reinstalled server, wrong port). Run `ssh-keyscan` again |
| `Load key …: error in libcrypto` | `SSH_PRIVATE_KEY` isn't a usable private key. Paste the whole private key file (not the `.pub`), including the `BEGIN`/`END` lines, with no passphrase and not in PuTTY `.ppk` format. The workflow now says which of these it is |
| `Permission denied (publickey)` | Wrong `SSH_USER`, or the public key isn't in `/home/deploy/.ssh/authorized_keys` |
| `error saving credentials: mkdir /home/…/.docker: permission denied` | The deploy user can't write to its home folder. The deploy script no longer needs it (it logs in to the registry with a temporary folder), but fix it anyway with `chown deploy:deploy /home/deploy` (as root) |
| `permission denied … docker.sock` | The deploy user isn't in the `docker` group. Run `usermod -aG docker deploy`, then reconnect |
| `denied` while pulling the image | The image couldn't be pulled. The workflow logs in to GHCR with its own token; if you pull by hand, run `docker login ghcr.io` first or make the package public |
| `Invalid configuration: …` in the app logs | A value in `APP_ENV` is invalid (e.g. an admin password under 8 characters). Fix the secret and redeploy |
| No HTTPS certificate | DNS doesn't point to the server yet, or ports 80/443 are closed. Check the proxy's logs: `docker compose logs caddy` (built-in), or the logs of your caddy-docker-proxy container |
| `Docker network '…' not found` | `CADDY_NETWORK` must be the network your caddy-docker-proxy container uses (`docker network ls`, `docker inspect <proxy>`) |
| `Remove 'https' from COMPOSE_PROFILES` | With caddy-docker-proxy, don't also start the built-in Caddy: both would need ports 80/443 |
| `address already in use` on port 80/443 | Another proxy already runs on the server. Use Option A (caddy-docker-proxy labels) instead of `COMPOSE_PROFILES=https` |
| 502 / site not found via caddy-docker-proxy | The app isn't on the proxy's network, or the proxy only watches specific networks (`CADDY_INGRESS_NETWORKS`). Include `CADDY_NETWORK` there |
| Login works but you are logged out immediately | `TRUST_PROXY=true` is missing behind Caddy, or you are browsing over `http://` |

---

## Development

```bash
npm install
npm run build -w packages/shared
npm run dev:server        # http://127.0.0.1:8080 (API; set ADMIN_USERNAME/ADMIN_PASSWORD in your shell)
npm run dev:web           # http://127.0.0.1:5173 (proxies /api and /feeds)

npm run lint && npm run typecheck
npm test                  # unit + integration (Vitest)
npm run test:coverage
npm run build && npx playwright install chromium && npm run test:e2e
```

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request and branch push. `deploy.yml` runs it again before deploying `main`.

---

## Architecture & security

```
docker compose
├── app        Fastify API + React SPA + scheduler (node:22-slim, SQLite in /data)
├── renderer   optional headless Chromium (browserless), profile "js"
└── caddy      optional HTTPS reverse proxy (Let's Encrypt), profile "https"
```

```
fetch → parse (xml | json | html) → transforms → normalize → filters → dedupe → full text → sanitize → store
```

The preview endpoint runs the **same pipeline** and skips the storing step.

| Path | What |
|---|---|
| `packages/shared` | zod schemas for source configs, auth and API types (used by server and UI) |
| `apps/server` | Fastify 5, better-sqlite3 (WAL + FTS5), pipeline (`src/pipeline`), scheduler, auth (`src/auth`) |
| `apps/web` | React 19, Vite, TanStack Query, Tailwind 4 |
| `e2e` | Playwright tests against the production build |
| `deploy/` | Server-side deploy script, Caddyfile, production `.env` template |
| `scripts/` | Local start / stop / restart / rebuild |

**Security**
- **Authentication:**
  - Passwords are hashed with scrypt, and session tokens are random, stored only as a SHA-256 hash.
  - The session cookie is `httpOnly` and `SameSite=Lax`, and `Secure` behind HTTPS.
  - Failed logins are throttled: 5 per account and 20 per IP address in 15 minutes.
- **Authorization:** one central, fail-closed rule. Every API call needs a login, and every write needs the admin role, except reading actions and your own password.
- **CSRF:** cross-site writes are rejected with `Origin` and `Sec-Fetch-Site` checks.
- **Remote HTML:** it's sanitized on the server (allow-list) and again in the browser (DOMPurify), under a strict Content-Security-Policy.
- **Fetching:** fetches have a timeout, size limit and redirect limit, and only allow http(s). By design, sources *can* reach private networks (useful for LAN feeds). User regexes are checked for catastrophic backtracking.
- **Deployment:**
  - Secrets stay in GitHub environment secrets, and the server's `.env` is written over SSH with mode `600`.
  - SSH host keys are verified (`StrictHostKeyChecking`).
  - The registry token used for the pull lasts only as long as the job.
