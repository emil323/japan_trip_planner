import { Firestore } from "@google-cloud/firestore";
import {
  defaultState,
  reconcile,
  type TripState,
} from "./trip";

let _db: Firestore | null = null;
function db(): Firestore {
  if (_db) return _db;
  _db = new Firestore();
  return _db;
}

const COLLECTION = "trips";
const DOC_ID = "default";

function docRef() {
  return db().collection(COLLECTION).doc(DOC_ID);
}

export type TripMeta = {
  clientId: string | null;
  userEmail: string | null;
  updatedAt: number;
};

function projectState(data: Record<string, unknown> | undefined): TripState {
  if (!data || !Array.isArray(data.locations)) return defaultState();
  return reconcile({
    totalDays: typeof data.totalDays === "number" ? data.totalDays : 21,
    arrival: typeof data.arrival === "string" ? data.arrival : defaultState().arrival,
    locations: data.locations as TripState["locations"],
  });
}

function projectMeta(data: Record<string, unknown> | undefined): TripMeta {
  const m = (data?._meta ?? {}) as Partial<TripMeta>;
  return {
    clientId: typeof m.clientId === "string" ? m.clientId : null,
    userEmail: typeof m.userEmail === "string" ? m.userEmail : null,
    updatedAt: typeof m.updatedAt === "number" ? m.updatedAt : 0,
  };
}

export async function getTrip(): Promise<TripState> {
  try {
    const snap = await docRef().get();
    if (!snap.exists) return defaultState();
    return projectState(snap.data());
  } catch (err) {
    console.error("[firestore] getTrip failed", err);
    return defaultState();
  }
}

export async function saveTrip(
  state: TripState,
  meta?: { clientId?: string; userEmail?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = JSON.parse(JSON.stringify(state)) as TripState;
  try {
    await docRef().set(
      {
        ...cleaned,
        _meta: {
          clientId: meta?.clientId ?? null,
          userEmail: meta?.userEmail ?? null,
          updatedAt: Date.now(),
        },
      },
      { merge: false },
    );
    return { ok: true };
  } catch (err) {
    // Most commonly: stale gcloud creds in dev (`invalid_rapt`). We swallow
    // here so the action returns a clean JSON response instead of throwing
    // an unhandled exception that pops the dev-overlay error every time the
    // client persists its state.
    console.error("[firestore] saveTrip failed", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Server-side Firestore listener. Fires once with the current document and then
// every time it changes. Returns an unsubscribe function.
export function subscribeTrip(
  cb: (state: TripState, meta: TripMeta) => void,
  onError?: (err: Error) => void,
): () => void {
  return docRef().onSnapshot(
    (snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      cb(projectState(data), projectMeta(data));
    },
    (err) => {
      console.error("[firestore] subscribe error", err);
      onError?.(err);
    },
  );
}

// --- Image-search result cache ---------------------------------------------
//
// We persist DuckDuckGo image search responses to Firestore so the same
// query (e.g. "Osaka skyline") only hits DDG once across all sessions and
// users. Subsequent lookups return the cached URL list directly, with a
// month-long TTL after which we refresh in the background.

const IMG_CACHE_COLLECTION = "imgSearchCache";
const IMG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CachedImageSearch = {
  images: string[];
  updatedAt: number;
};

// Normalises and slugifies a query into a stable Firestore document id.
// Firestore doc ids can't contain "/" or be longer than 1500 bytes; this
// keeps them short and human-readable for debugging.
export function imgCacheKey(query: string): string {
  const norm = query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return norm || "_empty";
}

export async function getCachedImageSearch(
  query: string,
): Promise<CachedImageSearch | null> {
  try {
    const snap = await db()
      .collection(IMG_CACHE_COLLECTION)
      .doc(imgCacheKey(query))
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as Partial<CachedImageSearch> | undefined;
    if (!data || !Array.isArray(data.images) || typeof data.updatedAt !== "number") {
      return null;
    }
    return { images: data.images, updatedAt: data.updatedAt };
  } catch (err) {
    console.warn("[firestore] getCachedImageSearch failed", err);
    return null;
  }
}

export async function saveCachedImageSearch(
  query: string,
  images: string[],
): Promise<void> {
  if (images.length === 0) return;
  try {
    await db()
      .collection(IMG_CACHE_COLLECTION)
      .doc(imgCacheKey(query))
      .set({
        images,
        updatedAt: Date.now(),
        query,
      });
  } catch (err) {
    console.warn("[firestore] saveCachedImageSearch failed", err);
  }
}

export function isImageCacheStale(cached: CachedImageSearch): boolean {
  return Date.now() - cached.updatedAt > IMG_CACHE_TTL_MS;
}
