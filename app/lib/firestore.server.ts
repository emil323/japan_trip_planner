import { Firestore } from "@google-cloud/firestore";
import {
  defaultState,
  reconcile,
  type TripState,
} from "./trip";

// One Firestore client per server process. ADC picks up project + creds on Cloud Run;
// locally `gcloud auth application-default login` + GOOGLE_CLOUD_PROJECT works.
let _db: Firestore | null = null;
function db(): Firestore {
  if (_db) return _db;
  _db = new Firestore();
  return _db;
}

const COLLECTION = "trips";
// Single shared document — IAP gates who can reach the app, so per-user docs aren't needed.
const DOC_ID = "default";

function docRef() {
  return db().collection(COLLECTION).doc(DOC_ID);
}

export async function getTrip(): Promise<TripState> {
  try {
    const snap = await docRef().get();
    if (!snap.exists) return defaultState();
    const data = snap.data() as Partial<TripState> | undefined;
    if (!data || !Array.isArray(data.locations)) return defaultState();
    // Run normalization via reconcile so legacy/partial data never reaches the UI.
    return reconcile({
      totalDays: typeof data.totalDays === "number" ? data.totalDays : 21,
      arrival: typeof data.arrival === "string" ? data.arrival : defaultState().arrival,
      locations: data.locations,
    } as TripState);
  } catch (err) {
    console.error("[firestore] getTrip failed", err);
    return defaultState();
  }
}

export async function saveTrip(state: TripState): Promise<void> {
  // Strip undefined fields — Firestore rejects them. JSON round-trip is the simplest cleaner.
  const cleaned = JSON.parse(JSON.stringify(state)) as TripState;
  await docRef().set(cleaned, { merge: false });
}
