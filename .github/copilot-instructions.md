# Japan Trip Planner — Copilot Instructions

## Overview
A single-trip React Router v7 SSR app for planning a Japan holiday. State lives in a single Firestore document shared between all browser tabs/users via Server-Sent Events. Deployed to Cloud Run, protected by Google IAP.

## Stack
| Layer | Technology |
|-------|-----------|
| Framework | React Router v7 (SSR + client-side SPA) |
| Language | TypeScript (strict) |
| Package manager | pnpm |
| UI library | Aksel / `@navikt/ds-react` + `@navikt/ds-css` |
| Database | Cloud Firestore (single document `trips/main`) |
| Hosting | Google Cloud Run |
| Auth | Google IAP (Identity-Aware Proxy) |
| Tests | Vitest |
| Build | Vite via `@react-router/dev` |

## File Layout
```
app/
  routes/
    home.tsx              # SSR loader — fetches trip state, renders TripPlanner
    plan.tsx              # Per-location day-by-day plan page (~1 078 lines)
    summary.tsx           # Trip summary / print view
    api.trip.ts           # REST endpoint: GET returns state, POST/PUT saves state
    api.trip-stream.ts    # SSE endpoint: pushes Firestore changes to clients
    img-search.ts         # Image search — hits DuckDuckGo, caches results in Firestore
    img-proxy.ts          # Proxies external images to avoid CORS
    og.ts                 # OG image generation
  components/
    TripPlanner.tsx        # Main client component (~985 lines): location list, drag-resize, SSE sync
    SegmentedSlider.tsx    # Drag-to-resize day allocator
  lib/
    trip.ts               # TripState type, defaultState(), helper fns (pure, no I/O)
    firestore.server.ts   # Firestore helpers: getTrip, saveTrip, subscribeTrip, image cache
    presence.server.ts    # Tracks connected clients for presence indicators
    tripStream.client.ts  # EventSource wrapper for the SSE stream
    planDates.ts          # Date/day calculation utilities
    imageCache.ts         # Client-side localStorage image cache
    imageData.ts          # Static image metadata
    identity.ts           # IAP user-email extraction
    japan.ts              # Japan-specific constants / location seeds
    planDates.test.ts     # Vitest tests for planDates
    trip.test.ts          # Vitest tests for trip helpers
```

## State Model (`TripState` in `app/lib/trip.ts`)
```ts
type TripState = {
  arrival: string;       // ISO date "YYYY-MM-DD"
  totalDays: number;
  locations: Location[];
}

type Location = {
  id: string;
  name: string;
  hotel: string;
  days: number;
  locked: boolean;       // prevents drag-resize and even reallocation
  imageUrl?: string;
  url?: string;
  plans?: Plan[];
  includeCheckoutDay?: boolean;
}
```

- State is persisted to Firestore via `POST /api/trip` (debounced ~800 ms after each change).
- The SSE stream (`/api/trip-stream`) pushes updates to all connected clients. The client skips the very first snapshot from SSE to avoid overwriting local edits made during the handshake.
- Locked locations cannot be resized by dragging and their days are excluded from even reallocation.

## Key Conventions
- **UI labels are in Norwegian** (`"Netter"`, `"Innsjekk"`, `"Reisedag"`, `"Utsjekk"`, `"Planer i"`, etc.).
- **Code identifiers are in English.**
- Aksel components preferred over raw HTML/CSS (use `Button`, `TextField`, `Tag`, `Heading`, `BodyShort` etc.).
- CSS class names follow BEM-lite: `.trip-loc-card`, `.trip-loc-card--locked`, `.trip-drag-handle--locked`.
- Server-only modules are named `*.server.ts` and must never be imported by client bundles.
- Client-only modules are named `*.client.ts`.

## Authentication
In production, Google IAP injects the `X-Goog-Authenticated-User-Email: accounts.google.com:user@example.com` header. The app extracts the email with `header.split(":").pop()`. In local dev this header is absent; presence falls back gracefully.

## Image Search
`/img-search?q=QUERY` fetches DuckDuckGo image results and caches them in the `imgSearchCache` Firestore collection (30-day TTL, slugified key). The client also maintains a localStorage cache (`imageCache.ts`).

## Environment Variables
| Variable | Purpose |
|----------|---------|
| `FIRESTORE_EMULATOR_HOST` | Point Firestore SDK at local emulator (e.g. `127.0.0.1:8080`) |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (e.g. `demo-trip` for emulator, real ID in prod) |

Copy `.env.local.example` to `.env.local` for local development.

## Production
- URL: `https://japantripplanner-1043803678932.europe-north1.run.app/`
- Deployed as a Docker container to Cloud Run (Europe North 1).
- Expired GCP credentials cause `invalid_grant` → 503 errors on saves in local dev against real Firestore.
