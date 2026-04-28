import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Popover, BodyShort } from "@navikt/ds-react";
import {
  type Plan,
  type TripState,
  TRANSIT_EMOJI,
  TRANSIT_LABEL,
  addDays,
  colorFor,
  fmtShort,
} from "../lib/trip";
import { flagForLocation } from "../lib/japan";

type Props = {
  state: TripState;
  onBoundaryChange: (boundaryIdx: number, newLeftDays: number) => void;
  onMoveLocation: (from: number, to: number) => void;
};

export function SegmentedSlider({ state, onBoundaryChange, onMoveLocation }: Props) {
  const navigate = useNavigate();
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const segRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragState = useRef<{ boundaryIdx: number; rect: DOMRect } | null>(null);
  // Timestamp of the last boundary-drag end. Used to swallow the synthesized
  // click iOS Safari fires on touchend so dragging a handle doesn't navigate
  // to whichever segment was under the finger when it lifted.
  const lastDragEnd = useRef(0);
  // Single controlled Popover for plan previews. Re-anchors to whichever segment
  // is currently hovered/focused. Keeps DOM stable and avoids N popovers fighting.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // HTML5 drag-and-drop reorder of locations directly on the slider.
  const [reorderSrc, setReorderSrc] = useState<number | null>(null);
  const [reorderOver, setReorderOver] = useState<number | null>(null);

  const total = state.totalDays;
  const locs = state.locations;

  useEffect(() => {
    const fit = () => {
      const segs = segRefs.current.filter(Boolean) as HTMLDivElement[];
      segs.forEach((seg, i) => {
        const loc = locs[i];
        if (!loc) return;
        const lbl = seg.querySelector(".lbl") as HTMLSpanElement | null;
        const flag = seg.querySelector(".seg-flag") as HTMLImageElement | null;
        if (!lbl) return;
        const segW = seg.clientWidth;

        // Hide the flag if the segment is too narrow to fit it comfortably
        if (flag) {
          flag.style.display = segW < 40 ? "none" : "";
        }
        const flagW = flag && flag.style.display !== "none" ? flag.offsetWidth + 6 : 0;

        const variants = [
          `${loc.name} · ${loc.days}d`,
          loc.name,
          `${loc.days}d`,
          "",
        ];
        for (const text of variants) {
          lbl.textContent = text;
          if (text === "" || lbl.scrollWidth + flagW + 4 <= segW) break;
        }
      });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [locs, total]);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const x = clientX - ds.rect.left;
      const pct = Math.max(0, Math.min(1, x / ds.rect.width));
      const targetDay = Math.round(pct * total);
      let before = 0;
      for (let j = 0; j < ds.boundaryIdx; j++) before += locs[j].days;
      const newLeft = targetDay - before;
      onBoundaryChange(ds.boundaryIdx, newLeft);
    };
    const onUp = () => {
      if (dragState.current) lastDragEnd.current = Date.now();
      dragState.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [locs, total, onBoundaryChange]);

  if (total <= 0 || locs.length === 0) {
    return <div className="trip-slider" ref={sliderRef} />;
  }

  const segments: React.ReactNode[] = [];
  let acc = 0;
  locs.forEach((loc, i) => {
    const startPct = (acc / total) * 100;
    const widthPct = (loc.days / total) * 100;
    const flag = flagForLocation(loc.name, 32);
    const hasName = !!loc.name.trim();
    const labelText = hasName ? `${loc.name} · ${loc.days}d` : "";
    segments.push(
      <div
        key={"seg-" + loc.id}
        ref={(el) => {
          segRefs.current[i] = el;
        }}
        className={
          "trip-seg" +
          (reorderSrc === i ? " trip-seg--dragging" : "") +
          (reorderOver === i && reorderSrc !== null && reorderSrc !== i
            ? " trip-seg--drop-target"
            : "")
        }
        title={`${loc.name || "(uten navn)"} · ${loc.days} ${loc.days === 1 ? "natt" : "netter"}${loc.hotel ? " · " + loc.hotel : ""}`}
        style={{
          left: startPct + "%",
          width: widthPct + "%",
          background: colorFor(i),
        }}
        draggable={!loc.locked}
        onDragStart={(e) => {
          if (loc.locked) {
            e.preventDefault();
            return;
          }
          setReorderSrc(i);
          setHoverIdx(null);
          e.dataTransfer.effectAllowed = "move";
          try {
            e.dataTransfer.setData("text/plain", String(i));
          } catch {
            /* ignored */
          }
        }}
        onDragOver={(e) => {
          if (reorderSrc === null) return;
          if (loc.locked) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (reorderOver !== i) setReorderOver(i);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (loc.locked) {
            setReorderSrc(null);
            setReorderOver(null);
            return;
          }
          if (reorderSrc !== null && reorderSrc !== i) onMoveLocation(reorderSrc, i);
          setReorderSrc(null);
          setReorderOver(null);
        }}
        onDragEnd={() => {
          setReorderSrc(null);
          setReorderOver(null);
        }}
        onMouseEnter={() => setHoverIdx(i)}
        onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
        onFocus={() => setHoverIdx(i)}
        onBlur={() => setHoverIdx((h) => (h === i ? null : h))}
        onClick={(e) => {
          // Swallow the synthesized click iOS fires after a boundary drag.
          if (dragState.current || Date.now() - lastDragEnd.current < 300) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          navigate(`/plan/${loc.id}`);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(`/plan/${loc.id}`);
          }
        }}
        role="link"
        aria-label={`Planlegg ${loc.name || "(uten navn)"}`}
        tabIndex={0}
      >
        <span
          className={"seg-flag" + (flag ? "" : " seg-flag--empty")}
          style={flag ? { backgroundImage: `url(${flag})` } : undefined}
          aria-hidden="true"
        />
        <span className="lbl">{labelText}</span>
      </div>
    );
    acc += loc.days;
    if (i < locs.length - 1) {
      const handlePct = (acc / total) * 100;
      const handleLocked = !!loc.locked || !!locs[i + 1].locked;
      const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
        if (handleLocked) return;
        e.preventDefault();
        if (!sliderRef.current) return;
        dragState.current = {
          boundaryIdx: i,
          rect: sliderRef.current.getBoundingClientRect(),
        };
      };
      segments.push(
        <div
          key={"h-" + i}
          className={"trip-handle" + (handleLocked ? " trip-handle--locked" : "")}
          style={{ left: handlePct + "%" }}
          onMouseDown={startDrag}
          onTouchStart={startDrag}
          aria-disabled={handleLocked || undefined}
          title={handleLocked ? "Låst" : undefined}
        />
      );
    }
  });

  const tickStep = total <= 14 ? 1 : total <= 30 ? 2 : Math.ceil(total / 15);
  const ticks: React.ReactNode[] = [];
  for (let d = 0; d <= total; d += tickStep) {
    ticks.push(
      <div
        key={d}
        className="trip-tick"
        style={{ left: (d / total) * 100 + "%" }}
      >
        {fmtShort(addDays(state.arrival, d))}
      </div>
    );
  }

  return (
    <>
      <div className="trip-slider" ref={sliderRef}>
        {segments}
      </div>
      <div className="trip-ticks">{ticks}</div>
      <PlanPopover
        loc={hoverIdx !== null ? locs[hoverIdx] : null}
        anchorEl={hoverIdx !== null ? segRefs.current[hoverIdx] ?? null : null}
        open={hoverIdx !== null && !!locs[hoverIdx]}
        onClose={() => setHoverIdx(null)}
      />
    </>
  );
}

function planLabel(p: Plan): string {
  if (p.kind === "travel") {
    return `${TRANSIT_EMOJI[p.mode]}${p.note ? " " + p.note : ""}`;
  }
  return p.title;
}

function PlanPopover({
  loc,
  anchorEl,
  open,
  onClose,
}: {
  loc: TripState["locations"][number] | null;
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!loc) return null;
  const plans = loc.plans ?? [];
  const suggestions = plans.filter((p) => p.day === null);
  const dayPlans: Record<number, typeof plans> = {};
  for (const p of plans) {
    if (p.day !== null) {
      (dayPlans[p.day] ||= []).push(p);
    }
  }
  const days = Array.from({ length: loc.days }, (_, i) => i + 1);
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorEl={anchorEl}
      placement="bottom"
      arrow
    >
      <Popover.Content className="seg-popover">
        <BodyShort weight="semibold" spacing>
          {loc.name || "(uten navn)"}
          {loc.hotel ? ` · ${loc.hotel}` : ""}
        </BodyShort>
        {plans.length === 0 ? (
          <BodyShort textColor="subtle" size="small">
            Ingen planer enda.
          </BodyShort>
        ) : (
          <div className="seg-popover-days">
            {days.map((d) => {
              const items = dayPlans[d] ?? [];
              return (
                <div key={d} className="seg-popover-day">
                  <BodyShort size="small" weight="semibold">Dag {d}</BodyShort>
                  {items.length === 0 ? (
                    <BodyShort size="small" textColor="subtle">—</BodyShort>
                  ) : (
                    <ul className="seg-popover-list">
                      {items.map((p) => (
                        <li
                          key={p.id}
                          title={p.kind === "travel" ? TRANSIT_LABEL[p.mode] : undefined}
                        >
                          {planLabel(p)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {suggestions.length > 0 ? (
              <div className="seg-popover-day seg-popover-day--sugg">
                <BodyShort size="small" weight="semibold">Forslag</BodyShort>
                <ul className="seg-popover-list">
                  {suggestions.map((p) => (
                    <li
                      key={p.id}
                      title={p.kind === "travel" ? TRANSIT_LABEL[p.mode] : undefined}
                    >
                      {planLabel(p)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Popover.Content>
    </Popover>
  );
}
