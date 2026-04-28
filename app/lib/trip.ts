export const PALETTE = [
  "#d72631", "#e8833a", "#3a86ff", "#2a9d8f", "#7b2cbf",
  "#f4a261", "#06a77d", "#e76f51", "#5a189a", "#0077b6",
];
export const colorFor = (i: number) => PALETTE[i % PALETTE.length];

export type TransitMode = "shinkansen" | "local_train" | "metro" | "bus" | "plane" | "car";

export const TRANSIT_MODES: TransitMode[] = [
  "shinkansen",
  "local_train",
  "metro",
  "bus",
  "plane",
  "car",
];

export const TRANSIT_LABEL: Record<TransitMode, string> = {
  shinkansen: "Shinkansen",
  local_train: "Lokaltog",
  metro: "T-bane",
  bus: "Buss",
  plane: "Fly",
  car: "Bil",
};

export const TRANSIT_EMOJI: Record<TransitMode, string> = {
  shinkansen: "🚄",
  local_train: "🚆",
  metro: "🚇",
  bus: "🚌",
  plane: "✈️",
  car: "🚗",
};

export type Plan =
  | {
      kind: "plan";
      id: string;
      title: string;
      day: number | null; // 1-based day index within the location's stay; null = in suggestions
    }
  | {
      kind: "travel";
      id: string;
      mode: TransitMode;
      note?: string;
      day: number | null;
    };

export type Location = {
  id: string;
  name: string;
  hotel: string;
  days: number;
  url?: string;
  imageUrl?: string;
  locked?: boolean;
  plans?: Plan[];
  plansWarning?: boolean;
};

export type TripState = {
  totalDays: number;
  arrival: string; // ISO yyyy-mm-dd
  locations: Location[];
};

export const newId = () => Math.random().toString(36).slice(2, 9);

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function fmtShort(iso: string): string {
  return parseISO(iso).toLocaleDateString("nb-NO", { month: "short", day: "numeric" });
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export function defaultState(): TripState {
  return {
    totalDays: 21,
    arrival: todayISO(),
    locations: [
      { id: newId(), name: "Fukuoka",   hotel: "", days: 4 },
      { id: newId(), name: "Hiroshima", hotel: "", days: 3 },
      { id: newId(), name: "Osaka",     hotel: "", days: 4 },
      { id: newId(), name: "Kyoto",     hotel: "", days: 5 },
      { id: newId(), name: "Tokyo",     hotel: "", days: 5 },
    ],
  };
}

export async function loadState(): Promise<TripState | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/trip", { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const s = (await res.json()) as TripState;
    if (!s || !Array.isArray(s.locations)) return null;
    if (!s.arrival) s.arrival = todayISO();
    s.locations = s.locations.map((l) => normalizeLocation(l));
    return s;
  } catch {
    return null;
  }
}

// Validate/clamp persisted plan data so bad values from older versions or hand-edited
// localStorage can never crash the UI.
function normalizeLocation(l: Location): Location {
  const days = Math.max(0, Math.floor(l.days || 0));
  const plans = Array.isArray(l.plans)
    ? l.plans
        .map((p): Plan | null => {
          if (!p || typeof p.id !== "string") return null;
          const rawDay =
            typeof (p as Plan).day === "number" && Number.isFinite((p as Plan).day)
              ? Math.floor((p as Plan).day as number)
              : null;
          const day = rawDay !== null && rawDay >= 1 && rawDay <= days ? rawDay : null;
          // Discriminate by `kind`. Older entries without `kind` are treated as plain plans.
          const kind = (p as Plan).kind === "travel" ? "travel" : "plan";
          if (kind === "travel") {
            const pp = p as Extract<Plan, { kind: "travel" }>;
            const mode: TransitMode = TRANSIT_MODES.includes(pp.mode) ? pp.mode : "local_train";
            return {
              kind: "travel",
              id: p.id,
              mode,
              note: typeof pp.note === "string" && pp.note.trim() ? pp.note : undefined,
              day,
            };
          }
          const pp = p as Extract<Plan, { kind: "plan" }> & { title?: unknown };
          const title = typeof pp.title === "string" ? pp.title : "";
          if (!title) return null;
          return { kind: "plan", id: p.id, title, day };
        })
        .filter((p): p is Plan => p !== null)
    : [];
  return { ...l, days, plans };
}

// When a location's day count changes, push any plan whose day is now out-of-range
// back to suggestions and flag the location so the UI can warn the user.
// Returns a new Location object; never mutates input.
export function applyDaysChange(loc: Location, newDays: number): Location {
  const plans = loc.plans ?? [];
  let changed = false;
  const nextPlans = plans.map((p) => {
    if (p.day !== null && p.day > newDays) {
      changed = true;
      return { ...p, day: null };
    }
    return p;
  });
  return {
    ...loc,
    days: newDays,
    plans: nextPlans,
    plansWarning: loc.plansWarning || changed,
  };
}

export async function saveState(s: TripState): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
  } catch {
    /* ignored — best-effort persistence; UI keeps working from in-memory state */
  }
}

export function reconcile(s: TripState): TripState {
  const total = s.totalDays;
  const locs = s.locations.map((l) => ({ ...l }));
  if (locs.length === 0) return { ...s, locations: locs };

  // Locked locations keep their days verbatim — only the rest absorbs change.
  const lockedSum = locs.reduce((a, l) => a + (l.locked ? l.days : 0), 0);
  const unlockedIdxs = locs.map((l, i) => (l.locked ? -1 : i)).filter((i) => i >= 0);
  const remainingTotal = Math.max(0, total - lockedSum);

  if (unlockedIdxs.length === 0) {
    // Everything is locked — nothing to redistribute. Trust caller.
    return { ...s, locations: locs };
  }

  const unlockedDays = unlockedIdxs.map((i) => locs[i].days);
  const sum = unlockedDays.reduce((a, b) => a + b, 0);

  if (sum === remainingTotal) return { ...s, locations: locs };

  if (sum === 0) {
    const base = Math.floor(remainingTotal / unlockedIdxs.length);
    let rem = remainingTotal - base * unlockedIdxs.length;
    unlockedIdxs.forEach((i) => {
      locs[i].days = base + (rem-- > 0 ? 1 : 0);
    });
    return { ...s, locations: locs };
  }

  const scaled = unlockedDays.map((d) => (d * remainingTotal) / sum);
  const floored = scaled.map(Math.floor);
  const used = floored.reduce((a, b) => a + b, 0);
  const rem = remainingTotal - used;
  const order = scaled
    .map((v, k) => ({ k, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) floored[order[k % order.length].k]++;

  if (remainingTotal >= unlockedIdxs.length) {
    for (let k = 0; k < unlockedIdxs.length; k++) {
      if (floored[k] < 1) {
        let maxI = 0;
        for (let j = 0; j < floored.length; j++) if (floored[j] > floored[maxI]) maxI = j;
        if (floored[maxI] > 1) {
          floored[maxI]--;
          floored[k] = 1;
        }
      }
    }
  }

  unlockedIdxs.forEach((i, k) => {
    locs[i] = applyDaysChange(locs[i], floored[k]);
  });
  return { ...s, locations: locs };
}
