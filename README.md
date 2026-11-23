<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# MindFlow AI

Transform YouTube lectures into interactive mindmaps, structured cheat sheets, and searchable timestamped scripts with live YouTube timestamp sync.

## Run Locally

**Prerequisites:** Node.js (v20+ or v22+)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set the `GEMINI_API_KEY` in `.env` or environment variables:
   ```bash
   GEMINI_API_KEY="your-gemini-api-key"
   ```

3. Run development server:
   ```bash
   npm run dev
   ```

## Production Build & Run

1. Build both client and server:
   ```bash
   npm run build
   ```

2. Start production server:
   ```bash
   npm start
   ```

## Testing & Quality Checks

- Run automated test suite:
  ```bash
  npm test
  ```

- Run TypeScript type checks:
  ```bash
  npm run lint
  ```
