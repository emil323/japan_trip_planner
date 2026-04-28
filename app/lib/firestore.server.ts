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

export type TripMeta = { clientId: string | null; updatedAt: number };

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
  meta?: { clientId?: string },
): Promise<void> {
  const cleaned = JSON.parse(JSON.stringify(state)) as TripState;
  await docRef().set(
    {
      ...cleaned,
      _meta: {
        clientId: meta?.clientId ?? null,
        updatedAt: Date.now(),
      },
    },
    { merge: false },
  );
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
