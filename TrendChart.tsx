"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/* =========================
   Trend graph: Temp, UV, Correction Factor, ADR

   Readings come from the shared server history (see lib/weatherHistory.ts).
   One point is plotted per 5-minute clock slot (:00, :05, :10 ...), so the
   graph gains a new point every 5 minutes. Each metric gets its own panel
   because their scales are too different to share a y-axis.
========================= */

export type TrendReading = {
  ts: string;
  tempF: number | null;
  uvIndex: number | null;
  correction: number | null;
  adr: number | null;
};

type MetricKey = "tempF" | "uvIndex" | "correction" | "adr";

type TrendPoint = { t: number } & Record<MetricKey, number | null>;

const METRICS: {
  key: MetricKey;
  label: string;
  decimals: number;
  minSpan: number; // smallest y-range shown, so sensor noise doesn't look like a swing
}[] = [
  { key: "tempF", label: "Temp (°F)", decimals: 1, minSpan: 2 },
  { key: "uvIndex", label: "UV Index", decimals: 1, minSpan: 1 },
  { key: "correction", label: "Corr Fac", decimals: 4, minSpan: 0.004 },
  { key: "adr", label: "ADR", decimals: 2, minSpan: 0.2 },
];

const RANGES = [
  { label: "1h", hours: 1 },
  { label: "3h", hours: 3 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
];

const SLOT_MS = 5 * 60_000;
const GAP_MS = 2.5 * SLOT_MS; // a longer hole than this breaks the line
const MIN_WINDOW_MS = 30 * 60_000;

const PANEL_HEAD = 26;
const PANEL_PLOT = 84;
const PANEL_GAP = 14;
const PANEL_H = PANEL_HEAD + PANEL_PLOT + PANEL_GAP;
const AXIS_H = 22;
const LEFT = 52;
const RIGHT = 14;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Keep the first reading of each 5-minute clock slot, oldest first. */
export function toFiveMinutePoints(readings: TrendReading[]): TrendPoint[] {
  const bySlot = new Map<number, TrendPoint>();
  for (const r of readings) {
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t)) continue;
    const slot = Math.floor(t / SLOT_MS);
    const existing = bySlot.get(slot);
    if (existing && existing.t <= t) continue;
    bySlot.set(slot, {
      t,
      tempF: num(r.tempF),
      uvIndex: num(r.uvIndex),
      correction: num(r.correction),
      adr: num(r.adr),
    });
  }
  return [...bySlot.values()].sort((a, b) => a.t - b.t);
}

function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function yScaleFor(values: number[], minSpan: number) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;

  const step = niceStep((hi - lo) / 3);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    ticks.push(v);
  }
  const tickDecimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  return { lo, hi, ticks, tickDecimals };
}

const TIME_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 360];

function timeTicks(t0: number, t1: number, maxTicks: number): number[] {
  const spanMin = (t1 - t0) / 60_000;
  const stepMin =
    TIME_STEPS_MIN.find((s) => spanMin / s <= maxTicks) ??
    TIME_STEPS_MIN[TIME_STEPS_MIN.length - 1];
  const stepMs = stepMin * 60_000;

  // Anchor to local midnight so labels land on round clock times.
  const anchor = new Date(t0);
  anchor.setHours(0, 0, 0, 0);
  const a = anchor.getTime();

  const ticks: number[] = [];
  for (let t = a + Math.ceil((t0 - a) / stepMs) * stepMs; t <= t1; t += stepMs) {
    ticks.push(t);
  }
  return ticks;
}

function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function TrendChart({ readings }: { readings: TrendReading[] }) {
  const [hours, setHours] = useState(6);
  const [width, setWidth] = useState(0);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allPoints = useMemo(() => toFiveMinutePoints(readings), [readings]);

  const latestT = allPoints.length ? allPoints[allPoints.length - 1].t : null;

  const points = useMemo(() => {
    if (latestT === null) return [];
    const cutoff = latestT - hours * 3_600_000;
    return allPoints.filter((p) => p.t >= cutoff);
  }, [allPoints, latestT, hours]);

  const hasTrend = points.length >= 2;
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const svgH = METRICS.length * PANEL_H + AXIS_H;

  // x domain: from the first point in range to the newest, never tighter than 30 min
  const t1 = latestT ?? 0;
  const t0 = points.length ? Math.min(points[0].t, t1 - MIN_WINDOW_MS) : t1 - MIN_WINDOW_MS;
  const x = (t: number) => LEFT + ((t - t0) / (t1 - t0)) * plotW;

  const hovered = useMemo(() => {
    if (hoverT === null || !points.length) return null;
    let best = points[0];
    for (const p of points) {
      if (Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) best = p;
    }
    return best;
  }, [hoverT, points]);

  const shown = hovered ?? (points.length ? points[points.length - 1] : null);

  function onPointer(e: ReactPointerEvent<SVGSVGElement>) {
    if (!hasTrend || plotW <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left - LEFT) / plotW;
    setHoverT(t0 + Math.min(1, Math.max(0, frac)) * (t1 - t0));
  }

  const xTicks = hasTrend && plotW > 0 ? timeTicks(t0, t1, Math.max(2, Math.floor(plotW / 90))) : [];

  return (
    <section className="trend" aria-labelledby="trend-title">
      <div className="trend-head">
        <h2 id="trend-title">Trend</h2>

        <div className="trend-controls">
          <span className="trend-readout" aria-live="off">
            {shown
              ? `${hovered ? "At" : "Latest point"} ${fmtClock(shown.t)}`
              : "Waiting for readings"}
          </span>

          <div className="trend-ranges" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                type="button"
                className="trend-range"
                aria-pressed={hours === r.hours}
                onClick={() => setHours(r.hours)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={wrapRef} className="trend-body">
        {width > 0 && (
          <svg
            width={width}
            height={svgH}
            role="img"
            aria-label="Trend of temperature, UV index, correction factor and ADR, one point every 5 minutes. The same readings are listed in the Previous readings table."
            style={{ display: "block", touchAction: "pan-y" }}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHoverT(null)}
          >
            {METRICS.map((m, i) => {
              const top = i * PANEL_H;
              const plotTop = top + PANEL_HEAD;
              const plotBottom = plotTop + PANEL_PLOT;

              const vals = points
                .map((p) => p[m.key])
                .filter((v): v is number => v !== null);
              const scale = vals.length ? yScaleFor(vals, m.minSpan) : null;
              const y = (v: number) =>
                scale
                  ? plotBottom - ((v - scale.lo) / (scale.hi - scale.lo)) * PANEL_PLOT
                  : plotBottom;

              // Split into runs so missing data shows as a break, not a bridge.
              const runs: { t: number; v: number }[][] = [];
              let run: { t: number; v: number }[] = [];
              let prevT: number | null = null;
              for (const p of points) {
                const v = p[m.key];
                if (v === null || (prevT !== null && p.t - prevT > GAP_MS)) {
                  if (run.length) runs.push(run);
                  run = [];
                }
                if (v !== null) run.push({ t: p.t, v });
                prevT = p.t;
              }
              if (run.length) runs.push(run);

              const shownV = shown ? shown[m.key] : null;
              const last = runs.length ? runs[runs.length - 1] : null;
              const lastPt = last ? last[last.length - 1] : null;

              return (
                <g key={m.key}>
                  <text x={LEFT} y={top + 16} className="trend-label">
                    {m.label}
                  </text>
                  <text x={LEFT + plotW} y={top + 16} textAnchor="end" className="trend-value">
                    {shownV !== null ? shownV.toFixed(m.decimals) : "—"}
                  </text>

                  {scale ? (
                    scale.ticks.map((tv) => (
                      <g key={tv}>
                        <line
                          x1={LEFT}
                          x2={LEFT + plotW}
                          y1={y(tv)}
                          y2={y(tv)}
                          className="trend-grid"
                        />
                        <text x={LEFT - 8} y={y(tv) + 4} textAnchor="end" className="trend-tick">
                          {tv.toFixed(scale.tickDecimals)}
                        </text>
                      </g>
                    ))
                  ) : (
                    <>
                      <line
                        x1={LEFT}
                        x2={LEFT + plotW}
                        y1={plotBottom}
                        y2={plotBottom}
                        className="trend-grid"
                      />
                      <text
                        x={LEFT + plotW / 2}
                        y={plotTop + PANEL_PLOT / 2 + 4}
                        textAnchor="middle"
                        className="trend-tick"
                      >
                        {points.length
                          ? "No data in this range"
                          : "A point is added every 5 minutes"}
                      </text>
                    </>
                  )}

                  {runs.map((r) =>
                      r.length === 1 ? (
                        <circle
                          key={r[0].t}
                          cx={x(r[0].t)}
                          cy={y(r[0].v)}
                          r={2}
                          className="trend-dot"
                        />
                      ) : (
                        <polyline
                          key={r[0].t}
                          points={r.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}
                          className="trend-line"
                        />
                      )
                    )}

                  {lastPt && !hovered && (
                    <circle cx={x(lastPt.t)} cy={y(lastPt.v)} r={4} className="trend-marker" />
                  )}

                  {hasTrend && hovered && (
                    <>
                      <line
                        x1={x(hovered.t)}
                        x2={x(hovered.t)}
                        y1={plotTop}
                        y2={plotBottom}
                        className="trend-crosshair"
                      />
                      {shownV !== null && (
                        <circle
                          cx={x(hovered.t)}
                          cy={y(shownV)}
                          r={4}
                          className="trend-marker"
                        />
                      )}
                    </>
                  )}
                </g>
              );
            })}

            {xTicks.map((t) => {
              const px = x(t);
              const anchor =
                px < LEFT + 28 ? "start" : px > LEFT + plotW - 28 ? "end" : "middle";
              return (
                <text
                  key={t}
                  x={px}
                  y={METRICS.length * PANEL_H + 12}
                  textAnchor={anchor}
                  className="trend-tick"
                >
                  {fmtClock(t)}
                </text>
              );
            })}
          </svg>
        )}
      </div>

      {!hasTrend && (
        <p className="trend-note">
          A point is added every 5 minutes while the weather station is reporting.
        </p>
      )}
    </section>
  );
}
