import { NextResponse } from "next/server";
import { computeRacingWeather } from "@/lib/weatherCalc";

export function GET() {
  const result = computeRacingWeather({
    tempF: 80,
    humidityPct: 50,
    absPressureInHg: 28.9,
  });

  return NextResponse.json({
    message: "Test calculation",
    result,
  });
}
