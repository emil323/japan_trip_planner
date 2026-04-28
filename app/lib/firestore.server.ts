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
