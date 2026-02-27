import { NextResponse } from "next/server";
import { computeRacingWeather } from "@/lib/weatherCalc";

// WeatherLink v2 current endpoint:
// https://api.weatherlink.com/v2/current/{station-id}?api-key=...
async function fetchWeatherLinkCurrent() {
  const apiKey = process.env.WEATHERLINK_API_KEY;
  const apiSecret = process.env.WEATHERLINK_API_SECRET;
  const stationId = process.env.WEATHERLINK_STATION_ID;

  if (!apiKey || !apiSecret || !stationId) {
    throw new Error("Missing WEATHERLINK env vars. Check .env.local");
  }

  const url = `https://api.weatherlink.com/v2/current/${stationId}?api-key=${apiKey}`;
  const res = await fetch(url, {
    headers: { "X-Api-Secret": apiSecret },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`WeatherLink HTTP ${res.status}: ${txt}`);
  }

  return res.json();
}

/**
 * Scan all sensors/data records and return the first finite numeric value
 * for the requested field key (e.g. "uv_index").
 */
function firstNumberFromSensors(payload: any, field: string): number | null {
  const sensors: any[] = payload?.sensors ?? [];
  for (const s of sensors) {
    const dataArr: any[] = s?.data ?? [];
    for (const rec of dataArr) {
      const v = rec?.[field];
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Try to pull a "best" timestamp from WeatherLink payload (if present),
 * falling back to server time.
 *
 * WeatherLink commonly includes a unix timestamp like "ts" in records.
 */
function extractBestTimestampIso(payload: any): string {
  const sensors: any[] = payload?.sensors ?? [];

  let bestMs: number | null = null;

  for (const s of sensors) {
    for (const rec of s?.data ?? []) {
      // WeatherLink often uses unix seconds in "ts"
      const ts = rec?.ts;
      const n = typeof ts === "number" ? ts : Number(ts);
      if (Number.isFinite(n) && n > 0) {
        const ms = n < 10_000_000_000 ? n * 1000 : n; // seconds vs ms safeguard
        if (bestMs === null || ms > bestMs) bestMs = ms;
      }
    }
  }

  return bestMs ? new Date(bestMs).toISOString() : new Date().toISOString();
}

/**
 * Extract tempF, humidityPct, absPressureInHg (+ uvIndex) from WeatherLink v2 payload.
 * Different stations expose pressure differently (bar_absolute or abs_press).
 * We search all "conditions" records for known keys.
 */
function extractInputs(payload: any) {
  const sensors: any[] = payload?.sensors ?? [];

  let tempF: number | null = null;
  let humidityPct: number | null = null;
  let absPressureInHg: number | null = null;

  // 1) Absolute pressure (barometer record)
  for (const s of sensors) {
    for (const rec of s?.data ?? []) {
      if (absPressureInHg === null && typeof rec?.bar_absolute === "number") {
        absPressureInHg = rec.bar_absolute;
      }
      if (absPressureInHg === null && typeof rec?.abs_press === "number") {
        absPressureInHg = rec.abs_press;
      }
    }
  }

  // 2) OUTDOOR temp/humidity only (sensor record with keys: temp, hum)
  for (const s of sensors) {
    for (const rec of s?.data ?? []) {
      if (tempF === null && typeof rec?.temp === "number") tempF = rec.temp;
      if (humidityPct === null && typeof rec?.hum === "number") humidityPct = rec.hum;
    }
  }

  // If WeatherLink is sending nulls (offseason), you'll land here:
  if (tempF === null || humidityPct === null) {
    throw new Error(
      "Outdoor sensor not reporting (temp/hum are missing or null). Turn on the outdoor ISS/transmitter to enable live racing calculations."
    );
  }

  if (absPressureInHg === null) {
    throw new Error("Could not find absolute pressure (bar_absolute/abs_press missing).");
  }

  // 3) UV index (optional; will be null if no UV sensor or not reporting)
  const uvIndex = firstNumberFromSensors(payload, "uv_index");

  return { tempF, humidityPct, absPressureInHg, uvIndex };
}

function roundTo(value: number, decimals: number) {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

export async function GET() {
  try {
    const payload = await fetchWeatherLinkCurrent();
    const inputs = extractInputs(payload);

    // Racing math stays the same (uses temp/hum/absPressure)
    const raw = computeRacingWeather({
      tempF: inputs.tempF,
      humidityPct: inputs.humidityPct,
      absPressureInHg: inputs.absPressureInHg,
    });

    const display = {
      // Better: use WeatherLink timestamp so your stale indicator reflects sensor freshness
      ts: new Date().toISOString(),

      tempF: raw.tempF,
      humidityPct: raw.humidityPct,
      absPressureInHg: raw.absPressureInHg,

      vaporPressureInHg: roundTo(raw.vaporPressureInHg, 3),
      dewPointF: roundTo(raw.dewPointF, 1),
      humidityGrains: roundTo(raw.humidityGrains, 1),

      // Keep your ADR/correction formatting decisions as-is (client now formats ADR to 2 decimals)
      adr: roundTo(raw.adrPct, 1),
      densityAltFt: Math.round(raw.densityAltFt),

      correction: Number(roundTo(raw.correction, 4).toFixed(4)),

      // ✅ NEW
      uvIndex: inputs.uvIndex,
    };

    return NextResponse.json({ inputs, display });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}