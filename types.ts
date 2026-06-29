export interface RoutePoint {
  lat: number;
  lon: number;
  ele: number;
  dist: number; // cumulative distance from start in meters
}

export interface Schedule {
  times: number[];        // T_i: expected arrival time (seconds) at each RoutePoint
  rawCosts: number[];     // raw_i per segment (for remaining-route recalc)
  scale: number;          // s/m: targetSeconds / totalRaw
  totalRaw: number;       // Σ raw_i
  smoothedEles: number[]; // smoothed elevation per RoutePoint (matches buildSchedule smoothing)
}

export interface FixResult {
  distanceAlong: number; // meters from route start
  offsetMeters: number;  // perpendicular distance from route
  lat: number;
  lon: number;
  segmentIndex: number;  // which segment the projection landed on
}

export type SessionStatus = 'idle' | 'riding' | 'paused' | 'finished';

export interface Session {
  route: RoutePoint[];
  schedule: Schedule;
  targetSeconds: number;
  startTimestamp: number;       // ms epoch
  totalPausedMs: number;
  status: SessionStatus;
  manualPaused: boolean;
  pausedAt: number | null;      // ms epoch when current pause started
  lastFix: FixResult | null;
  prevFix: (FixResult & { timestamp: number }) | null;
}
