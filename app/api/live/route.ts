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
    headers: {
      "X-Api-Secret": apiSecret,
    },
    // keep it fresh while developing
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`WeatherLink HTTP ${res.status}: ${txt}`);
  }

  return res.json();
}

/**
 * Extract tempF, humidityPct, absPressureInHg from WeatherLink v2 payload.
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
    throw new Error(
      "Could not find absolute pressure (bar_absolute/abs_press missing)."
    );
  }

  return { tempF, humidityPct, absPressureInHg };
}


function roundTo(value: number, decimals: number) {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

export async function GET() {
  try {
    const payload = await fetchWeatherLinkCurrent();
    const inputs = extractInputs(payload);

    const raw = computeRacingWeather(inputs);

    // return EXACTLY the rounding you requested
    const display = {
      ts: new Date().toISOString(),

      tempF: raw.tempF,
      humidityPct: raw.humidityPct,
      absPressureInHg: raw.absPressureInHg,

      vaporPressureInHg: roundTo(raw.vaporPressureInHg, 3),
      dewPointF: roundTo(raw.dewPointF, 1),
      humidityGrains: roundTo(raw.humidityGrains, 1),

      adr: roundTo(raw.adrPct, 1),
      densityAltFt: Math.round(raw.densityAltFt),

      correction: Number(roundTo(raw.correction, 4).toFixed(4)),
    };

    return NextResponse.json({ inputs, display });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
