import { RoutePoint, FixResult } from '../types';

export function haversine(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function buildCumulativeDistances(points: RoutePoint[]): RoutePoint[] {
  let cumDist = 0;
  return points.map((pt, i) => {
    if (i > 0) {
      cumDist += haversine(points[i - 1], pt);
    }
    return { ...pt, dist: cumDist };
  });
}

/** Bearing from a to b in degrees 0–360 (0 = north, clockwise). */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δλ = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// Candidates within HINT_EPS metres of the global minimum are eligible for hint
// tie-breaking. On a loop route the start and finish segments can lie within GPS
// noise of each other; the hint (previous distanceAlong) disambiguates which end
// the rider is actually on.
const HINT_EPS = 20;

export function projectOntoRoute(
  fixLat: number,
  fixLon: number,
  route: RoutePoint[],
  hintDist?: number
): FixResult {
  if (route.length < 2) {
    throw new Error('Route must have at least 2 points');
  }

  // Equirectangular degrees-to-metres scale at the mean latitude
  const midLat = (route[0].lat + route[route.length - 1].lat) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(midLat * Math.PI / 180);

  const candidates: FixResult[] = [];
  let bestDist = Infinity;

  for (let i = 0; i < route.length - 1; i++) {
    const A = route[i];
    const B = route[i + 1];

    // Segment vector in metres
    const ax = (fixLon - A.lon) * metersPerDegLon;
    const ay = (fixLat - A.lat) * metersPerDegLat;
    const bx = (B.lon - A.lon) * metersPerDegLon;
    const by = (B.lat - A.lat) * metersPerDegLat;

    const segLenSq = bx * bx + by * by;
    let t = segLenSq > 0 ? (ax * bx + ay * by) / segLenSq : 0;
    t = Math.max(0, Math.min(1, t));

    const px = ax - t * bx;
    const py = ay - t * by;
    const offsetMeters = Math.sqrt(px * px + py * py);

    if (offsetMeters < bestDist) bestDist = offsetMeters;

    const segmentLength = Math.sqrt(segLenSq);
    candidates.push({
      distanceAlong: A.dist + t * segmentLength,
      offsetMeters,
      lat: A.lat + t * (B.lat - A.lat),
      lon: A.lon + t * (B.lon - A.lon),
      segmentIndex: i,
    });
  }

  // All candidates within HINT_EPS of global minimum
  const near = candidates.filter(c => c.offsetMeters <= bestDist + HINT_EPS);

  // With a hint, pick the candidate with distanceAlong closest to hint.
  // Without a hint, fall back to global nearest (original behaviour).
  if (hintDist !== undefined) {
    return near.reduce((a, b) =>
      Math.abs(a.distanceAlong - hintDist) <= Math.abs(b.distanceAlong - hintDist) ? a : b
    );
  }
  return near.reduce((a, b) => a.offsetMeters <= b.offsetMeters ? a : b);
}
