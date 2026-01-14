import { NextResponse } from "next/server";

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

export async function GET() {
  try {
    const payload = await fetchWeatherLinkCurrent();

    // IMPORTANT: We don't want to dump a massive blob.
    // Return a compact view of what keys exist in each record.
    const sensors = payload?.sensors ?? [];
    const summary = sensors.map((s: any) => ({
      sensor_type: s.sensor_type,
      data_structure_type: s.data_structure_type,
      // each item in s.data is one "record" with keys we need to inspect
      record_keys: (s.data ?? []).slice(0, 2).map((rec: any) => Object.keys(rec).sort()),
      record_sample: (s.data ?? []).slice(0, 1), // first record only
    }));

    return NextResponse.json({ sensorCount: sensors.length, summary });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
