import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  BodyShort,
  Button,
  CopyButton,
  DatePicker,
  HStack,
  Heading,
  Loader,
  TextField,
  ToggleGroup,
  useDatepicker,
} from "@navikt/ds-react";
import {
  BulletListIcon,
  CalendarIcon,
  ComponentIcon,
  ExclamationmarkTriangleIcon,
  ExternalLinkIcon,
  PadlockLockedIcon,
  PadlockUnlockedIcon,
} from "@navikt/aksel-icons";
import {
  type TripState,
  addDays,
  applyDaysChange,
  colorFor,
  daysBetween,
  defaultState,
  fmtShort,
  loadState,
  newId,
  parseISO,
  reconcile,
  saveState,
  subscribeTrip,
  toISO,
} from "../lib/trip";
import { getClientId } from "../lib/identity";
import { flagForLocation, prefectureNameFor } from "../lib/japan";
import { getCachedImages, setCachedImages } from "../lib/imageCache";
import { urlToDataUrl } from "../lib/imageData";
import { SegmentedSlider } from "./SegmentedSlider";

function ArrivalPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  const { datepickerProps, inputProps } = useDatepicker({
    defaultSelected: parseISO(value),
    onDateChange: (d) => {
      if (d) onChange(toISO(d));
    },
  });
  return (
    <DatePicker {...datepickerProps} locale="nb">
      <DatePicker.Input {...inputProps} label="Ankomst" size="small" />
    </DatePicker>
  );
}

function ReturnPicker({
  arrival,
  totalDays,
  onChange,
}: {
  arrival: string;
  totalDays: number;
  onChange: (iso: string) => void;
}) {
  const returnISO = addDays(arrival, totalDays);
  const { datepickerProps, inputProps } = useDatepicker({
    defaultSelected: parseISO(returnISO),
    fromDate: parseISO(addDays(arrival, 1)),
    onDateChange: (d) => {
      if (d) onChange(toISO(d));
    },
  });
  return (
    <DatePicker {...datepickerProps} locale="nb">
      <DatePicker.Input {...inputProps} label="Hjemreise" size="small" />
    </DatePicker>
  );
}

type ViewMode = "cards" | "rows";

// 1x1 transparent GIF used as the src for the always-rendered <img> when no
// real image is set. Keeping the element mounted (just hidden) avoids React
// reconciliation errors triggered by adding/removing it during fast typing.
const EMPTY_IMG =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function LocationRow({
  loc,
  index,
  checkIn,
  checkOut,
  view,
  onChange,
  onRemove,
  onToggleLock,
  onPlan,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDragTarget,
}: {
  loc: { id: string; name: string; hotel: string; days: number; url?: string; imageUrl?: string; locked?: boolean; plansWarning?: boolean };
  index: number;
  checkIn: string;
  checkOut: string;
  view: ViewMode;
  onChange: (patch: Partial<{ name: string; hotel: string; url: string; imageUrl: string }>) => void;
  onRemove: () => void;
  onToggleLock: () => void;
  onPlan: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragTarget: boolean;
}) {
  const locked = !!loc.locked;
  const flag = flagForLocation(loc.name, 64);
  const prefName = prefectureNameFor(loc.name);
  const [draggable, setDraggable] = useState(false);

  // Debounced og:image + og:title fetch when URL changes; falls back to image search.
  const lastFetched = useRef<string | null>(null);
  const [loadingImg, setLoadingImg] = useState(false);
  // Image-search candidates for the manual ‹/› buttons; key = the search query used.
  const imgCandidatesRef = useRef<{ key: string; images: string[]; index: number }>({
    key: "",
    images: [],
    index: 0,
  });
  useEffect(() => {
    const url = (loc.url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      if (loc.imageUrl) onChange({ imageUrl: "" });
      lastFetched.current = url || null;
      return;
    }
    if (lastFetched.current === url) return;

    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoadingImg(true);
      try {
        const res = await fetch(`/og?url=${encodeURIComponent(url)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { image: string | null; title: string | null };
        lastFetched.current = url;

        // Auto-fill hotel name if it's empty and og:title returned something useful
        const patch: Partial<{ hotel: string; imageUrl: string }> = {};
        if (!loc.hotel.trim() && data.title) {
          patch.hotel = data.title.slice(0, 120);
        }

        let image = data.image || "";
        if (!image) {
          // Fall back to image search using hotel name (typed or from og:title) + location
          const hotelQ = (loc.hotel.trim() || data.title || "").slice(0, 100);
          if (hotelQ) {
            const q = `${hotelQ} ${loc.name} hotel`;

            // Try persistent cache first to avoid re-hitting DuckDuckGo.
            const cached = getCachedImages(q);
            if (cached && cached.length) {
              imgCandidatesRef.current = { key: q, images: cached, index: 0 };
              image = cached[0];
            } else {
              try {
                const sRes = await fetch(`/img-search?q=${encodeURIComponent(q)}`, {
                  signal: ctrl.signal,
                });
                if (sRes.ok) {
                  const sData = (await sRes.json()) as { image: string | null; images?: string[] };
                  if (sData.images && sData.images.length) {
                    imgCandidatesRef.current = { key: q, images: sData.images, index: 0 };
                    setCachedImages(q, sData.images);
                  }
                  if (sData.image) image = sData.image;
                }
              } catch {
                /* ignored */
              }
            }
          }
        }
        if (image) {
          const dataUrl = await urlToDataUrl(image);
          if (ctrl.signal.aborted) return;
          patch.imageUrl = dataUrl || image;
        } else {
          patch.imageUrl = "";
        }
        onChange(patch);
      } catch {
        /* ignored */
      } finally {
        if (!ctrl.signal.aborted) setLoadingImg(false);
      }
    }, 700);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.url]);

  // Move forward (+1) or backward (-1) through cached image-search candidates.
  // Fetches the candidates if the cache is empty or the query has changed.
  const cycleImage = async (direction: 1 | -1) => {
    const q = `${loc.hotel.trim()} ${loc.name} hotel`;
    if (!q.trim()) return;
    const cache = imgCandidatesRef.current;

    const applyAt = async (images: string[], idx: number) => {
      const remote = images[idx];
      if (!remote) return;
      setLoadingImg(true);
      try {
        const dataUrl = await urlToDataUrl(remote);
        onChange({ imageUrl: dataUrl || remote });
      } finally {
        setLoadingImg(false);
      }
    };

    // 1. In-memory hit for the same query → instant navigation.
    if (cache.key === q && cache.images.length > 0) {
      const len = cache.images.length;
      const nextIdx = (cache.index + direction + len) % len;
      cache.index = nextIdx;
      await applyAt(cache.images, nextIdx);
      return;
    }

    // 2. Persistent (localStorage) cache hit → load into memory, no network.
    const cached = getCachedImages(q);
    if (cached && cached.length > 0) {
      const startIdx = direction === -1 ? cached.length - 1 : 0;
      imgCandidatesRef.current = { key: q, images: cached, index: startIdx };
      await applyAt(cached, startIdx);
      return;
    }

    // 3. Cache miss → hit DuckDuckGo, then persist for next time.
    setLoadingImg(true);
    try {
      const res = await fetch(`/img-search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { image: string | null; images?: string[] };
      const images = data.images ?? (data.image ? [data.image] : []);
      if (images.length === 0) return;
      setCachedImages(q, images);

      const startIdx = direction === -1 ? images.length - 1 : 0;
      imgCandidatesRef.current = { key: q, images, index: startIdx };
      const dataUrl = await urlToDataUrl(images[startIdx]);
      onChange({ imageUrl: dataUrl || images[startIdx] });
    } catch {
      /* ignored */
    } finally {
      setLoadingImg(false);
    }
  };

  // Shared subcomponents used by both card and row layouts.
  // Use a single span whose appearance is driven by inline style — never
  // swap element types on name change, which can race with concurrent input
  // updates and cause React reconciliation errors (insertBefore/removeChild).
  const flagEl = (
    <span
      className="trip-flag-wrap"
      style={{
        borderColor: colorFor(index),
        backgroundColor: flag ? "var(--trip-card-bg)" : colorFor(index),
        backgroundImage: flag ? `url(${flag})` : "none",
      }}
      role="img"
      aria-label={prefName ? `Flagg: ${prefName}` : ""}
      title={prefName ? `${prefName} prefektur` : undefined}
    />
  );

  const dragHandle = (
    <button
      type="button"
      className="trip-drag-handle"
      aria-label="Dra for å endre rekkefølge"
      title="Dra for å endre rekkefølge"
      onMouseDown={() => setDraggable(true)}
      onMouseUp={() => setDraggable(false)}
      onTouchStart={() => setDraggable(true)}
      onTouchEnd={() => setDraggable(false)}
    >
      ⋮⋮
    </button>
  );

  // Stable structure: render the same set of children every time, toggling
  // visibility/state via attributes and CSS classes. Never swap element types
  // or add/remove children based on user input — that's what triggers React
  // 19's "removeChild/insertBefore" reconciliation errors during fast typing.
  const hasImg = !!loc.imageUrl && !loadingImg;
  const showPlaceholder = !loadingImg && !loc.imageUrl && view === "cards";
  const showNav = !loadingImg && !!loc.hotel.trim();
  const imageEl = (
    <div className={"trip-hotel-img" + (view === "cards" ? " trip-hotel-img--card" : "")}>
      <div className="trip-img-loader" hidden={!loadingImg}>
        <Loader size="small" title="Henter bilde" />
      </div>
      <img
        className="trip-img-photo"
        src={loc.imageUrl || EMPTY_IMG}
        alt={hasImg ? loc.hotel || "Hotellbilde" : ""}
        hidden={!hasImg}
      />
      <a
        className="trip-img-link"
        href={loc.url || undefined}
        target="_blank"
        rel="noreferrer"
        aria-label={loc.url ? "Åpne booking" : undefined}
        hidden={!hasImg || !loc.url}
      />
      <span className="trip-img-placeholder" hidden={!showPlaceholder}>
        Ingen bilde
      </span>
      <div className="trip-img-nav" hidden={!showNav}>
        <button
          type="button"
          className="trip-img-nav-btn"
          onClick={() => cycleImage(-1)}
          title="Forrige bilde"
          aria-label="Forrige bilde"
          tabIndex={showNav ? 0 : -1}
        >
          ‹
        </button>
        <button
          type="button"
          className="trip-img-nav-btn"
          onClick={() => cycleImage(1)}
          title="Neste bilde"
          aria-label="Neste bilde"
          tabIndex={showNav ? 0 : -1}
        >
          ›
        </button>
      </div>
    </div>
  );

  const wrapperProps = {
    draggable,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd: () => {
      setDraggable(false);
      onDragEnd();
    },
  };

  const lockBtn = (
    <Button
      variant="tertiary"
      size="small"
      onClick={onToggleLock}
      icon={
        locked ? <PadlockLockedIcon aria-hidden /> : <PadlockUnlockedIcon aria-hidden />
      }
      title={locked ? "Lås opp" : "Lås"}
      aria-label={locked ? "Lås opp sted" : "Lås sted"}
      aria-pressed={locked}
      data-color={locked ? "warning" : undefined}
    />
  );

  const planBtn = (
    <Button
      onClick={onPlan}
      variant={loc.plansWarning ? "primary" : "tertiary"}
      size="xsmall"
      icon={
        loc.plansWarning ? (
          <ExclamationmarkTriangleIcon aria-hidden />
        ) : (
          <CalendarIcon aria-hidden />
        )
      }
      data-color={loc.plansWarning ? "warning" : undefined}
      title={loc.plansWarning ? "Endringer flyttet planer til Forslag" : "Planlegg dager"}
    >
      Planlegg
    </Button>
  );

  const urlField = (showLabel: boolean) => {
    const url = (loc.url || "").trim();
    return (
      <div className="trip-url-field">
        <TextField
          label="Bookinglenke"
          size="small"
          hideLabel={!showLabel}
          type="url"
          value={loc.url || ""}
          placeholder="https://..."
          disabled={locked}
          onChange={(e) => onChange({ url: e.target.value })}
        />
        <CopyButton
          size="small"
          copyText={url}
          title="Kopier lenke"
          activeText="Kopiert!"
          disabled={!url}
        />
        <Button
          as="a"
          variant="tertiary-neutral"
          size="small"
          icon={<ExternalLinkIcon aria-hidden />}
          href={url || undefined}
          target="_blank"
          rel="noreferrer"
          title="Åpne i ny fane"
          aria-label="Åpne lenke i ny fane"
          disabled={!url}
        />
      </div>
    );
  };

  if (view === "rows") {
    return (
      <div
        className={
          "trip-loc-row" +
          (isDragging ? " trip-loc-row--dragging" : "") +
          (isDragTarget ? " trip-loc-row--drop-target" : "") +
          (locked ? " trip-loc-row--locked" : "")
        }
        {...wrapperProps}
      >
        {dragHandle}
        {flagEl}
        <TextField
          label="Sted"
          size="small"
          hideLabel
          value={loc.name}
          disabled={locked}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <TextField
          label="Hotell"
          size="small"
          hideLabel
          value={loc.hotel}
          placeholder="Hotellnavn"
          disabled={locked}
          onChange={(e) => onChange({ hotel: e.target.value })}
        />
        {urlField(false)}
        {imageEl}
        <div className="trip-date-range">
          {fmtShort(checkIn)} → {fmtShort(checkOut)}
        </div>
        <div className="trip-days-pill">
          {loc.days} {loc.days === 1 ? "natt" : "netter"}
        </div>
        {planBtn}
        {lockBtn}
        <Button variant="tertiary" size="small" onClick={onRemove} title="Fjern" aria-label="Fjern sted" disabled={locked}>
          ✕
        </Button>
      </div>
    );
  }

  return (
    <div
      className={
        "trip-loc-card" +
        (isDragging ? " trip-loc-card--dragging" : "") +
        (isDragTarget ? " trip-loc-card--drop-target" : "") +
        (locked ? " trip-loc-card--locked" : "")
      }
      {...wrapperProps}
    >
      <div className="trip-loc-card-head">
        {dragHandle}
        {flagEl}
        <div className="trip-loc-card-title">
          <TextField
            label="Sted"
            size="small"
            hideLabel
            value={loc.name}
            disabled={locked}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="trip-days-pill">
          {loc.days} {loc.days === 1 ? "natt" : "netter"}
        </div>
        {lockBtn}
        <Button
          variant="tertiary"
          size="small"
          onClick={onRemove}
          title="Fjern"
          aria-label="Fjern sted"
          disabled={locked}
        >
          ✕
        </Button>
      </div>

      <div className="trip-loc-card-body">
        {imageEl}
        <div className="trip-loc-card-fields">
          <TextField
            label="Hotell"
            size="small"
            value={loc.hotel}
            placeholder="Hotellnavn"
            disabled={locked}
            onChange={(e) => onChange({ hotel: e.target.value })}
          />
          {urlField(true)}
        </div>
      </div>

      <div className="trip-loc-card-foot">
        <span className="trip-loc-card-foot-label">Datoer</span>
        <span className="trip-date-range">
          {fmtShort(checkIn)} → {fmtShort(checkOut)}
        </span>
        <span className="trip-loc-card-foot-spacer" />
        {planBtn}
      </div>
    </div>
  );
}

export function TripPlanner() {
  const navigate = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<TripState>(() => defaultState());
  const [view, setView] = useState<ViewMode>("cards");
  // Lightweight live-sync notification ("Reisen ble oppdatert"). Auto-hides.
  const [remoteToast, setRemoteToast] = useState<string | null>(null);

  // Load from Firestore (via /api/trip) after mount (client-only)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadState();
      if (cancelled) return;
      if (loaded) setState(loaded);
      try {
        const v = window.localStorage.getItem("tripView:v1");
        if (v === "rows" || v === "cards") setView(v);
      } catch {
        /* ignored */
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // True when the most recent setState came from a remote SSE update — we
  // must NOT re-persist that change (would echo back to the writer and ping-pong forever).
  const skipNextSaveRef = useRef(false);

  // Persist on change (debounced; only after hydration so we don't overwrite stored data)
  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void saveState(state);
    }, 400);
    return () => window.clearTimeout(t);
  }, [state, hydrated]);

  // Subscribe to live updates from Firestore. We ignore echoes of our own
  // writes by comparing clientId. Only attach after hydration so the initial
  // load wins over any racing snapshot.
  useEffect(() => {
    if (!hydrated) return;
    const myId = getClientId();
    // The very first snapshot fires immediately on subscribe and reflects the
    // doc we just loaded — suppress its toast.
    let initial = true;
    const unsubscribe = subscribeTrip((nextState, info) => {
      if (info.fromClientId && info.fromClientId === myId) {
        initial = false;
        return;
      }
      skipNextSaveRef.current = true;
      setState(nextState);
      if (!initial) {
        const who = info.userEmail ? info.userEmail : "noen andre";
        setRemoteToast(`Reisen ble oppdatert av ${who}`);
      }
      initial = false;
    });
    return () => unsubscribe();
  }, [hydrated]);

  // Auto-dismiss the live-sync toast.
  useEffect(() => {
    if (!remoteToast) return;
    const t = window.setTimeout(() => setRemoteToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [remoteToast]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem("tripView:v1", view);
    } catch {
      /* ignored */
    }
  }, [view, hydrated]);

  const setArrival = (iso: string) =>
    setState((s) => ({ ...s, arrival: iso }));

  const setReturn = (iso: string) =>
    setState((s) => {
      const diff = daysBetween(s.arrival, iso);
      if (diff < 1) return s;
      return reconcile({ ...s, totalDays: diff });
    });

  const setTotalDays = (n: number) =>
    setState((s) => reconcile({ ...s, totalDays: Math.max(1, n) }));

  const updateLoc = (i: number, patch: Partial<{ name: string; hotel: string; url: string; imageUrl: string }>) =>
    setState((s) => ({
      ...s,
      locations: s.locations.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    }));

  const removeLoc = (i: number) =>
    setState((s) => {
      const removed = s.locations[i];
      if (removed && (removed.plans?.length ?? 0) > 0) {
        const ok =
          typeof window !== "undefined" &&
          window.confirm(
            `«${removed.name || "Stedet"}» har ${removed.plans!.length} plan(er). Vil du virkelig slette stedet og alle planene?`,
          );
        if (!ok) return s;
      }
      const rest = s.locations.filter((_, j) => j !== i);
      if (rest.length && removed && removed.days > 0) {
        rest[0] = applyDaysChange(rest[0], rest[0].days + removed.days);
      }
      return reconcile({ ...s, locations: rest });
    });

  const moveLoc = (from: number, to: number) =>
    setState((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.locations.length || to >= s.locations.length) {
        return s;
      }
      const locs = s.locations.slice();
      const [moved] = locs.splice(from, 1);
      locs.splice(to, 0, moved);
      return { ...s, locations: locs };
    });

  const toggleLock = (i: number) =>
    setState((s) => ({
      ...s,
      locations: s.locations.map((l, j) => (j === i ? { ...l, locked: !l.locked } : l)),
    }));

  // Drag-and-drop state for reordering location cards.
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const addLoc = () =>
    setState((s) => {
      const locs = s.locations.map((l) => ({ ...l }));
      let totalDays = s.totalDays;
      let days = 1;
      if (locs.length === 0) {
        days = totalDays;
      } else {
        let maxI = 0;
        for (let j = 1; j < locs.length; j++)
          if (locs[j].days > locs[maxI].days) maxI = j;
        if (locs[maxI].days > 1) {
          locs[maxI] = { ...locs[maxI], days: locs[maxI].days - 1 };
        } else {
          totalDays += 1;
        }
      }
      locs.push({ id: newId(), name: "Nytt sted", hotel: "", days });
      return reconcile({ ...s, totalDays, locations: locs });
    });

  const setBoundary = useCallback(
    (boundaryIdx: number, newLeftDays: number) => {
      setState((s) => {
        const locs = s.locations.map((l) => ({ ...l }));
        const left = locs[boundaryIdx];
        const right = locs[boundaryIdx + 1];
        if (!left || !right) return s;
        if (left.locked || right.locked) return s;
        const combined = left.days + right.days;
        const nl = Math.max(1, Math.min(combined - 1, newLeftDays));
        if (nl === left.days) return s;
        locs[boundaryIdx] = applyDaysChange(left, nl);
        locs[boundaryIdx + 1] = applyDaysChange(right, combined - nl);
        return { ...s, locations: locs };
      });
    },
    []
  );

  const distributeEvenly = () =>
    setState((s) => {
      const n = s.locations.length;
      if (n === 0) return s;
      const base = Math.floor(s.totalDays / n);
      let rem = s.totalDays - base * n;
      return {
        ...s,
        locations: s.locations.map((l) => {
          const d = base + (rem-- > 0 ? 1 : 0);
          return applyDaysChange(l, d);
        }),
      };
    });

  const offsets = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    state.locations.forEach((l) => {
      arr.push(acc);
      acc += l.days;
    });
    return arr;
  }, [state.locations]);

  const allocated = state.locations.reduce((a, l) => a + l.days, 0);

  return (
    <div className="trip-wrap">
      {remoteToast ? (
        <div className="live-toast" role="status" aria-live="polite">
          {remoteToast}
        </div>
      ) : null}
      <div>
        <Heading size="large" level="1">
          🗾 Japan-reiseplanlegger
        </Heading>
        <BodyShort textColor="subtle">
          Dra i delelinjene for å fordele dager mellom stedene.
        </BodyShort>
      </div>

      <div className="trip-card">
        <div className="trip-toolbar">
          <ArrivalPicker
            key={"arr-" + state.arrival}
            value={state.arrival}
            onChange={setArrival}
          />
          <ReturnPicker
            key={"ret-" + state.arrival + "-" + state.totalDays}
            arrival={state.arrival}
            totalDays={state.totalDays}
            onChange={setReturn}
          />
          <TextField
            label="Antall netter"
            size="small"
            type="number"
            min={1}
            value={state.totalDays}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v >= 1) setTotalDays(v);
            }}
            style={{ width: 110 }}
          />
          <div className="trip-toolbar-spacer" />
          <Button
            variant="tertiary"
            size="small"
            onClick={() => navigate("/oppsummering")}
          >
            Oppsummering
          </Button>
          <Button variant="secondary" size="small" onClick={distributeEvenly}>
            Fordel jevnt
          </Button>
        </div>

        <SegmentedSlider
          state={state}
          onBoundaryChange={setBoundary}
          onMoveLocation={moveLoc}
        />
      </div>

      <div className="trip-card">
        <HStack justify="space-between" align="center">
          <Heading size="small" level="2">
            Steder
          </Heading>
          <ToggleGroup
            size="small"
            value={view}
            onChange={(v) => setView(v === "rows" ? "rows" : "cards")}
            aria-label="Visning"
          >
            <ToggleGroup.Item value="cards" aria-label="Kortvisning" icon={<ComponentIcon aria-hidden />} />
            <ToggleGroup.Item value="rows" aria-label="Listevisning" icon={<BulletListIcon aria-hidden />} />
          </ToggleGroup>
        </HStack>

        <div className={view === "cards" ? "trip-loc-cards" : "trip-loc-rows"}>
          {view === "rows" ? (
            <div className="trip-loc-row trip-loc-row-header" aria-hidden="true">
              <span />
              <span />
              <span>Sted</span>
              <span>Hotell</span>
              <span>Bookinglenke</span>
              <span>Bilde</span>
              <span>Datoer</span>
              <span>Netter</span>
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {state.locations.map((loc, i) => (
            <LocationRow
              key={loc.id}
              loc={loc}
              index={i}
              view={view}
              checkIn={addDays(state.arrival, offsets[i])}
              checkOut={addDays(state.arrival, offsets[i] + loc.days)}
              onChange={(patch) => updateLoc(i, patch)}
              onRemove={() => removeLoc(i)}
              onToggleLock={() => toggleLock(i)}
              onPlan={() => navigate(`/plan/${loc.id}`)}
              isDragging={dragSrc === i}
              isDragTarget={dragOver === i && dragSrc !== null && dragSrc !== i}
              onDragStart={(e) => {
                setDragSrc(i);
                e.dataTransfer.effectAllowed = "move";
                // Firefox needs some data set to start the drag.
                try { e.dataTransfer.setData("text/plain", String(i)); } catch {}
              }}
              onDragOver={(e) => {
                if (dragSrc === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOver !== i) setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragSrc !== null && dragSrc !== i) moveLoc(dragSrc, i);
                setDragSrc(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragSrc(null);
                setDragOver(null);
              }}
            />
          ))}
        </div>

        <BodyShort textColor="subtle" spacing>
          Fordelt: <b>{allocated}</b> / <b>{state.totalDays}</b> netter
        </BodyShort>
      </div>

      <button
        type="button"
        className="trip-fab"
        onClick={addLoc}
        title="Legg til sted"
        aria-label="Legg til sted"
      >
        +
      </button>
    </div>
  );
}
