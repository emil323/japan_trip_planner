// Persistent (localStorage) cache for image-search candidate lists, keyed by query.
// Avoids hitting the DuckDuckGo endpoint when the same query has already been fetched.

const STORAGE_KEY = "tripImgCache:v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 200;

type Entry = { images: string[]; ts: number };
type Store = Record<string, Entry>;

let memo: Store | null = null;

function load(): Store {
  if (memo) return memo;
  if (typeof window === "undefined") return (memo = {});
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return (memo = {});
    const parsed = JSON.parse(raw);
    return (memo = (parsed && typeof parsed === "object" ? parsed : {}) as Store);
  } catch {
    return (memo = {});
  }
}

function persist(store: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded; ignore */
  }
}

function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getCachedImages(query: string): string[] | null {
  const key = normalize(query);
  if (!key) return null;
  const store = load();
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    delete store[key];
    persist(store);
    return null;
  }
  return entry.images;
}

export function setCachedImages(query: string, images: string[]) {
  const key = normalize(query);
  if (!key || images.length === 0) return;
  const store = load();
  store[key] = { images, ts: Date.now() };

  // Cap the store size: drop oldest entries first.
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys
      .map((k) => [k, store[k].ts] as const)
      .sort((a, b) => a[1] - b[1])
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach(([k]) => delete store[k]);
  }
  persist(store);
}
