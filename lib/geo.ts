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

export function projectOntoRoute(
  fixLat: number,
  fixLon: number,
  route: RoutePoint[]
): FixResult {
  if (route.length < 2) {
    throw new Error('Route must have at least 2 points');
  }

  // Equirectangular degrees-to-meters scale at the mean latitude
  const midLat = (route[0].lat + route[route.length - 1].lat) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(midLat * Math.PI / 180);

  let bestDist = Infinity;
  let bestResult: FixResult | null = null;

  for (let i = 0; i < route.length - 1; i++) {
    const A = route[i];
    const B = route[i + 1];

    // Segment vector in meters
    const ax = (fixLon - A.lon) * metersPerDegLon;
    const ay = (fixLat - A.lat) * metersPerDegLat;
    const bx = (B.lon - A.lon) * metersPerDegLon;
    const by = (B.lat - A.lat) * metersPerDegLat;

    const segLenSq = bx * bx + by * by;
    let t = segLenSq > 0 ? (ax * bx + ay * by) / segLenSq : 0;
    t = Math.max(0, Math.min(1, t));

    // Projected point offset from fix
    const px = ax - t * bx;
    const py = ay - t * by;
    const offsetMeters = Math.sqrt(px * px + py * py);

    if (offsetMeters < bestDist) {
      bestDist = offsetMeters;
      const segmentLength = Math.sqrt(segLenSq);
      const distanceAlong = A.dist + t * segmentLength;
      const projLat = A.lat + t * (B.lat - A.lat);
      const projLon = A.lon + t * (B.lon - A.lon);
      bestResult = {
        distanceAlong,
        offsetMeters,
        lat: projLat,
        lon: projLon,
        segmentIndex: i,
      };
    }
  }

  return bestResult!;
}
