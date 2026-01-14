import { NextResponse } from "next/server";

async function fetchStations() {
  const apiKey = process.env.WEATHERLINK_API_KEY;
  const apiSecret = process.env.WEATHERLINK_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("Missing WEATHERLINK_API_KEY or WEATHERLINK_API_SECRET in .env.local");
  }

  const url = `https://api.weatherlink.com/v2/stations?api-key=${apiKey}`;
  const res = await fetch(url, {
    headers: { "X-Api-Secret": apiSecret },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Stations HTTP ${res.status}: ${txt}`);
  }

  return res.json();
}

export async function GET() {
  try {
    const payload = await fetchStations();

    // Return only the helpful bits
    const stations = (payload?.stations ?? []).map((s: any) => ({
      station_name: s.station_name,
      station_id: s.station_id,               // <— THIS is what you need
      station_id_uuid: s.station_id_uuid,     // <— also acceptable for /current
    }));

    return NextResponse.json({ stations });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
