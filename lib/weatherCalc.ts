// ==============================
// Racing Weather Calculations
// ==============================

export type Inputs = {
  tempF: number;
  humidityPct: number;
  absPressureInHg: number;
};

export type RawOutput = {
  tempF: number;
  humidityPct: number;
  absPressureInHg: number;

  pdValue: number;
  vaporPressureInHg: number;

  dewPointF: number;
  humidityGrains: number;

  adrPct: number;
  densityAltFt: number;

  tf: number;
  hf: number;
  bf: number;
  correction: number;
};

// --- PD polynomial (from your Excel) ---
function pdValueInHg(tempF: number): number {
  return (
    0.000002923426 * Math.pow(tempF, 3) -
    0.0002235652 * Math.pow(tempF, 2) +
    0.01366344 * tempF -
    0.126149
  );
}

// --- Dew point by inversion ---
function dewPointFFromVaporPressure(eInHg: number): number {
  let lo = -60;
  let hi = 140;

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const pd = pdValueInHg(mid);
    if (pd > eInHg) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// --- Humidity grains ---
function humidityGrains(P: number, e: number): number {
  const w = 0.62199 * (e / (P - e));
  return 7000 * w;
}

function fToK(f: number): number {
  return (f - 32) * (5 / 9) + 273.15;
}

// --- ADR ---
const P_STD = 29.92;
const T_STD_F = 60;

function adrPercent(tempF: number, P: number, e: number): number {
  const T = fToK(tempF);
  const Tstd = fToK(T_STD_F);
  return ((P - e) / T) / (P_STD / Tstd) * 100;
}

// --- Density Altitude (calibrated to your sheet) ---
const DA_A = 0.9877786024779986;
const DA_B = 15.819058349071335;

function densityAltitudeFt(adrPct: number): number {
  const ratio = adrPct / 100;

  const T0 = 288.15;
  const L = 0.0065;
  const g = 9.80665;
  const R = 287.058;

  const exp = g / (R * L) - 1;
  const h_m = (T0 / L) * (1 - Math.pow(ratio, 1 / exp));
  return DA_A * (h_m * 3.28084) + DA_B;
}

// --- Standard Correction ---
function standardCorrection(tempF: number, P: number, e: number) {
  const tf = Math.pow((459.7 + tempF) / 519.7, 0.50317);
  const hf = P / (P - e);
  const bf = 29.92 / P;
  return { tf, hf, bf, correction: tf * hf * bf };
}

// ==============================
// Main compute function
// ==============================

export function computeRacingWeather(x: Inputs): RawOutput {
  const { tempF, humidityPct, absPressureInHg } = x;

  const pdValue = pdValueInHg(tempF);
  const vaporPressureInHg = pdValue * (humidityPct / 100);

  const dewPointF = dewPointFFromVaporPressure(vaporPressureInHg);
  const humidityGrainsVal = humidityGrains(absPressureInHg, vaporPressureInHg);

  const adrPct = adrPercent(tempF, absPressureInHg, vaporPressureInHg);
  const densityAltFt = densityAltitudeFt(adrPct);

  const { tf, hf, bf, correction } = standardCorrection(
    tempF,
    absPressureInHg,
    vaporPressureInHg
  );

  return {
    tempF,
    humidityPct,
    absPressureInHg,

    pdValue,
    vaporPressureInHg,

    dewPointF,
    humidityGrains: humidityGrainsVal,

    adrPct,
    densityAltFt,

    tf,
    hf,
    bf,
    correction,
  };
}
