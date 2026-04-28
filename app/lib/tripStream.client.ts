// Singleton EventSource for /api/trip/stream. Both the root layout
// (presence/topbar) and TripPlanner (live updates) subscribe through this
// module so each tab opens at most one SSE connection.
//
// The connection is opened lazily on the first subscriber and closed when
// the last subscriber detaches.

import { normalizeLocation, type TripState } from "./trip";

export type RemoteUpdate = {
  state: TripState;
  fromClientId: string | null;
  userEmail: string | null;
};
export type PresenceUser = { email: string | null; count: number };

type UpdateCb = (u: RemoteUpdate) => void;
type PresenceCb = (users: PresenceUser[]) => void;

const updateListeners = new Set<UpdateCb>();
const presenceListeners = new Set<PresenceCb>();

let es: EventSource | null = null;
let lastPresence: PresenceUser[] | null = null;

function ensureOpen(): void {
  if (es || typeof window === "undefined") return;
  es = new EventSource("/api/trip/stream");

  es.addEventListener("update", (e) => {
    try {
      const p = JSON.parse((e as MessageEvent).data) as {
        state: TripState;
        meta?: {
          clientId: string | null;
          userEmail: string | null;
          updatedAt: number;
        };
      };
      const s = p.state;
      if (!s || !Array.isArray(s.locations)) return;
      s.locations = s.locations.map((l) => normalizeLocation(l));
      const u: RemoteUpdate = {
        state: s,
        fromClientId: p.meta?.clientId ?? null,
        userEmail: p.meta?.userEmail ?? null,
      };
      for (const cb of updateListeners) cb(u);
    } catch {
      /* ignored */
    }
  });

  es.addEventListener("presence", (e) => {
    try {
      const users = JSON.parse((e as MessageEvent).data) as PresenceUser[];
      lastPresence = users;
      for (const cb of presenceListeners) cb(users);
    } catch {
      /* ignored */
    }
  });
}

function maybeClose(): void {
  if (
    es &&
    updateListeners.size === 0 &&
    presenceListeners.size === 0
  ) {
    es.close();
    es = null;
    lastPresence = null;
  }
}

export function onTripUpdate(cb: UpdateCb): () => void {
  if (typeof window === "undefined") return () => {};
  updateListeners.add(cb);
  ensureOpen();
  return () => {
    updateListeners.delete(cb);
    maybeClose();
  };
}

export function onPresence(cb: PresenceCb): () => void {
  if (typeof window === "undefined") return () => {};
  presenceListeners.add(cb);
  ensureOpen();
  // Replay last known roster immediately so subscribers don't have to wait
  // for the next server push.
  if (lastPresence) cb(lastPresence);
  return () => {
    presenceListeners.delete(cb);
    maybeClose();
  };
}
