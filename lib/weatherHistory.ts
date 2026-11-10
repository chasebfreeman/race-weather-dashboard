/* =========================
   Shared weather history (Supabase)

   A scheduled job inside the "Race Weather" Supabase project saves the site's
   live reading once a minute into public.weather_readings. Every browser reads
   the same rows from there, so the graph and the readings table match on all
   devices and keep filling in while nobody has the page open.

   The key below is Supabase's publishable key. It is meant to be shipped to
   browsers: the table is read-only to it (row level security), and nothing can
   be written through it. Override with env vars if the project ever moves.
========================= */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://oqdwrselsrxhkwtxmtct.supabase.co";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "sb_publishable_DzKNMWeNNYdZEmDFt7wEhw_L7wLQ2Xl";

export const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type StoredReading = {
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

// Database column -> the field name the page already uses.
const SELECT = [
  "ts",
  "tempF:temp_f",
  "humidityPct:humidity_pct",
  "absPressureInHg:abs_pressure_inhg",
  "vaporPressureInHg:vapor_pressure_inhg",
  "dewPointF:dew_point_f",
  "humidityGrains:humidity_grains",
  "adr",
  "adr2",
  "densityAltFt:density_alt_ft",
  "correction",
  "uvIndex:uv_index",
].join(",");

const PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request

/**
 * Readings newer than `afterTs` (exclusive), newest first.
 * `afterTs` is any timestamp string Date/Postgres understands.
 */
export async function fetchReadingsAfter(afterTs: string): Promise<StoredReading[]> {
  const out: StoredReading[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url =
      `${SUPABASE_URL}/rest/v1/weather_readings` +
      `?select=${SELECT}` +
      `&ts=gt.${encodeURIComponent(afterTs)}` +
      `&order=ts.desc&limit=${PAGE_SIZE}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Shared history request failed (${res.status})`);
    }

    const rows = (await res.json()) as StoredReading[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return out;
}
