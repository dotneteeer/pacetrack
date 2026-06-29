import { RoutePoint, Schedule } from '../types';

const GRADE_ANCHORS: [number, number][] = [
  [-0.15, 1.5], [-0.08, 1.5], [-0.04, 1.4], [-0.02, 1.2],
  [0.00, 1.0],  [0.02, 0.78], [0.04, 0.60], [0.06, 0.47],
  [0.08, 0.37], [0.10, 0.30], [0.15, 0.20],
];

export function gradeSpeedFactor(grade: number): number {
  const g = Math.max(-0.25, Math.min(0.25, grade));

  if (g <= GRADE_ANCHORS[0][0]) return GRADE_ANCHORS[0][1];
  if (g >= GRADE_ANCHORS[GRADE_ANCHORS.length - 1][0]) return GRADE_ANCHORS[GRADE_ANCHORS.length - 1][1];

  for (let i = 0; i < GRADE_ANCHORS.length - 1; i++) {
    const [g0, f0] = GRADE_ANCHORS[i];
    const [g1, f1] = GRADE_ANCHORS[i + 1];
    if (g >= g0 && g <= g1) {
      const t = (g - g0) / (g1 - g0);
      return f0 + t * (f1 - f0);
    }
  }

  return 1.0; // fallback
}

function smoothElevation(points: RoutePoint[], window: number): number[] {
  const eles = points.map(p => p.ele);
  const smoothed: number[] = [];
  const half = Math.floor(window / 2);
  for (let i = 0; i < eles.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(eles.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += eles[j];
    smoothed.push(sum / (hi - lo + 1));
  }
  return smoothed;
}

export function buildSchedule(route: RoutePoint[], targetSeconds: number): Schedule {
  if (route.length < 2) throw new Error('Route must have at least 2 points');

  const smoothedEle = smoothElevation(route, 5);

  const rawCosts: number[] = [0]; // index 0: cost to reach point 0 = 0
  let totalRaw = 0;

  for (let i = 1; i < route.length; i++) {
    const Li = route[i].dist - route[i - 1].dist;
    const dEle = smoothedEle[i] - smoothedEle[i - 1];
    const grade = Li > 0 ? dEle / Li : 0;
    const f = gradeSpeedFactor(grade);
    const raw = Li > 0 ? Li / f : 0;
    rawCosts.push(raw);
    totalRaw += raw;
  }

  const scale = totalRaw > 0 ? targetSeconds / totalRaw : 0;

  // T_i = scale * cumulative raw cost up to point i
  const times: number[] = [];
  let cumRaw = 0;
  for (let i = 0; i < route.length; i++) {
    cumRaw += rawCosts[i];
    times.push(scale * cumRaw);
  }

  return { times, rawCosts, scale, totalRaw };
}

export function expectedAtTime(
  elapsedSeconds: number,
  route: RoutePoint[],
  schedule: Schedule
): { distanceAlong: number; lat: number; lon: number; segmentIndex: number; expectedSpeedMs: number } {
  const { times, scale } = schedule;
  const n = times.length;

  if (n === 0) {
    return { distanceAlong: 0, lat: route[0]?.lat ?? 0, lon: route[0]?.lon ?? 0, segmentIndex: 0, expectedSpeedMs: 0 };
  }

  if (elapsedSeconds <= 0) {
    const grade = route.length >= 2 ? computeGrade(route, 0) : 0;
    const expectedSpeedMs = scale > 0 ? gradeSpeedFactor(grade) / scale : 0;
    return { distanceAlong: route[0].dist, lat: route[0].lat, lon: route[0].lon, segmentIndex: 0, expectedSpeedMs };
  }

  if (elapsedSeconds >= times[n - 1]) {
    const last = route[n - 1];
    const grade = route.length >= 2 ? computeGrade(route, n - 2) : 0;
    const expectedSpeedMs = scale > 0 ? gradeSpeedFactor(grade) / scale : 0;
    return { distanceAlong: last.dist, lat: last.lat, lon: last.lon, segmentIndex: n - 2, expectedSpeedMs };
  }

  // Binary search for bracket
  let lo = 0, hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= elapsedSeconds) lo = mid; else hi = mid;
  }

  const t0 = times[lo], t1 = times[hi];
  const frac = t1 > t0 ? (elapsedSeconds - t0) / (t1 - t0) : 0;

  const A = route[lo], B = route[hi];
  const distanceAlong = A.dist + frac * (B.dist - A.dist);
  const lat = A.lat + frac * (B.lat - A.lat);
  const lon = A.lon + frac * (B.lon - A.lon);

  const grade = computeGrade(route, lo);
  const expectedSpeedMs = scale > 0 ? gradeSpeedFactor(grade) / scale : 0;

  return { distanceAlong, lat, lon, segmentIndex: lo, expectedSpeedMs };
}

function computeGrade(route: RoutePoint[], segmentIndex: number): number {
  const i = Math.max(0, Math.min(segmentIndex, route.length - 2));
  const dDist = route[i + 1].dist - route[i].dist;
  const dEle = route[i + 1].ele - route[i].ele;
  return dDist > 0 ? dEle / dDist : 0;
}

export function speedDeltaKmh(
  distanceAlong: number,
  elapsedSeconds: number,
  targetSeconds: number,
  route: RoutePoint[],
  schedule: Schedule
): number {
  const remainingTime = targetSeconds - elapsedSeconds;
  if (remainingTime <= 0) return 0;

  // Find the first route point past distanceAlong
  let firstAhead = route.findIndex(p => p.dist > distanceAlong);
  if (firstAhead === -1) return 0; // past the end
  if (firstAhead === 0) firstAhead = 1;

  // Sum rawCosts for remaining segments (from firstAhead onward)
  let remainingRaw = 0;
  for (let i = firstAhead; i < schedule.rawCosts.length; i++) {
    remainingRaw += schedule.rawCosts[i];
  }

  if (remainingRaw <= 0) return 0;

  const scalePrime = remainingTime / remainingRaw;

  // Grade at current position
  const segIdx = Math.max(0, firstAhead - 1);
  const grade = computeGrade(route, segIdx);
  const f = gradeSpeedFactor(grade);

  // speed = f / scale (m/s); delta = f/scalePrime - f/scale (m/s) → km/h
  const delta = f * (1 / scalePrime - 1 / schedule.scale) * 3.6;
  return delta;
}
