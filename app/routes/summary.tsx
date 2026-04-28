import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Alert,
  BodyShort,
  Button,
  Heading,
  HStack,
  Loader,
  Tag,
} from "@navikt/ds-react";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ExternalLinkIcon,
  HouseIcon,
  PencilIcon,
} from "@navikt/aksel-icons";
import {
  type Plan,
  TRANSIT_EMOJI,
  TRANSIT_LABEL,
  type TripState,
  addDays,
  colorFor,
  defaultState,
  fmtShort,
  loadState,
} from "../lib/trip";
import { flagForLocation } from "../lib/japan";

export function meta() {
  return [{ title: "Oppsummering — Japan-reiseplanlegger" }];
}

export default function SummaryPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<TripState>(defaultState());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const persisted = await loadState();
      if (cancelled) return;
      if (persisted) setState(persisted);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const l of state.locations) {
      out.push(acc);
      acc += l.days;
    }
    return out;
  }, [state.locations]);

  const returnDate = addDays(state.arrival, state.totalDays);

  const totals = useMemo(() => {
    let plansCount = 0;
    let travelCount = 0;
    for (const l of state.locations) {
      for (const p of l.plans ?? []) {
        if (p.kind === "travel") travelCount += 1;
        else plansCount += 1;
      }
    }
    return { plansCount, travelCount };
  }, [state.locations]);

  if (!hydrated) {
    return (
      <div className="trip-wrap summary-wrap">
        <Loader title="Laster …" />
      </div>
    );
  }

  return (
    <div className="trip-wrap summary-wrap">
      <div className="summary-toolbar">
        <Button
          variant="secondary"
          size="small"
          icon={<ArrowLeftIcon aria-hidden />}
          onClick={() => navigate("/")}
        >
          Tilbake
        </Button>
      </div>

      <header className="summary-hero">
        <div className="summary-hero-text">
          <Heading size="xlarge" level="1">
            🗾 Japan-reiseplan
          </Heading>
          <BodyShort size="medium" textColor="subtle">
            {fmtShort(state.arrival)} – {fmtShort(returnDate)}
          </BodyShort>
        </div>
        <div className="summary-hero-stats">
          <Stat label="Netter" value={state.totalDays} />
          <Stat label="Steder" value={state.locations.length} />
          <Stat label="Aktiviteter" value={totals.plansCount} />
          <Stat label="Reiser" value={totals.travelCount} />
        </div>
      </header>

      {state.locations.length === 0 ? (
        <Alert variant="info">Ingen steder lagt til enda.</Alert>
      ) : (
        <div className="summary-list">
          {state.locations.map((loc, i) => {
            const checkIn = addDays(state.arrival, offsets[i]);
            const checkOut = addDays(state.arrival, offsets[i] + loc.days);
            const flag = flagForLocation(loc.name, 32);
            const plans = loc.plans ?? [];
            const suggestions = plans.filter((p) => p.day === null);
            const days = Array.from({ length: loc.days }, (_, k) => k + 1);
            const accent = colorFor(i);
            return (
              <article
                key={loc.id}
                className="summary-loc"
                style={{ ["--accent" as string]: accent }}
              >
                <header className="summary-loc-head">
                  {flag ? (
                    <img
                      src={flag}
                      alt=""
                      className="summary-loc-flag"
                      width={32}
                      height={24}
                    />
                  ) : null}
                  <div className="summary-loc-titles">
                    <Heading size="medium" level="2" className="summary-loc-name">
                      {loc.name}
                    </Heading>
                    <HStack gap="space-8" align="center" wrap>
                      <Tag size="small" variant="neutral-moderate">
                        <CalendarIcon aria-hidden />{" "}
                        {fmtShort(checkIn)} – {fmtShort(checkOut)}
                      </Tag>
                      <Tag size="small" variant="info-moderate">
                        {loc.days} {loc.days === 1 ? "natt" : "netter"}
                      </Tag>
                      {loc.plansWarning ? (
                        <Tag size="small" variant="warning-moderate">
                          Trenger oppdatering
                        </Tag>
                      ) : null}
                    </HStack>
                  </div>
                  <div className="summary-loc-actions">
                    <Button
                      variant="tertiary"
                      size="small"
                      icon={<PencilIcon aria-hidden />}
                      onClick={() => navigate(`/plan/${loc.id}`)}
                      aria-label={`Planlegg ${loc.name || "stedet"}`}
                    >
                      <span className="summary-action-label">Planlegg</span>
                    </Button>
                  </div>
                </header>

                {(loc.hotel || loc.url) && (
                  <div className="summary-hotel">
                    <HouseIcon aria-hidden className="summary-hotel-icon" />
                    {loc.hotel ? (
                      <span className="summary-hotel-name">{loc.hotel}</span>
                    ) : (
                      <span className="summary-hotel-empty">
                        Ikke valgt enda
                      </span>
                    )}
                    {loc.url ? (
                      <a
                        href={loc.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="summary-hotel-link"
                      >
                        Bookinglenke
                        <ExternalLinkIcon aria-hidden />
                      </a>
                    ) : null}
                  </div>
                )}

                {loc.days > 0 ? (
                  <div className="summary-days">
                    {days.map((d) => {
                      const date = addDays(state.arrival, offsets[i] + d - 1);
                      const dayPlans = plans.filter((p) => p.day === d);
                      return (
                        <div key={d} className="summary-day">
                          <div className="summary-day-head">
                            <span className="summary-day-num">Dag {d}</span>
                            <span className="summary-day-date">
                              {fmtShort(date)}
                            </span>
                          </div>
                          {dayPlans.length === 0 ? (
                            <BodyShort size="small" textColor="subtle">
                              Ingen plan
                            </BodyShort>
                          ) : (
                            <ul className="summary-plan-list">
                              {dayPlans.map((p) => (
                                <PlanRow key={p.id} plan={p} />
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {suggestions.length > 0 ? (
                  <div className="summary-suggestions">
                    <BodyShort size="small" weight="semibold" textColor="subtle">
                      Forslag · ikke planlagt
                    </BodyShort>
                    <ul className="summary-plan-list">
                      {suggestions.map((p) => (
                        <PlanRow key={p.id} plan={p} />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-stat">
      <span className="summary-stat-value">{value}</span>
      <span className="summary-stat-label">{label}</span>
    </div>
  );
}

function PlanRow({ plan }: { plan: Plan }) {
  if (plan.kind === "travel") {
    return (
      <li
        className="summary-plan summary-plan--travel"
        title={TRANSIT_LABEL[plan.mode]}
      >
        <span className="summary-plan-icon" aria-hidden>
          {TRANSIT_EMOJI[plan.mode]}
        </span>
        <span className="summary-plan-text">
          <span className="summary-plan-mode">{TRANSIT_LABEL[plan.mode]}</span>
          {plan.note ? (
            <span className="summary-plan-note">{plan.note}</span>
          ) : null}
        </span>
      </li>
    );
  }
  return (
    <li className="summary-plan">
      <span className="summary-plan-bullet" aria-hidden>
        •
      </span>
      <span className="summary-plan-text">{plan.title}</span>
    </li>
  );
}
