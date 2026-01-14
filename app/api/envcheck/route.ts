import { NextResponse } from "next/server";

export function GET() {
  const key = process.env.WEATHERLINK_API_KEY ?? "";
  const secret = process.env.WEATHERLINK_API_SECRET ?? "";
  const station = process.env.WEATHERLINK_STATION_ID ?? "";

  return NextResponse.json({
    hasApiKey: key.length > 0,
    apiKeyLength: key.length,
    hasApiSecret: secret.length > 0,
    apiSecretLength: secret.length,
    hasStationId: station.length > 0,
    stationId: station || null, // station id is OK to show
  });
}
