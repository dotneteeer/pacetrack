# PaceTrack — Project Conventions

## Stack
- Next.js App Router + TypeScript (all pages `'use client'` — no SSR)
- Tailwind CSS
- Vanilla Leaflet (loaded in useEffect, not react-leaflet)
- Native navigator.geolocation — no library
- Custom DOMParser GPX parser (lib/gpx.ts) — no external deps

## Design tokens
- Background: #0a0a0a (near-black)
- Accent / Strava orange: #FC4C02
- Ahead color: #22c55e (green-500)
- Behind color: #ef4444 (red-500)
- Primary metric font: tabular-nums, 4xl–6xl, font-black
- Map tiles: CartoDB **Voyager** (bright street map, Strava/Komoot-like)
  https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png
  Route casing: white weight 6 + orange #FC4C02 weight 4 (remaining); solid orange weight 5 (completed)

## Pacing algorithm (lib/pacing.ts)
Grade → speed factor anchors (grade% → f, where 1.0 = flat speed):
  -15→1.5, -8→1.5, -4→1.4, -2→1.2, 0→1.0, 2→0.78, 4→0.6, 6→0.47, 8→0.37, 10→0.30, 15→0.20
Downhill is capped (safety). Interpolated linearly between anchors.
`raw_i = L_i / f(g_i)`, `scale = targetSeconds / Σ raw_i`
`T_i = scale · Σ_{j≤i} raw_j` — pacing schedule (T_n === targetSeconds)
`elevationGain(route, threshold=5)` — smoothed gain with hysteresis (replaces naive delta sum)

## localStorage keys
- `pacetrack_session` — JSON blob of full Session object

## Session shape (types.ts)
RoutePoint: { lat, lon, ele, dist }  (dist = cumulative m from start)
Schedule: { times: number[], rawCosts: number[], scale: number, totalRaw: number, smoothedEles: number[] }
FixResult: { distanceAlong: number, offsetMeters: number, lat: number, lon: number, segmentIndex: number }
Session: {
  route: RoutePoint[]
  schedule: Schedule
  targetSeconds: number
  startTimestamp: number       // ms since epoch
  totalPausedMs: number
  status: 'idle' | 'riding' | 'paused' | 'finished'
  manualPaused: boolean
  pausedAt: number | null      // ms epoch when current pause started
  lastFix: FixResult | null
  prevFix: (FixResult & { timestamp: number }) | null
  startDistanceAlong: number | null  // distanceAlong at first GPS fix (for avg speed)
  lastFixAt: number | null           // ms epoch of most recent GPS fix
  lastSpeedMs: number | null         // current speed m/s (GPS or derived)
}

## GPS model — active while page is open
watchPosition runs continuously while the page is visible and not manually paused.
Stops on visibilitychange→hidden or manual pause (battery). Restarts when page
re-opens or user resumes. Auto-pause when offsetMeters > 100 (off-route);
watch keeps running during auto-pause so back-on-route is auto-detected.
Manual REFRESH GPS button as fallback.
Clock: 1 s setInterval drives elapsed timer, ghost position, speed delta live.

## Key files
- lib/gpx.ts      — parseGpx(xml: string): RoutePoint[]
- lib/geo.ts      — haversine, projectOntoRoute, buildCumulativeDistances
- lib/pacing.ts   — buildSchedule, gradeSpeedFactor, expectedAtTime, speedDeltaKmh, elevationGain, smoothElevation
- lib/session.ts  — loadSession, saveSession, getMovingElapsed
- lib/format.ts   — fmtKm, fmtKmh, fmtHMM, fmtMMSS, fmtClock, fmtETA
- types.ts        — all shared types
