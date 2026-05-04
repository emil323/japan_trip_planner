---
name: japan-dev
description: >
  Runbook for developing, testing, building, and deploying the Japan Trip Planner app.
  Use this skill when asked to start the dev server, run tests, build, typecheck, or deploy
  the Japan trip planner.
---

## Prerequisites

- Node.js + pnpm installed
- Java (for Firestore emulator)
- Docker (for container builds)
- Working directory: `/Users/Emil.Kalsto/IdeaProjects/japan-trip-planner`

Copy `.env.local.example` → `.env.local` for local dev if not already done.

---

## Local Development

### Recommended: dev server + Firestore emulator (no GCP credentials needed)
```bash
pnpm dev:emulator
```
This runs `firebase emulators:start --only firestore` and `react-router dev` concurrently.
App available at **http://localhost:5173**.
Firestore emulator UI at **http://localhost:4000**.

### Dev server against real Firestore (requires valid GCP credentials)
```bash
pnpm dev
```
Requires `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default login`.

### Emulator only (no dev server)
```bash
pnpm emulator
```

---

## Testing

```bash
# Single run (CI-style)
pnpm test

# Watch mode (re-runs on save)
pnpm test:watch

# With coverage report
pnpm test:coverage
```

Test files live in `app/lib/`:
- `planDates.test.ts` — date and day-offset calculations
- `trip.test.ts` — TripState helper functions

---

## Type Checking

```bash
pnpm typecheck
```
Runs `react-router typegen` (generates `+types/` files from routes) then `tsc`.
Run this before committing to catch type errors.

---

## Building for Production

```bash
pnpm build
```
Output lands in `build/` (server bundle + client assets).

---

## Running the Production Build Locally

```bash
pnpm build && pnpm start
```
Serves on **http://localhost:3000** (requires real Firestore credentials).

---

## Docker

```bash
# Build image
docker build -t japan-trip-planner .

# Run container (map port 3000)
docker run -p 3000:3000 japan-trip-planner
```

---

## Deployment

The app is deployed to **Google Cloud Run** (Europe North 1).

Production URL: `https://japantripplanner-1043803678932.europe-north1.run.app/`

Deployment is typically done by pushing to the main branch and triggering a Cloud Build / Cloud Run deploy step. Check the project's GCP console for the exact trigger configuration.

---

## Common Issues & Debugging Tips

| Symptom | Cause | Fix |
|---------|-------|-----|
| Saves return 503 `invalid_grant` | Expired GCP application-default credentials | Run `gcloud auth application-default login` |
| State reverts shortly after editing | SSE first-snapshot race (was fixed in commit `30d398b`) | Ensure you're on latest main |
| Location card heights inconsistent when locked | CSS `white-space: nowrap` fix (commit `5648610`) | Ensure you're on latest main |
| Images don't persist | Check browser console for save errors; the app shows a toast on failure since `saveState()` returns `SaveResult` |
| Firestore emulator not starting | Java not installed, or port 8080/4000 in use | Free up ports or install Java |

---

## Key Dev Scripts Reference

| Command | What it does |
|---------|-------------|
| `pnpm dev:emulator` | Emulator + dev server (recommended) |
| `pnpm dev` | Dev server only (real Firestore) |
| `pnpm emulator` | Firestore emulator only |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm test:coverage` | Run Vitest with coverage |
| `pnpm typecheck` | typegen + tsc |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
