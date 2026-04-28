import { describe, expect, it } from "vitest";
import {
  addDays,
  applyDaysChange,
  daysBetween,
  defaultState,
  fmtShort,
  normalizeLocation,
  parseISO,
  reconcile,
  todayISO,
  toISO,
  type Location,
  type TripState,
} from "./trip";

describe("date helpers", () => {
  describe("parseISO / toISO", () => {
    it("parses an ISO yyyy-mm-dd string into a Date", () => {
      const d = parseISO("2026-04-28");
      expect(d.getFullYear()).toBe(2026);
      // months are 0-indexed in JS
      expect(d.getMonth()).toBe(3);
      expect(d.getDate()).toBe(28);
    });

    it("formats a Date back to the same ISO string", () => {
      expect(toISO(parseISO("2026-04-28"))).toBe("2026-04-28");
    });

    it("zero-pads single-digit months and days", () => {
      expect(toISO(new Date(2026, 0, 5))).toBe("2026-01-05");
    });

    it("round-trips arbitrary dates", () => {
      const samples = ["2024-01-01", "2024-02-29", "2024-12-31", "2099-06-15"];
      for (const s of samples) expect(toISO(parseISO(s))).toBe(s);
    });
  });

  describe("addDays", () => {
    it("adds positive day counts", () => {
      expect(addDays("2026-04-28", 4)).toBe("2026-05-02");
    });

    it("adds zero days (no-op)", () => {
      expect(addDays("2026-04-28", 0)).toBe("2026-04-28");
    });

    it("subtracts when n is negative", () => {
      expect(addDays("2026-04-28", -28)).toBe("2026-03-31");
    });

    it("crosses month boundaries", () => {
      expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
      expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    });

    it("handles leap-year February", () => {
      // 2024 is a leap year
      expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
      expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
      // 2025 is not
      expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    });

    it("crosses year boundaries", () => {
      expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
      expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    });

    it("handles a full-year jump", () => {
      expect(addDays("2026-04-28", 365)).toBe("2027-04-28");
    });
  });

  describe("daysBetween", () => {
    it("returns 0 for the same date", () => {
      expect(daysBetween("2026-04-28", "2026-04-28")).toBe(0);
    });

    it("counts forward days as positive", () => {
      expect(daysBetween("2026-04-28", "2026-05-02")).toBe(4);
    });

    it("counts backward days as negative", () => {
      expect(daysBetween("2026-05-02", "2026-04-28")).toBe(-4);
    });

    it("is the inverse of addDays", () => {
      const start = "2026-04-28";
      for (const n of [-30, -1, 0, 1, 7, 365]) {
        expect(daysBetween(start, addDays(start, n))).toBe(n);
      }
    });

    it("crosses DST without rounding errors", () => {
      // CET → CEST happens around late March in Europe; values would be
      // 23 or 25 hours apart if we forgot to round.
      expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
      // CEST → CET happens around late October.
      expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    });
  });

  describe("todayISO", () => {
    it("returns today's date in YYYY-MM-DD form", () => {
      const iso = todayISO();
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Must round-trip through parseISO/toISO unchanged.
      expect(toISO(parseISO(iso))).toBe(iso);
    });
  });

  describe("fmtShort", () => {
    it("renders the nb-NO short month/day format", () => {
      // Norwegian short months are e.g. "apr.", "mai", "jun.". We don't lock
      // in the exact ICU output across Node versions — just check that we
      // produce a non-empty string that contains the day.
      const out = fmtShort("2026-04-28");
      expect(out).toContain("28");
      expect(out.length).toBeGreaterThan(2);
    });
  });
});

describe("defaultState", () => {
  it("returns 5 locations totalling 21 days", () => {
    const s = defaultState();
    expect(s.totalDays).toBe(21);
    expect(s.locations).toHaveLength(5);
    expect(s.locations.reduce((a, l) => a + l.days, 0)).toBe(21);
  });

  it("uses stable IDs so two independent calls produce the same locations", () => {
    const a = defaultState();
    const b = defaultState();
    expect(a.locations.map((l) => l.id)).toEqual(b.locations.map((l) => l.id));
  });

  it("uses today's date as the trip arrival", () => {
    expect(defaultState().arrival).toBe(todayISO());
  });
});

describe("normalizeLocation", () => {
  const loc = (over: Partial<Location> = {}): Location => ({
    id: "x",
    name: "Test",
    hotel: "",
    days: 3,
    ...over,
  });

  it("clamps a negative or fractional day count to a non-negative integer", () => {
    expect(normalizeLocation(loc({ days: -2 })).days).toBe(0);
    expect(normalizeLocation(loc({ days: 3.7 })).days).toBe(3);
  });

  it("returns an empty plans array when none is provided", () => {
    expect(normalizeLocation(loc()).plans).toEqual([]);
  });

  it("drops plans whose day index is out of range", () => {
    const result = normalizeLocation(
      loc({
        days: 2,
        plans: [
          { kind: "plan", id: "a", title: "Visit park", day: 1 },
          { kind: "plan", id: "b", title: "Out of range", day: 5 },
          { kind: "plan", id: "c", title: "In suggestions", day: null },
        ],
      }),
    );
    expect(result.plans).toHaveLength(3);
    // Out-of-range plan is moved back to suggestions (day = null).
    expect(result.plans?.find((p) => p.id === "b")?.day).toBeNull();
    expect(result.plans?.find((p) => p.id === "a")?.day).toBe(1);
  });

  it("treats entries without `kind` as plain plans", () => {
    const result = normalizeLocation(
      loc({
        days: 1,
        // simulate legacy data without `kind`
        plans: [{ id: "legacy", title: "Old plan", day: 1 } as never],
      }),
    );
    expect(result.plans?.[0]?.kind).toBe("plan");
  });

  it("falls back to local_train for an unknown travel mode", () => {
    const result = normalizeLocation(
      loc({
        days: 1,
        plans: [{ kind: "travel", id: "t", mode: "rocket" as never, day: 1 }],
      }),
    );
    expect(result.plans?.[0]).toMatchObject({ kind: "travel", mode: "local_train" });
  });

  it("strips empty travel notes", () => {
    const result = normalizeLocation(
      loc({
        days: 1,
        plans: [
          { kind: "travel", id: "t1", mode: "shinkansen", note: "  ", day: 1 },
          { kind: "travel", id: "t2", mode: "shinkansen", note: "express", day: 1 },
        ],
      }),
    );
    type PlanT = NonNullable<typeof result.plans>[number];
    const t1 = result.plans?.find((p) => p.id === "t1") as Extract<PlanT, { kind: "travel" }>;
    const t2 = result.plans?.find((p) => p.id === "t2") as Extract<PlanT, { kind: "travel" }>;
    expect(t1.note).toBeUndefined();
    expect(t2.note).toBe("express");
  });

  it("drops plain plans without a title", () => {
    const result = normalizeLocation(
      loc({
        days: 1,
        plans: [
          { kind: "plan", id: "ok", title: "Has title", day: null },
          { kind: "plan", id: "bad", title: "" as never, day: null },
        ],
      }),
    );
    expect(result.plans?.map((p) => p.id)).toEqual(["ok"]);
  });
});

describe("applyDaysChange", () => {
  const baseLoc: Location = {
    id: "x",
    name: "T",
    hotel: "",
    days: 4,
    plans: [
      { kind: "plan", id: "a", title: "Day 1", day: 1 },
      { kind: "plan", id: "b", title: "Day 4", day: 4 },
      { kind: "plan", id: "c", title: "Sugg", day: null },
    ],
  };

  it("returns a new object (does not mutate the input)", () => {
    const result = applyDaysChange(baseLoc, 2);
    expect(result).not.toBe(baseLoc);
    expect(baseLoc.days).toBe(4);
  });

  it("updates the day count", () => {
    expect(applyDaysChange(baseLoc, 2).days).toBe(2);
  });

  it("pushes plans whose day is now out of range back to suggestions", () => {
    const result = applyDaysChange(baseLoc, 2);
    expect(result.plans?.find((p) => p.id === "a")?.day).toBe(1);
    expect(result.plans?.find((p) => p.id === "b")?.day).toBeNull();
    expect(result.plans?.find((p) => p.id === "c")?.day).toBeNull();
    expect(result.plansWarning).toBe(true);
  });

  it("does not set plansWarning when no plan was displaced", () => {
    const result = applyDaysChange(baseLoc, 5);
    expect(result.plansWarning).toBeFalsy();
  });

  it("preserves an existing plansWarning even if no plan was displaced", () => {
    const result = applyDaysChange({ ...baseLoc, plansWarning: true }, 5);
    expect(result.plansWarning).toBe(true);
  });
});

describe("reconcile", () => {
  const state = (totalDays: number, days: number[], locked: boolean[] = []): TripState => ({
    totalDays,
    arrival: "2026-04-28",
    locations: days.map((d, i) => ({
      id: `l${i}`,
      name: `L${i}`,
      hotel: "",
      days: d,
      locked: locked[i],
    })),
  });

  it("is a no-op when totals already match", () => {
    const s = state(10, [3, 3, 4]);
    const out = reconcile(s);
    expect(out.locations.map((l) => l.days)).toEqual([3, 3, 4]);
  });

  it("scales unlocked locations proportionally when totalDays grows", () => {
    const out = reconcile(state(20, [3, 3, 4])); // sum=10, scale x2
    expect(out.locations.map((l) => l.days)).toEqual([6, 6, 8]);
    expect(out.locations.reduce((a, l) => a + l.days, 0)).toBe(20);
  });

  it("preserves locked locations when redistributing", () => {
    // Locked Hiroshima keeps its 3 nights; the other 4 are split between the
    // two unlocked locations.
    const s = state(7, [3, 3, 3], [false, true, false]);
    const out = reconcile(s);
    expect(out.locations[1].days).toBe(3);
    expect(out.locations.reduce((a, l) => a + l.days, 0)).toBe(7);
  });

  it("distributes evenly when all unlocked locations are at 0 days", () => {
    const s = state(7, [0, 0, 0]);
    const out = reconcile(s);
    expect(out.locations.reduce((a, l) => a + l.days, 0)).toBe(7);
    expect(out.locations.every((l) => l.days >= 1)).toBe(true);
  });

  it("returns the input unchanged when there are no locations", () => {
    const out = reconcile({ ...state(0, []) });
    expect(out.locations).toEqual([]);
  });

  it("returns the input unchanged when every location is locked", () => {
    const s = state(99, [3, 4], [true, true]);
    const out = reconcile(s);
    expect(out.locations.map((l) => l.days)).toEqual([3, 4]);
  });

  it("guarantees every unlocked location gets at least 1 night when there's room", () => {
    // 3 locations sharing 3 nights — naive scaling could leave one at 0.
    const s = state(3, [10, 1, 1]);
    const out = reconcile(s);
    expect(out.locations.every((l) => l.days >= 1)).toBe(true);
    expect(out.locations.reduce((a, l) => a + l.days, 0)).toBe(3);
  });
});
