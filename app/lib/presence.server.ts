// In-memory presence registry. Tracks every active SSE connection along with
// the IAP-authenticated email (or null for unauthenticated/local dev). Listeners
// receive a deduped roster (one entry per email, with a connection count) on
// every change.
//
// Caveat: state is per Cloud Run instance. With min-instances=0/1 and low
// traffic everyone lands on the same instance and the roster is accurate.
// With multiple instances each only sees its own connections. For a personal
// app this is acceptable.

export type PresenceUser = { email: string | null; count: number };

type Conn = { id: string; email: string | null };
const conns = new Map<string, Conn>();

type Listener = (users: PresenceUser[]) => void;
const listeners = new Set<Listener>();

function snapshot(): PresenceUser[] {
  const counts = new Map<string | null, number>();
  for (const c of conns.values()) {
    counts.set(c.email, (counts.get(c.email) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([email, count]) => ({ email, count }))
    .sort((a, b) => {
      if (a.email === b.email) return 0;
      if (a.email === null) return 1;
      if (b.email === null) return -1;
      return a.email.localeCompare(b.email);
    });
}

function broadcast() {
  const s = snapshot();
  for (const l of listeners) {
    try {
      l(s);
    } catch {
      /* listener cleanup happens on its own subscribe() */
    }
  }
}

export function addConnection(id: string, email: string | null): void {
  conns.set(id, { id, email });
  broadcast();
}

export function removeConnection(id: string): void {
  if (conns.delete(id)) broadcast();
}

export function listPresence(): PresenceUser[] {
  return snapshot();
}

export function subscribePresence(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
