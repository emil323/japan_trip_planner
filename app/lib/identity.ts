// Stable per-tab client identifier. Lets the live-sync layer ignore echoes of
// our own writes when Firestore broadcasts them back to us.
const KEY = "tripClientId:v1";
let cached: string | null = null;

export function getClientId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") {
    cached = "ssr";
    return cached;
  }
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const fresh = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    window.sessionStorage.setItem(KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    cached = "anon";
    return cached;
  }
}
