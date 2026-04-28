import { type DragEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Route } from "./+types/plan";
import {
  Alert,
  BodyShort,
  Button,
  DatePicker,
  Heading,
  Loader,
  Select,
  TextField,
  useDatepicker,
} from "@navikt/ds-react";
import { ArrowLeftIcon, CheckmarkIcon, PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from "@navikt/aksel-icons";
import {
  type Plan,
  TRANSIT_EMOJI,
  TRANSIT_LABEL,
  TRANSIT_MODES,
  type TransitMode,
  type TripState,
  addDays,
  daysBetween,
  defaultState,
  fmtShort,
  loadState,
  newId,
  parseISO,
  saveState,
  toISO,
} from "../lib/trip";
import { getTrip } from "../lib/firestore.server";
import { flagForLocation } from "../lib/japan";

export function meta() {
  return [{ title: "Planlegg sted – Japan-reiseplanlegger" }];
}

export async function loader(_: Route.LoaderArgs) {
  // Same pattern as home.tsx: ship the trip state in the initial HTML.
  try {
    const state = await getTrip();
    return { state };
  } catch {
    return { state: defaultState() };
  }
}

const DRAG_MIME = "application/x-japan-plan-id";

function LocDatesEditor({
  checkIn,
  checkOut,
  nights,
  disabled,
  onCheckInChange,
  onCheckOutChange,
  onNightsChange,
}: {
  checkIn: string;
  checkOut: string;
  nights: number;
  disabled: boolean;
  onCheckInChange: (iso: string) => void;
  onCheckOutChange: (iso: string) => void;
  onNightsChange: (n: number) => void;
}) {
  // Two independent Aksel datepickers. Re-keyed on the bound ISO so external
  // updates (e.g. nights changes that move check-out) actually refresh the
  // popup's selected date — useDatepicker only reads defaultSelected once.
  const checkInPicker = useDatepicker({
    defaultSelected: parseISO(checkIn),
    onDateChange: (d) => {
      if (d) onCheckInChange(toISO(d));
    },
  });
  const checkOutPicker = useDatepicker({
    defaultSelected: parseISO(checkOut),
    fromDate: parseISO(addDays(checkIn, 1)),
    onDateChange: (d) => {
      if (d) onCheckOutChange(toISO(d));
    },
  });
  return (
    <div className="plan-dates">
      <DatePicker
        key={`in-${checkIn}`}
        {...checkInPicker.datepickerProps}
        locale="nb"
      >
        <DatePicker.Input
          {...checkInPicker.inputProps}
          label="Innsjekking"
          size="small"
          disabled={disabled}
        />
      </DatePicker>
      <DatePicker
        key={`out-${checkOut}`}
        {...checkOutPicker.datepickerProps}
        locale="nb"
      >
        <DatePicker.Input
          {...checkOutPicker.inputProps}
          label="Utsjekking"
          size="small"
          disabled={disabled}
        />
      </DatePicker>
      <TextField
        label="Antall netter"
        size="small"
        type="number"
        inputMode="numeric"
        className="plan-dates-nights"
        value={String(nights)}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onNightsChange(n);
        }}
      />
    </div>
  );
}

export default function PlanPage({ loaderData }: Route.ComponentProps) {
  const params = useParams();
  const navigate = useNavigate();
  const id = params.id || "";
  const [hydrated, setHydrated] = useState(!!loaderData?.state);
  const [state, setState] = useState<TripState>(
    () => loaderData?.state ?? defaultState(),
  );
  const [newTitle, setNewTitle] = useState("");
  const [travelMode, setTravelMode] = useState<TransitMode>("shinkansen");
  const [travelNote, setTravelNote] = useState("");
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const autoArrow = (s: string) => s.replace(/->/g, "→");

  // Clear the location's plansWarning on first visit. If we got server data,
  // act on it immediately; otherwise fetch via the legacy client path (kept as
  // a defensive fallback).
  useEffect(() => {
    if (loaderData?.state) {
      const idx = state.locations.findIndex((l) => l.id === id);
      if (idx >= 0 && state.locations[idx].plansWarning) {
        setState((s) => ({
          ...s,
          locations: s.locations.map((l, j) =>
            j === idx ? { ...l, plansWarning: false } : l,
          ),
        }));
      }
      return;
    }
    let cancelled = false;
    (async () => {
      const loaded = await loadState();
      if (cancelled) return;
      if (loaded) {
        const idx = loaded.locations.findIndex((l) => l.id === id);
        if (idx >= 0 && loaded.locations[idx].plansWarning) {
          loaded.locations = loaded.locations.map((l, j) =>
            j === idx ? { ...l, plansWarning: false } : l,
          );
        }
        setState(loaded);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loaderData?.state]);

  // Persist on change (debounced; only after hydration so we don't overwrite stored data).
  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => {
      void saveState(state);
    }, 400);
    return () => window.clearTimeout(t);
  }, [state, hydrated]);

  const idx = state.locations.findIndex((l) => l.id === id);
  const loc = idx >= 0 ? state.locations[idx] : null;

  const offsetBefore = useMemo(() => {
    if (idx < 0) return 0;
    let acc = 0;
    for (let i = 0; i < idx; i++) acc += state.locations[i].days;
    return acc;
  }, [state.locations, idx]);

  const updatePlans = (mut: (plans: Plan[]) => Plan[]) => {
    setState((s) => ({
      ...s,
      locations: s.locations.map((l, j) =>
        j === idx ? { ...l, plans: mut(l.plans ?? []) } : l,
      ),
    }));
  };

  const addPlan = () => {
    const t = newTitle.trim();
    if (!t) return;
    updatePlans((plans) => [...plans, { kind: "plan", id: newId(), title: t, day: null }]);
    setNewTitle("");
  };

  const addTravel = () => {
    const note = travelNote.trim();
    updatePlans((plans) => [
      ...plans,
      {
        kind: "travel",
        id: newId(),
        mode: travelMode,
        note: note || undefined,
        day: null,
      },
    ]);
    setTravelNote("");
  };

  const removePlan = (planId: string) => {
    updatePlans((plans) => plans.filter((p) => p.id !== planId));
  };

  // Edit a plan in place. Caller passes a partial patch which is shallow-merged
  // onto the existing plan (preserving the discriminator `kind`).
  const editPlan = (planId: string, patch: Partial<Plan>) => {
    updatePlans((plans) =>
      plans.map((p) => (p.id === planId ? ({ ...p, ...patch } as Plan) : p)),
    );
  };

  // Move a plan to a target day. If `beforeId` is provided, insert the plan
  // immediately before that plan in the flat list (which controls render order
  // within a day). Otherwise append to the end of the target day's list.
  const movePlan = (planId: string, day: number | null, beforeId?: string) => {
    updatePlans((plans) => {
      const item = plans.find((p) => p.id === planId);
      if (!item) return plans;
      const updated = { ...item, day } as Plan;
      const without = plans.filter((p) => p.id !== planId);
      if (beforeId) {
        const beforeIdx = without.findIndex((p) => p.id === beforeId);
        if (beforeIdx >= 0) {
          return [
            ...without.slice(0, beforeIdx),
            updated,
            ...without.slice(beforeIdx),
          ];
        }
      }
      return [...without, updated];
    });
  };

  // Drop on another plan item -> insert dragged before the target, taking the
  // target's current day. Works both within the same day (reorder) and across
  // sections (move + reorder in one gesture).
  const onDropBefore = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setDragOverKey(null);
    setState((s) => ({
      ...s,
      locations: s.locations.map((l, j) => {
        if (j !== idx) return l;
        const plans = l.plans ?? [];
        const dragged = plans.find((p) => p.id === draggedId);
        const target = plans.find((p) => p.id === targetId);
        if (!dragged || !target) return l;
        const updated = { ...dragged, day: target.day } as Plan;
        const without = plans.filter((p) => p.id !== draggedId);
        const beforeIdx = without.findIndex((p) => p.id === targetId);
        if (beforeIdx < 0) return l;
        return {
          ...l,
          plans: [
            ...without.slice(0, beforeIdx),
            updated,
            ...without.slice(beforeIdx),
          ],
        };
      }),
    }));
  };

  // Drag-and-drop helpers — payload carries plan.id (stable across re-renders).
  const onDragStart = (e: DragEvent, planId: string) => {
    try {
      e.dataTransfer.setData(DRAG_MIME, planId);
      e.dataTransfer.setData("text/plain", planId);
    } catch {
      /* ignored */
    }
    e.dataTransfer.effectAllowed = "move";
  };

  const onDropTo = (e: DragEvent, day: number | null, key: string) => {
    e.preventDefault();
    setDragOverKey(null);
    const planId =
      e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (!planId) return;
    movePlan(planId, day);
  };

  const dropTargetProps = (day: number | null, key: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverKey !== key) setDragOverKey(key);
    },
    onDragLeave: () => {
      if (dragOverKey === key) setDragOverKey(null);
    },
    onDrop: (e: DragEvent) => onDropTo(e, day, key),
    "data-active": dragOverKey === key ? "true" : undefined,
  });

  if (!hydrated) {
    return (
      <div className="trip-wrap plan-wrap">
        <Loader title="Laster …" />
      </div>
    );
  }

  if (!loc) {
    return (
      <div className="trip-wrap plan-wrap">
        <Alert variant="warning">Fant ikke stedet.</Alert>
        <div>
          <Button onClick={() => navigate("/")} variant="secondary" icon={<ArrowLeftIcon aria-hidden />}>
            Tilbake
          </Button>
        </div>
      </div>
    );
  }

  const plans = loc.plans ?? [];
  const suggestions = plans.filter((p) => p.day === null);
  const planSuggestions = suggestions.filter((p) => p.kind !== "travel");
  const travelSuggestions = suggestions.filter((p) => p.kind === "travel");
  const flag = flagForLocation(loc.name, 48);
  const checkIn = addDays(state.arrival, offsetBefore);
  const checkOut = addDays(checkIn, loc.days);
  const totalAllocated = state.locations.reduce((a, l) => a + l.days, 0);
  // If the trip has wandered into an inconsistent state, surface it but don't block.
  const tripMismatch = totalAllocated !== state.totalDays;

  const days = Array.from({ length: loc.days }, (_, i) => i + 1);

  // Apply a new nights count to the current location and let totalDays follow.
  // Refuses anything below 1 night and silently caps absurdly large values
  // (we don't want a single typo to allocate 10 000 days).
  const setDaysForLoc = (newDays: number) => {
    if (!Number.isFinite(newDays)) return;
    const d = Math.max(1, Math.min(365, Math.floor(newDays)));
    if (loc.locked) return;
    if (d === loc.days) return;
    setState((s) => {
      const locs = s.locations.map((l, j) =>
        j === idx ? { ...l, days: d } : l,
      );
      const totalDays = locs.reduce((a, l) => a + l.days, 0);
      return { ...s, locations: locs, totalDays };
    });
  };

  // Check-out is just check-in + days, so editing the date adjusts the
  // nights count.
  // Editing check-in shifts the whole trip's arrival date by the same delta,
  // so this location's check-in lands on the chosen date. All locations'
  // night counts are preserved; their absolute dates just shift together.
  const onCheckInChange = (iso: string) => {
    if (!iso) return;
    const delta = daysBetween(checkIn, iso);
    if (delta === 0) return;
    setState((s) => ({ ...s, arrival: addDays(s.arrival, delta) }));
  };

  const onCheckOutChange = (iso: string) => {
    if (!iso) return;
    const d = daysBetween(checkIn, iso);
    if (d < 1) return;
    setDaysForLoc(d);
  };

  return (
    <div className="trip-wrap plan-wrap">
      <div className="plan-head">
        <Button
          onClick={() => navigate("/")}
          variant="tertiary"
          size="small"
          icon={<ArrowLeftIcon aria-hidden />}
        >
          Tilbake
        </Button>
        <span
          className="trip-flag-wrap plan-flag"
          style={{
            backgroundImage: flag ? `url(${flag})` : "none",
            backgroundColor: flag ? "var(--trip-card-bg)" : "#ccc",
          }}
          aria-hidden="true"
        />
        <Heading size="large" level="1" className="plan-title">
          Planlegg: {loc.name || "(uten navn)"}
        </Heading>
      </div>

      <LocDatesEditor
        checkIn={checkIn}
        checkOut={checkOut}
        nights={loc.days}
        disabled={!!loc.locked}
        onCheckInChange={onCheckInChange}
        onCheckOutChange={onCheckOutChange}
        onNightsChange={setDaysForLoc}
      />
      {loc.locked ? (
        <BodyShort size="small" textColor="subtle" className="plan-dates-locked-hint">
          Stedet er låst — lås opp for å endre datoer.
        </BodyShort>
      ) : null}

      {tripMismatch ? (
        <Alert variant="info" size="small">
          Antall netter ({state.totalDays}) stemmer ikke med fordelingen ({totalAllocated}). Gå tilbake og juster.
        </Alert>
      ) : null}

      <div className="plan-grid">
        <section
          className="plan-section plan-suggestions"
          {...dropTargetProps(null, "sugg")}
        >
          <Heading size="small" level="2">
            Forslag
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Lag forslag her, dra dem inn i kalenderen.
          </BodyShort>

          <div className="plan-add">
            <TextField
              label="Nytt forslag"
              size="small"
              hideLabel
              placeholder="F.eks. Besøk Fushimi Inari"
              value={newTitle}
              onChange={(e) => setNewTitle(autoArrow(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPlan();
                }
              }}
            />
            <Button
              size="small"
              variant="primary"
              icon={<PlusIcon aria-hidden />}
              onClick={addPlan}
              disabled={!newTitle.trim()}
            >
              Legg til
            </Button>
          </div>

          <ul className="plan-list">
            {planSuggestions.length === 0 ? (
              <li className="plan-empty">Ingen forslag enda.</li>
            ) : (
              planSuggestions.map((p) => (
                <PlanItem
                  key={p.id}
                  plan={p}
                  onDragStart={onDragStart}
                  onRemove={removePlan}
                  onDropBefore={onDropBefore}
                  onEdit={editPlan}
                />
              ))
            )}
          </ul>

          <div className="plan-travel-block">
            <BodyShort size="small" weight="semibold" textColor="subtle">
              Legg til reise
            </BodyShort>
            <div className="plan-add-travel">
              <Select
                label="Transportmiddel"
                size="small"
                hideLabel
                value={travelMode}
                onChange={(e) => setTravelMode(e.target.value as TransitMode)}
              >
                {TRANSIT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {TRANSIT_EMOJI[m]} {TRANSIT_LABEL[m]}
                  </option>
                ))}
              </Select>
              <TextField
                label="Notat"
                size="small"
                hideLabel
                placeholder="F.eks. Tokyo → Kyoto, kl. 09:00"
                value={travelNote}
                onChange={(e) => setTravelNote(autoArrow(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTravel();
                  }
                }}
              />
              <Button
                size="small"
                variant="secondary"
                icon={<PlusIcon aria-hidden />}
                onClick={addTravel}
              >
                Legg til reise
              </Button>
            </div>
            <ul className="plan-list">
              {travelSuggestions.length === 0 ? (
                <li className="plan-empty">Ingen reiser enda.</li>
              ) : (
                travelSuggestions.map((p) => (
                  <PlanItem
                    key={p.id}
                    plan={p}
                    onDragStart={onDragStart}
                    onRemove={removePlan}
                    onDropBefore={onDropBefore}
                  onEdit={editPlan}
                  />
                ))
              )}
            </ul>
          </div>
        </section>

        <section className="plan-section plan-calendar">
          <Heading size="small" level="2">
            Kalender
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Én kolonne per dag. Dra forslag inn for å planlegge.
          </BodyShort>

          {loc.days === 0 ? (
            <Alert variant="warning" size="small">
              Stedet har 0 netter. Øk antall netter for å kunne planlegge dager.
            </Alert>
          ) : (
            <div className="plan-days">
              {days.map((d) => {
                const dayPlans = plans.filter((p) => p.day === d);
                const date = addDays(checkIn, d - 1);
                return (
                  <div
                    key={d}
                    className="plan-day"
                    {...dropTargetProps(d, `d-${d}`)}
                  >
                    <div className="plan-day-head">
                      <span className="plan-day-num">Dag {d}</span>
                      <span className="plan-day-date">{fmtShort(date)}</span>
                    </div>
                    <ul className="plan-list">
                      {dayPlans.length === 0 ? (
                        <li className="plan-empty">Slipp her</li>
                      ) : (
                        dayPlans.map((p) => (
                          <PlanItem
                            key={p.id}
                            plan={p}
                            onDragStart={onDragStart}
                            onRemove={removePlan}
                            onDropBefore={onDropBefore}
                  onEdit={editPlan}
                          />
                        ))
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PlanItem({
  plan,
  onDragStart,
  onRemove,
  onDropBefore,
  onEdit,
}: {
  plan: Plan;
  onDragStart: (e: DragEvent, planId: string) => void;
  onRemove: (planId: string) => void;
  onDropBefore: (draggedId: string, targetId: string) => void;
  onEdit: (planId: string, patch: Partial<Plan>) => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const [editing, setEditing] = useState(false);
  const isTravel = plan.kind === "travel";
  // Local draft state — initialized when entering edit mode below.
  const [draftTitle, setDraftTitle] = useState("");
  const [draftMode, setDraftMode] = useState<TransitMode>("shinkansen");
  const [draftNote, setDraftNote] = useState("");

  const startEdit = () => {
    if (plan.kind === "plan") {
      setDraftTitle(plan.title);
    } else {
      setDraftMode(plan.mode);
      setDraftNote(plan.note ?? "");
    }
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    if (plan.kind === "plan") {
      const t = draftTitle.trim();
      if (!t) return;
      onEdit(plan.id, { title: t } as Partial<Plan>);
    } else {
      onEdit(plan.id, {
        mode: draftMode,
        note: draftNote.trim() || undefined,
      } as Partial<Plan>);
    }
    setEditing(false);
  };

  const label = isTravel
    ? `${TRANSIT_EMOJI[plan.mode]}${plan.note ? " " + plan.note : ""}`
    : plan.title;
  const itemTitle = isTravel ? TRANSIT_LABEL[plan.mode] : undefined;
  const ariaRemove = isTravel
    ? `Fjern reise med ${TRANSIT_LABEL[plan.mode]}`
    : `Fjern «${plan.title}»`;
  const ariaEdit = isTravel
    ? `Rediger reise med ${TRANSIT_LABEL[plan.mode]}`
    : `Rediger «${plan.title}»`;

  return (
    <li
      className={
        "plan-item" +
        (isTravel ? " plan-item--travel" : "") +
        (dropActive ? " plan-item--drop-before" : "") +
        (editing ? " plan-item--editing" : "")
      }
      draggable={!editing}
      onDragStart={(e) => onDragStart(e, plan.id)}
      onDragOver={(e) => {
        if (editing) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        if (editing) return;
        e.preventDefault();
        e.stopPropagation();
        setDropActive(false);
        const draggedId =
          e.dataTransfer.getData(DRAG_MIME) ||
          e.dataTransfer.getData("text/plain");
        if (draggedId) onDropBefore(draggedId, plan.id);
      }}
    >
      <span className="plan-item-grip" aria-hidden="true">⋮⋮</span>
      {editing ? (
        plan.kind === "plan" ? (
          <TextField
            label="Rediger forslag"
            size="small"
            hideLabel
            autoFocus
            value={draftTitle}
            onChange={(e) =>
              setDraftTitle(e.target.value.replace(/->/g, "→"))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
          />
        ) : (
          <div className="plan-item-edit-travel">
            <Select
              label="Transportmiddel"
              size="small"
              hideLabel
              value={draftMode}
              onChange={(e) => setDraftMode(e.target.value as TransitMode)}
            >
              {TRANSIT_MODES.map((m) => (
                <option key={m} value={m}>
                  {TRANSIT_EMOJI[m]} {TRANSIT_LABEL[m]}
                </option>
              ))}
            </Select>
            <TextField
              label="Notat"
              size="small"
              hideLabel
              placeholder="Notat"
              value={draftNote}
              onChange={(e) =>
                setDraftNote(e.target.value.replace(/->/g, "→"))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
            />
          </div>
        )
      ) : (
        <span className="plan-item-title" title={itemTitle}>{label}</span>
      )}
      {editing ? (
        <>
          <button
            type="button"
            className="plan-item-action plan-item-save"
            onClick={saveEdit}
            title="Lagre"
            aria-label="Lagre"
          >
            <CheckmarkIcon aria-hidden />
          </button>
          <button
            type="button"
            className="plan-item-action plan-item-cancel"
            onClick={cancelEdit}
            title="Avbryt"
            aria-label="Avbryt"
          >
            <XMarkIcon aria-hidden />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="plan-item-action plan-item-edit"
            onClick={startEdit}
            title="Rediger"
            aria-label={ariaEdit}
          >
            <PencilIcon aria-hidden />
          </button>
          <button
            type="button"
            className="plan-item-remove"
            onClick={() => onRemove(plan.id)}
            title="Fjern"
            aria-label={ariaRemove}
          >
            <TrashIcon aria-hidden />
          </button>
        </>
      )}
    </li>
  );
}
