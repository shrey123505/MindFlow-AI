<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# MindFlow AI

Transform YouTube lectures into interactive mindmaps, structured cheat sheets, and searchable timestamped scripts with live YouTube timestamp sync.

## Run Locally

**Prerequisites:** Node.js `v20.11+` or `v22+` (uses native ESM `import.meta.dirname`)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set your server-side `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

## Production Build & Run

1. Install dependencies (`npm ci` when a `package-lock.json` is present, or `npm install`) and build both the Vite client and esbuild Node server bundle:
   ```bash
   npm run build
   ```

2. Start the compiled production server (automatically serves static assets from `dist/` without booting Vite dev middleware):
   ```bash
   npm start
   ```

## Deployment & Security Configuration

Optional environment variables supported by `server.ts` (see `.env.example`):

- `PORT`: HTTP port (default `3000`).
- `TRUST_PROXY_HOPS`: Set to `1` (or your reverse-proxy hop count) behind Cloud Run, Render, Fly.io, or Nginx so per-IP rate limits use the real client IP.
- `ALLOWED_ORIGINS`: Comma-separated list of additional allowed browser origins for `POST /api/*` requests (same-origin and loopback requests are allowed automatically).
- `AI_HOURLY_IP_LIMIT`: Per-IP hourly AI request budget across all AI routes (default `120`).
- `MINDFLOW_API_ACCESS_TOKEN`: Optional shared access token checked via `x-mindflow-token` or `Authorization: Bearer <token>` on `/api/*` endpoints (useful for private beta protection).
- `MINDFLOW_AUTH_STORE_PATH`: Path to the private account/session/usage JSON store. Defaults to `./data/auth-store.json`; place this on a persistent private disk in production. This file contains password hashes and session-token hashes.
- `MINDFLOW_DAILY_ANALYSIS_LIMIT`: Uncached video analyses allowed per account per UTC day (default `3`).
- `MINDFLOW_DAILY_AI_ACTION_LIMIT`: Uncached AI actions allowed per account per UTC day (default `20`).
- `MINDFLOW_AI_DAILY_GLOBAL_LIMIT`: Uncached AI actions allowed across the whole site per UTC day (default `50`), to cap shared-key usage even if many accounts sign up.

### Accounts and AI quotas

Video analysis, translation, concept simplification, search grounding, visual-guide generation, and Ask AI require an account session. Passwords are stored as salted scrypt hashes, sessions use random opaque tokens in `HttpOnly`, `SameSite=Lax` cookies, and account/session data stays on the server. Signup/login attempts are rate-limited. Cached AI results do not consume daily usage. Each admitted uncached request uses one AI action; video analyses also use one video-analysis slot. A request that fails after it starts can still count.

Every account uses the Gemini key configured for this site. Per-account caps and the site-wide daily cap bound shared usage; they do not provide separate billing per user or guarantee the provider's exact quota. Set `MINDFLOW_AI_DAILY_GLOBAL_LIMIT` below your expected daily allowance before sharing the site.

The built-in account store is designed for one server process on a host with persistent private disk. It does not send email-verification or password-reset messages, and it is not suitable for multiple replicas sharing an ephemeral filesystem. Before running multiple server instances or requiring verified email ownership, move accounts and quota counters to a shared database/auth provider. Keep the Gemini key in server environment secrets and serve production over HTTPS.

## Testing & Quality Checks

- Run automated test suite:
  ```bash
  npm test
  ```

- Run TypeScript type checks:
  ```bash
  npm run lint
  ```
