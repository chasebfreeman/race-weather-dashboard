//page
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ApiResult = {
  inputs: {
    tempF: number;
    humidityPct: number;
    absPressureInHg: number;
  };
  display: {
    ts: string;

    tempF: number;
    humidityPct: number;
    absPressureInHg: number;

    vaporPressureInHg: number;
    dewPointF: number;
    humidityGrains: number;

    adr: number;
    adr2: number;
    densityAltFt: number;
    uvIndex: number | null;
    correction: number;
  };
};

const WEATHER_FIELDS = {
  tempF: { label: "Temperature (°F)", decimals: 1 },
  humidityPct: { label: "Humidity (%)", decimals: 2 },
  absPressureInHg: { label: "Absolute pressure (inHg)", decimals: 3 },
  correction: { label: "Correction factor", decimals: 4 },
  densityAltFt: { label: "Density altitude (ft)", decimals: 0 },
  adr: { label: "ADR (%)", decimals: 2 },
  humidityGrains: { label: "Humidity grains", decimals: 1 },
  vaporPressureInHg: { label: "Vapor pressure (inHg)", decimals: 4 },
  adr2: { label: "ADR2 correction", decimals: 4 },
  uvIndex: { label: "UV index", decimals: undefined },
  dewPointF: { label: "Dew point (°F)", decimals: 1 },
} satisfies Record<
  Exclude<keyof ApiResult["display"], "ts">,
  { label: string; decimals: number | undefined }
>;

function formatReadingValue(key: string, value: unknown) {
  if (key === "ts") return formatTs12Hour(value as string);
  const field = WEATHER_FIELDS[key as keyof typeof WEATHER_FIELDS];
  return fmt(value, field?.decimals);
}

function fmt(value: unknown, decimals?: number) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "—";
    return decimals !== undefined ? value.toFixed(decimals) : String(value);
  }
  return String(value);
}

/* =========================
   History persistence
========================= */
const HISTORY_KEY = "racewx_history_v1";
const HISTORY_MAX = 2000;

function loadHistoryFromStorage(): ApiResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x?.display?.ts);
  } catch {
    return [];
  }
}

function saveHistoryToStorage(history: ApiResult[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

/* =========================
   Time helpers for staleness + display
========================= */
function parseTsToMs(ts: string): number | null {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatTs12Hour(ts: string | null | undefined): string {
  if (!ts) return "—";

  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;

  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",

    hour12: true,
  });
}

/* =========================
   CSV export helpers
========================= */
function toYMDLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [history, setHistory] = useState<ApiResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedReading, setSelectedReading] = useState<ApiResult | null>(null);

  // for staleness ticking (updates the badge every second)
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  /* hydrate history on load */
  useEffect(() => {
    const existing = loadHistoryFromStorage();
    if (existing.length) setHistory(existing);
  }, []);

  // tick every 1s so "age" updates live
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function fetchLive() {
    try {
      setError(null);
      const res = await fetch("/api/live", { cache: "no-store" });
      const json = (await res.json()) as ApiResult | { error: string };

      if (!res.ok) {
        throw new Error((json as any)?.error ?? `Request failed (${res.status})`);
      }

      const ok = json as ApiResult;
      setData(ok);

      setHistory((prev) => {
        if (prev[0]?.display?.ts === ok.display.ts) return prev;
        const next = [ok, ...prev].slice(0, HISTORY_MAX);
        saveHistoryToStorage(next);
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load live weather.");
    }
  }

  useEffect(() => {
    fetchLive();
    const id = setInterval(fetchLive, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =========================
     COLUMN ORDER (LOCKED)
  ========================= */
  const columns = useMemo(() => {
    const sample = data?.display ?? history[0]?.display;
    if (!sample) return [];

    const pinnedOrder: (keyof ApiResult["display"])[] = [
      "ts",
      "tempF",
      "humidityPct",
      "absPressureInHg",
      "correction",
      "densityAltFt",
      "adr",
      "humidityGrains",
      "vaporPressureInHg",
      "adr2",
      "uvIndex",
    ];

    const remaining = Object.keys(sample)
      .filter((k) => !pinnedOrder.includes(k as any))
      .sort();

    return [...pinnedOrder, ...remaining].map((k) => ({ key: k, label: k }));
  }, [data, history]);

  /* =========================
     Stale indicator
  ========================= */
  const lastTs = data?.display?.ts ?? history[0]?.display?.ts ?? null;
  const lastMs = lastTs ? parseTsToMs(lastTs) : null;
  const ageSec = lastMs ? (nowMs - lastMs) / 1000 : Infinity;

  const staleState = (() => {
    if (!lastTs || !Number.isFinite(ageSec)) return "OFFLINE" as const;
    if (ageSec <= 90) return "LIVE" as const;
    if (ageSec <= 180) return "STALE" as const;
    return "OFFLINE" as const;
  })();

  const staleBadge = (() => {
    let bg = "#e5e7eb";
    let border = "#d1d5db";
    let fg = "#111827";
    let text = "Offline";

    if (staleState === "LIVE") {
      bg = "#dcfce7";
      border = "#22c55e";
      fg = "#065f46";
      text = "Live";
    } else if (staleState === "STALE") {
      bg = "#fef9c3";
      border = "#eab308";
      fg = "#854d0e";
      text = "Stale";
    } else {
      bg = "#fee2e2";
      border = "#ef4444";
      fg = "#991b1b";
      text = "Offline";
    }

    return { bg, border, fg, text };
  })();

  function exportTodayCsv() {
    const todayYMD = toYMDLocal(new Date());

    const todays = history.filter((r) => {
      const ms = Date.parse(r.display.ts);
      if (!Number.isFinite(ms)) return false;
      return toYMDLocal(new Date(ms)) === todayYMD;
    });

    if (todays.length === 0) {
      alert("No readings for today yet.");
      return;
    }

    const keys = columns.map((c) => c.key);
    const header = keys.map(csvEscape).join(",");
    const lines = todays.map((r) =>
      keys.map((k) => csvEscape((r.display as any)[k])).join(",")
    );

    const csv = [header, ...lines].join("\n");
    downloadTextFile(`EliteTrackWeather_${todayYMD}.csv`, csv);
  }

  return (
    <main style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ marginBottom: 12 }}>Race Weather</h1>

        {/* Stale indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px",
            borderRadius: 10,
            border: `1px solid ${staleBadge.border}`,
            background: staleBadge.bg,
            color: staleBadge.fg,
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
          title={lastTs ? `Last ts: ${lastTs}` : "No timestamp yet"}
        >
          <strong>{staleBadge.text}</strong>
          <span style={{ opacity: 0.85 }}>
            Last: {lastTs ?? "—"} · Age:{" "}
            {Number.isFinite(ageSec) ? formatAge(ageSec) : "—"}
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: "#fee2e2",
            border: "1px solid #ef4444",
            color: "#991b1b",
            padding: 12,
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* ---- Tiles ---- */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <Tile label="Temp (F)" value={data ? fmt(data.display.tempF, 1) : "—"} />
        <Tile label="Correction" value={data ? fmt(data.display.correction, 5) : "—"} />
        <Tile label="Vapor P (inHg)" value={data ? fmt(data.display.vaporPressureInHg, 4) : "—"} />          
        <Tile label="Dew Pt (F)" value={data ? fmt(data.display.dewPointF, 1) : "—"} />
        <Tile label="Timestamp" value={data ? formatTs12Hour(data.display.ts) : "—"} /> 
        <Tile label="Humidity (%)" value={data ? fmt(data.display.humidityPct, 1) : "—"} />
        <Tile label="ADR" value={data ? fmt(data.display.adr, 2) : "—"} />
        <Tile label="Grains" value={data ? fmt(data.display.humidityGrains, 1) : "—"} />
        <Tile label="DA (ft)" value={data ? fmt(data.display.densityAltFt, 0) : "—"} />                
        <Tile label="UV Index" value={data ? fmt(data.display.uvIndex, 1) : "—"} />
        <Tile label="Abs Press (inHg)" value={data ? fmt(data.display.absPressureInHg, 3) : "—"} />
        <Tile label="ADR2 Correction" value={data ? fmt(data.display.adr2, ) : "—"} />

      </section>

      {/* ---- History table ---- */}
      <section style={{ marginTop: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ margin: 0 }}>Previous readings</h2>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              {history.length} stored
            </div>

            <button
              onClick={exportTodayCsv}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "6px 10px",
                background: "white",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Export Today CSV
            </button>

            <button
              onClick={() => {
                setHistory([]);
                localStorage.removeItem(HISTORY_KEY);
              }}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "6px 10px",
                background: "white",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Clear history
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            overflow: "auto",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 980,
            }}
          >
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={{
                      position: "sticky",
                      top: 0,
                      background: "white",
                      textAlign: "left",
                      fontSize: 12,
                      padding: "10px 12px",
                      borderBottom: "1px solid #e5e7eb",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.key === "ts"
                      ? "Date & Time Stamp"
                      : c.key === "tempF"
                      ? "Temp"
                      : c.key === "humidityPct"
                      ? "Humidity"
                      : c.key === "absPressureInHg"
                      ? "Pressure"
                      : c.key === "correction"
                      ? "Correction Factor"
                      : c.key === "adr"
                      ? "ADR"
                      : c.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(columns.length, 1)}
                    style={{ padding: 12, opacity: 0.7 }}
                  >
                    No readings yet.
                  </td>
                </tr>
              ) : (
                history.map((r) => (
                  <tr
                    key={r.display.ts}
                    style={{ borderBottom: "1px solid #f3f4f6" }}
                  >
                    {columns.map((c) => {
                      const key = c.key as keyof ApiResult["display"];
                      const value = r.display?.[key];

                      const out = formatReadingValue(c.key, value);

                      return (
                        <td
                          key={c.key}
                          style={{
                            padding: "10px 12px",
                            whiteSpace: c.key === "ts" ? "nowrap" : "normal",
                          }}
                        >
                          {c.key === "ts" ? (
                            <button
                              type="button"
                              className="reading-time-button"
                              aria-haspopup="dialog"
                              aria-label={`View weather for ${out}`}
                              onClick={() => setSelectedReading(r)}
                            >
                              {out}
                            </button>
                          ) : (
                            out
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedReading && (
        <WeatherReadingDialog
          reading={selectedReading}
          onClose={() => setSelectedReading(null)}
        />
      )}
    </main>
  );
}

function WeatherReadingDialog({
  reading,
  onClose,
}: {
  reading: ApiResult;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="weather-reading-dialog"
      aria-labelledby="weather-reading-title"
      aria-describedby="weather-reading-time"
      onClose={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          event.currentTarget.close();
        }
      }}
    >
      <header className="weather-reading-header">
        <div>
          <h2 id="weather-reading-title">Weather reading</h2>
          <p id="weather-reading-time">{formatTs12Hour(reading.display.ts)}</p>
        </div>
        <form method="dialog">
          <button type="submit" className="weather-reading-close">
            Close
          </button>
        </form>
      </header>

      <dl className="weather-reading-grid">
        {Object.entries(WEATHER_FIELDS).map(([key, field]) => (
          <div className="weather-reading-value" key={key}>
            <dt>{field.label}</dt>
            <dd>
              {formatReadingValue(
                key,
                reading.display[key as keyof ApiResult["display"]]
              )}
            </dd>
          </div>
        ))}
        {Object.entries(reading.display)
          .filter(([key]) => key !== "ts" && !(key in WEATHER_FIELDS))
          .map(([key, value]) => (
            <div className="weather-reading-value" key={key}>
              <dt>{key}</dt>
              <dd>{fmt(value)}</dd>
            </div>
          ))}
      </dl>
    </dialog>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 650, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}
