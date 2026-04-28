import { addDays, daysBetween, type Location, type TripState } from "./trip";

// Pure, side-effect-free helpers backing the plan-page date editor.
// These exist as a separate module (rather than inline in plan.tsx) so the
// clamping rules can be unit-tested without rendering React.

export type DateBounds = {
  isFirst: boolean;
  isLast: boolean;
  /** ISO yyyy-mm-dd of this location's check-in day. */
  checkIn: string;
  /** ISO yyyy-mm-dd of this location's check-out day (= start of the next location, or trip return for the last loc). */
  checkOut: string;
  /** Earliest allowed check-in (inclusive). For the first location this equals the current check-in (the picker is meant to be disabled). */
  checkInMin: string;
  /** Latest allowed check-in (inclusive). At least one night for this location. */
  checkInMax: string;
  /** Earliest allowed check-out (inclusive). At least one night for this location. */
  checkOutMin: string;
  /** Latest allowed check-out (inclusive). At least one night for the next location (when it exists). */
  checkOutMax: string;
  /** Minimum allowed nights for this location. */
  nightsMin: number;
  /** Maximum allowed nights for this location, accounting for the borrow-from-sibling rule. */
  nightsMax: number;
};

/**
 * Compute the editable date bounds for the location at `idx`.
 *
 * Rules:
 *  - The first location's check-in is locked to the trip arrival; the last
 *    location's check-out is locked to the trip return.
 *  - Every location must keep at least one night.
 *  - Nights borrowed/given when editing a date come from the immediately
 *    adjacent location (previous when shifting check-in, next when shifting
 *    check-out), preserving `state.totalDays`.
 *
 * Returns sensible bounds even when `idx` is invalid so callers don't have
 * to special-case "not found"; callers should guard before calling.
 */
export function computeBounds(state: TripState, idx: number): DateBounds {
  const locs = state.locations;
  const safeIdx = Math.max(0, Math.min(locs.length - 1, idx));
  const isFirst = safeIdx === 0;
  const isLast = safeIdx === locs.length - 1;

  const offsetBefore = locs.slice(0, safeIdx).reduce((a, l) => a + l.days, 0);
  const checkIn = addDays(state.arrival, offsetBefore);
  const days = locs[safeIdx]?.days ?? 0;
  const checkOut = addDays(checkIn, days);
  const prevDays = isFirst ? 0 : locs[safeIdx - 1].days;
  const nextDays = isLast ? 0 : locs[safeIdx + 1].days;

  const checkInMin = isFirst ? checkIn : addDays(checkIn, -(prevDays - 1));
  const checkInMax = isFirst ? checkIn : addDays(checkOut, -1);
  const checkOutMin = isLast ? checkOut : addDays(checkIn, 1);
  const checkOutMax = isLast ? checkOut : addDays(checkOut, nextDays - 1);

  const onlyOne = locs.length === 1;
  // The donor for a nights edit: next sibling unless we're the last location,
  // in which case we borrow backwards from the previous one.
  const sibDays = isLast ? prevDays : nextDays;
  const nightsMin = 1;
  const nightsMax = onlyOne ? 365 : Math.max(1, days + sibDays - 1);

  return {
    isFirst,
    isLast,
    checkIn,
    checkOut,
    checkInMin,
    checkInMax,
    checkOutMin,
    checkOutMax,
    nightsMin,
    nightsMax,
  };
}

/**
 * Move `delta` nights from `donorIdx` into `idx`, returning a new locations
 * array. Returns `null` if the move would push either side below one night,
 * or if either index is out of range.
 *
 * `delta` may be negative (this location shrinks; donor grows).
 */
export function transferNights(
  locations: Location[],
  idx: number,
  delta: number,
  donorIdx: number,
): Location[] | null {
  if (idx < 0 || idx >= locations.length) return null;
  if (donorIdx < 0 || donorIdx >= locations.length) return null;
  if (idx === donorIdx) return null;
  if (delta === 0) return locations;
  const cur = locations[idx];
  const donor = locations[donorIdx];
  const newCur = cur.days + delta;
  const newDonor = donor.days - delta;
  if (newCur < 1 || newDonor < 1) return null;
  const next = locations.slice();
  next[idx] = { ...cur, days: newCur };
  next[donorIdx] = { ...donor, days: newDonor };
  return next;
}

/**
 * Apply a new nights count to the location at `idx`, borrowing from / giving
 * to the appropriate sibling so the trip's total length stays fixed.
 *
 * Special cases:
 *  - Single-location trip: `state.totalDays` follows the new nights.
 *  - Last location: borrows from the previous sibling.
 *  - Otherwise: borrows from the next sibling.
 *
 * Returns the new state, or `null` if the change is rejected (e.g. would take
 * the donor below one night, or `newDays` is not a finite positive number).
 */
export function setLocationNights(
  state: TripState,
  idx: number,
  newDays: number,
): TripState | null {
  const locs = state.locations;
  if (idx < 0 || idx >= locs.length) return null;
  if (!Number.isFinite(newDays)) return null;
  const cur = locs[idx];
  if (cur.locked) return null;
  const onlyOne = locs.length === 1;

  if (onlyOne) {
    const d = Math.max(1, Math.min(365, Math.floor(newDays)));
    if (d === cur.days) return state;
    const next = locs.slice();
    next[idx] = { ...cur, days: d };
    return { ...state, locations: next, totalDays: d };
  }

  const isLast = idx === locs.length - 1;
  const donorIdx = isLast ? idx - 1 : idx + 1;
  const sibDays = locs[donorIdx].days;
  const nightsMax = Math.max(1, cur.days + sibDays - 1);
  const d = Math.max(1, Math.min(nightsMax, Math.floor(newDays)));
  if (d === cur.days) return state;
  const moved = transferNights(locs, idx, d - cur.days, donorIdx);
  if (!moved) return null;
  return { ...state, locations: moved };
}

/**
 * Apply a new check-in ISO date to the location at `idx`, transferring nights
 * to/from the previous location. The first location's check-in is fixed (it
 * equals the trip arrival) and the function returns `null` for it.
 */
export function setLocationCheckIn(
  state: TripState,
  idx: number,
  iso: string,
): TripState | null {
  if (idx <= 0 || idx >= state.locations.length) return null;
  if (state.locations[idx].locked) return null;
  const { checkIn } = computeBounds(state, idx);
  const delta = daysBetween(checkIn, iso);
  if (delta === 0) return state;
  // Later check-in => previous loc grows, this one shrinks.
  const moved = transferNights(state.locations, idx, -delta, idx - 1);
  if (!moved) return null;
  return { ...state, locations: moved };
}

/**
 * Apply a new check-out ISO date to the location at `idx`, transferring
 * nights to/from the next location. The last location's check-out is fixed
 * (it equals the trip return) and the function returns `null` for it.
 */
export function setLocationCheckOut(
  state: TripState,
  idx: number,
  iso: string,
): TripState | null {
  if (idx < 0 || idx >= state.locations.length - 1) return null;
  if (state.locations[idx].locked) return null;
  const { checkOut } = computeBounds(state, idx);
  const delta = daysBetween(checkOut, iso);
  if (delta === 0) return state;
  // Later check-out => this loc grows, next one shrinks.
  const moved = transferNights(state.locations, idx, delta, idx + 1);
  if (!moved) return null;
  return { ...state, locations: moved };
}
