import { describe, expect, it } from "vitest";
import {
  computeBounds,
  setLocationCheckIn,
  setLocationCheckOut,
  setLocationNights,
  transferNights,
} from "./planDates";
import type { Location, TripState } from "./trip";

// Convenience: build a deterministic TripState with the given nights array,
// starting on 2026-04-28. totalDays defaults to the sum so the trip is
// exactly allocated (matches the behaviour callers should preserve).
function makeState(days: number[], locked: boolean[] = []): TripState {
  const locations: Location[] = days.map((d, i) => ({
    id: `loc-${i}`,
    name: `L${i}`,
    hotel: "",
    days: d,
    locked: locked[i] ?? false,
  }));
  return {
    arrival: "2026-04-28",
    totalDays: days.reduce((a, b) => a + b, 0),
    locations,
  };
}

describe("computeBounds", () => {
  // Trip: Fukuoka 4 / Hiroshima 3 / Osaka 4 / Kyoto 5 / Tokyo 5 = 21 nights
  // starting 2026-04-28 → return 2026-05-19.
  const trip = makeState([4, 3, 4, 5, 5]);

  it("derives check-in and check-out dates from arrival + offsets", () => {
    expect(computeBounds(trip, 0)).toMatchObject({
      checkIn: "2026-04-28",
      checkOut: "2026-05-02",
      isFirst: true,
      isLast: false,
    });
    expect(computeBounds(trip, 1)).toMatchObject({
      checkIn: "2026-05-02",
      checkOut: "2026-05-05",
    });
    expect(computeBounds(trip, 4)).toMatchObject({
      checkIn: "2026-05-14",
      checkOut: "2026-05-19",
      isFirst: false,
      isLast: true,
    });
  });

  it("locks check-in for the first location to the trip arrival", () => {
    const b = computeBounds(trip, 0);
    expect(b.checkInMin).toBe(b.checkIn);
    expect(b.checkInMax).toBe(b.checkIn);
  });

  it("locks check-out for the last location to the trip return", () => {
    const b = computeBounds(trip, 4);
    expect(b.checkOutMin).toBe(b.checkOut);
    expect(b.checkOutMax).toBe(b.checkOut);
  });

  it("clamps a middle location's check-in between prev start +1 and check-out -1", () => {
    // Hiroshima starts 2026-05-02, prev (Fukuoka) starts 2026-04-28 with 4
    // nights → earliest check-in is 04-29 (Fukuoka keeps ≥1 night).
    // Latest check-in is 05-04 (Hiroshima keeps ≥1 night before its 05-05
    // check-out).
    const b = computeBounds(trip, 1);
    expect(b.checkInMin).toBe("2026-04-29");
    expect(b.checkInMax).toBe("2026-05-04");
  });

  it("clamps a middle location's check-out between check-in +1 and next end -1", () => {
    // Hiroshima check-in 05-02, check-out 05-05; next (Osaka) ends 05-09.
    // Earliest check-out 05-03 (Hiroshima keeps ≥1 night).
    // Latest check-out 05-08 (Osaka keeps ≥1 night before its end).
    const b = computeBounds(trip, 1);
    expect(b.checkOutMin).toBe("2026-05-03");
    expect(b.checkOutMax).toBe("2026-05-08");
  });

  it("computes nightsMax as this.days + sibling.days - 1", () => {
    const b = computeBounds(trip, 1);
    // Hiroshima 3 nights borrows from Osaka's 4 → max 3 + 4 - 1 = 6.
    expect(b.nightsMin).toBe(1);
    expect(b.nightsMax).toBe(6);
  });

  it("borrows from the previous location when computing nightsMax for the last loc", () => {
    const b = computeBounds(trip, 4);
    // Tokyo 5, prev (Kyoto) 5 → 5 + 5 - 1 = 9.
    expect(b.nightsMax).toBe(9);
  });

  it("treats single-location trips as unbounded (up to 365 nights)", () => {
    const b = computeBounds(makeState([7]), 0);
    expect(b.isFirst).toBe(true);
    expect(b.isLast).toBe(true);
    expect(b.nightsMax).toBe(365);
  });

  it("clamps an out-of-range idx to a valid one rather than throwing", () => {
    expect(() => computeBounds(trip, 99)).not.toThrow();
    expect(() => computeBounds(trip, -1)).not.toThrow();
  });
});

describe("transferNights", () => {
  const locs = makeState([4, 3, 4]).locations;

  it("returns a new array with the donor and recipient updated", () => {
    const result = transferNights(locs, 1, 2, 2);
    expect(result).not.toBeNull();
    expect(result!.map((l) => l.days)).toEqual([4, 5, 2]);
    expect(result).not.toBe(locs);
  });

  it("supports negative deltas (recipient shrinks; donor grows)", () => {
    const result = transferNights(locs, 1, -1, 2);
    expect(result!.map((l) => l.days)).toEqual([4, 2, 5]);
  });

  it("returns the input unchanged when delta is 0", () => {
    expect(transferNights(locs, 1, 0, 2)).toBe(locs);
  });

  it("returns null if the recipient would drop below 1 night", () => {
    expect(transferNights(makeState([3, 3]).locations, 0, -3, 1)).toBeNull();
  });

  it("returns null if the donor would drop below 1 night", () => {
    // Hiroshima borrows 3 from Osaka's 3 → Osaka would end at 0. Reject.
    expect(transferNights(locs, 1, 4, 2)).toBeNull();
  });

  it("rejects donor === recipient", () => {
    expect(transferNights(locs, 1, 2, 1)).toBeNull();
  });

  it("rejects out-of-range indices", () => {
    expect(transferNights(locs, -1, 1, 0)).toBeNull();
    expect(transferNights(locs, 0, 1, 99)).toBeNull();
  });

  it("does not mutate the input array", () => {
    const before = locs.map((l) => l.days);
    transferNights(locs, 0, 1, 1);
    expect(locs.map((l) => l.days)).toEqual(before);
  });
});

describe("setLocationNights", () => {
  it("borrows from the next location for non-last entries", () => {
    const next = setLocationNights(makeState([4, 3, 4, 5, 5]), 1, 5);
    // Hiroshima goes 3 → 5, donating 2 from Osaka 4 → 2.
    expect(next!.locations.map((l) => l.days)).toEqual([4, 5, 2, 5, 5]);
    // totalDays preserved.
    expect(next!.totalDays).toBe(21);
  });

  it("borrows from the previous location for the last entry", () => {
    const next = setLocationNights(makeState([4, 3, 4, 5, 5]), 4, 7);
    // Tokyo 5 → 7, donating 2 from Kyoto 5 → 3.
    expect(next!.locations.map((l) => l.days)).toEqual([4, 3, 4, 3, 7]);
    expect(next!.totalDays).toBe(21);
  });

  it("returns the same state when newDays equals current days", () => {
    const s = makeState([4, 3, 4]);
    expect(setLocationNights(s, 1, 3)).toBe(s);
  });

  it("rejects locked locations", () => {
    const s = makeState([4, 3, 4], [false, true, false]);
    expect(setLocationNights(s, 1, 5)).toBeNull();
  });

  it("clamps requests so the donor never goes below 1 night", () => {
    // Hiroshima 3 → 6: donor (Osaka 4) would end at 1 — OK as-is.
    const ok = setLocationNights(makeState([4, 3, 4]), 1, 6);
    expect(ok!.locations.map((l) => l.days)).toEqual([4, 6, 1]);
    // Hiroshima 3 → 7 would zero the donor; clamped to max=6 instead.
    const clamped = setLocationNights(makeState([4, 3, 4]), 1, 7);
    expect(clamped!.locations.map((l) => l.days)).toEqual([4, 6, 1]);
  });

  it("clamps fractional and below-min values to 1 night", () => {
    const next = setLocationNights(makeState([4, 3, 4]), 1, 0);
    // 0 → clamped to 1; Hiroshima 3 → 1, Osaka grows by 2.
    expect(next!.locations[1].days).toBe(1);
    expect(next!.locations[2].days).toBe(6);
  });

  it("ignores non-finite input rather than crashing", () => {
    expect(setLocationNights(makeState([4, 3, 4]), 1, NaN)).toBeNull();
    expect(setLocationNights(makeState([4, 3, 4]), 1, Infinity)).toBeNull();
  });

  it("changes totalDays directly for a single-location trip", () => {
    const next = setLocationNights(makeState([5]), 0, 9);
    expect(next!.locations[0].days).toBe(9);
    expect(next!.totalDays).toBe(9);
  });

  it("rejects an out-of-range idx", () => {
    expect(setLocationNights(makeState([4, 3]), 5, 4)).toBeNull();
    expect(setLocationNights(makeState([4, 3]), -1, 4)).toBeNull();
  });
});

describe("setLocationCheckIn", () => {
  const trip = makeState([4, 3, 4, 5, 5]);

  it("transfers nights to/from the previous location", () => {
    // Hiroshima check-in 05-02 → 05-04 means previous (Fukuoka) grows by 2,
    // Hiroshima shrinks by 2.
    const next = setLocationCheckIn(trip, 1, "2026-05-04");
    expect(next!.locations.map((l) => l.days)).toEqual([6, 1, 4, 5, 5]);
    expect(next!.totalDays).toBe(21);
  });

  it("supports moving check-in earlier (this loc grows; prev shrinks)", () => {
    const next = setLocationCheckIn(trip, 1, "2026-04-30");
    expect(next!.locations.map((l) => l.days)).toEqual([2, 5, 4, 5, 5]);
  });

  it("returns null when called for the first location (its check-in is fixed)", () => {
    expect(setLocationCheckIn(trip, 0, "2026-04-29")).toBeNull();
  });

  it("returns null when the move would push the previous location below 1 night", () => {
    // Hiroshima check-in 05-02 → 04-29 needs Fukuoka to drop from 4 to 1 (OK).
    expect(setLocationCheckIn(trip, 1, "2026-04-29")).not.toBeNull();
    // 04-28 would mean Fukuoka has 0 nights — reject.
    expect(setLocationCheckIn(trip, 1, "2026-04-28")).toBeNull();
  });

  it("returns null when the move would push this loc below 1 night", () => {
    // Hiroshima check-out is 05-05; check-in must stay at most 05-04.
    expect(setLocationCheckIn(trip, 1, "2026-05-05")).toBeNull();
  });

  it("returns the input state when the new check-in matches the current one", () => {
    expect(setLocationCheckIn(trip, 1, "2026-05-02")).toBe(trip);
  });

  it("rejects locked locations", () => {
    const locked = makeState([4, 3, 4, 5, 5], [false, true]);
    expect(setLocationCheckIn(locked, 1, "2026-05-04")).toBeNull();
  });
});

describe("setLocationCheckOut", () => {
  const trip = makeState([4, 3, 4, 5, 5]);

  it("transfers nights to/from the next location", () => {
    // Hiroshima check-out 05-05 → 05-07: this loc grows by 2, Osaka shrinks by 2.
    const next = setLocationCheckOut(trip, 1, "2026-05-07");
    expect(next!.locations.map((l) => l.days)).toEqual([4, 5, 2, 5, 5]);
    expect(next!.totalDays).toBe(21);
  });

  it("supports moving check-out earlier (this shrinks; next grows)", () => {
    const next = setLocationCheckOut(trip, 1, "2026-05-04");
    expect(next!.locations.map((l) => l.days)).toEqual([4, 2, 5, 5, 5]);
  });

  it("returns null when called for the last location (its check-out is fixed)", () => {
    expect(setLocationCheckOut(trip, 4, "2026-05-20")).toBeNull();
  });

  it("returns null when the move would push the next location below 1 night", () => {
    // Hiroshima check-out 05-05 → 05-08 needs Osaka to drop 4 → 1 (OK).
    expect(setLocationCheckOut(trip, 1, "2026-05-08")).not.toBeNull();
    // 05-09 would leave Osaka at 0 — reject.
    expect(setLocationCheckOut(trip, 1, "2026-05-09")).toBeNull();
  });

  it("returns null when the move would push this loc below 1 night", () => {
    // Check-in is 05-02; check-out must stay strictly after.
    expect(setLocationCheckOut(trip, 1, "2026-05-02")).toBeNull();
  });

  it("returns the input state when the new check-out matches the current one", () => {
    expect(setLocationCheckOut(trip, 1, "2026-05-05")).toBe(trip);
  });

  it("rejects locked locations", () => {
    const locked = makeState([4, 3, 4, 5, 5], [false, true]);
    expect(setLocationCheckOut(locked, 1, "2026-05-07")).toBeNull();
  });
});

describe("integration: editing dates preserves the trip window", () => {
  // Whatever combination of edits we apply, totalDays must stay constant
  // and every location must keep ≥1 night.
  it("never violates the invariants across a sequence of legal edits", () => {
    let s: TripState = makeState([4, 3, 4, 5, 5]);
    const ops: Array<(s: TripState) => TripState | null> = [
      (s) => setLocationNights(s, 1, 5),
      (s) => setLocationCheckOut(s, 2, "2026-05-08"),
      (s) => setLocationCheckIn(s, 3, "2026-05-09"),
      (s) => setLocationNights(s, 4, 6),
    ];
    for (const op of ops) {
      const next = op(s);
      if (next) s = next;
      expect(s.locations.every((l) => l.days >= 1)).toBe(true);
      expect(s.locations.reduce((a, l) => a + l.days, 0)).toBe(s.totalDays);
      expect(s.totalDays).toBe(21);
    }
  });
});
