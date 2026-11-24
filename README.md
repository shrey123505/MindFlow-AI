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
- `MINDFLOW_DAILY_ANALYSIS_LIMIT`: Free video analyses per visitor (per IP) per UTC day on the shared server key (default `5`).
- `MINDFLOW_DAILY_AI_ACTION_LIMIT`: Free AI actions per visitor per UTC day (default `40`).
- `MINDFLOW_AI_DAILY_GLOBAL_LIMIT`: Free AI actions across the whole site per UTC day (default `150`) — protects your Gemini quota.

### No login, fair-use quota, bring-your-own-key

There are no accounts or sessions. Anyone can paste a YouTube link and use every feature immediately.

To stop other people from draining *your* Gemini key, the server counts free AI usage per visitor and site-wide (in memory, reset at UTC midnight or on restart). When the free limit is reached, the app shows a dialog where the visitor can paste **their own free Gemini API key** (from aistudio.google.com/apikey). That key is stored only in their browser and sent with their requests (`x-user-gemini-key`); it is used for that request only, never stored or logged on the server, and their usage is never counted against your limits.

Cached results (same video + language) are free and do not count.

## Testing & Quality Checks

- Run automated test suite:
  ```bash
  npm test
  ```

- Run TypeScript type checks:
  ```bash
  npm run lint
  ```
