export function fmtKm(meters: number): string {
  return (meters / 1000).toFixed(2);
}

export function fmtKmSigned(meters: number): string {
  const km = meters / 1000;
  const sign = km >= 0 ? '+' : '';
  return `${sign}${km.toFixed(2)}`;
}

export function fmtKmh(ms: number): string {
  return (ms * 3.6).toFixed(1);
}

export function fmtKmhSigned(ms: number): string {
  const kmh = ms * 3.6;
  const sign = kmh >= 0 ? '+' : '';
  return `${sign}${kmh.toFixed(1)}`;
}

export function fmtHMM(seconds: number): string {
  const totalSec = Math.max(0, Math.round(seconds));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${h}:${mm}:${ss}`;
}

export function fmtMMSS(seconds: number): string {
  const totalSec = Math.max(0, Math.round(seconds));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  return `${m}:${ss}`;
}

export function fmtClock(timestampMs: number): string {
  const d = new Date(timestampMs);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function fmtETA(
  distanceAlong: number,
  avgSpeedMs: number,
  totalDistanceM: number,
  now: number
): string {
  if (avgSpeedMs <= 0) return '--:--';
  const remainingM = totalDistanceM - distanceAlong;
  const etaMs = now + (remainingM / avgSpeedMs) * 1000;
  return fmtClock(etaMs);
}
