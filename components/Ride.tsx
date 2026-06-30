'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Session, TrackSample } from '../types';
import { saveSession, clearSession, getMovingElapsed, OFF_ROUTE_THRESHOLD_M } from '../lib/session';
import { projectOntoRoute, bearing } from '../lib/geo';
import { expectedAtTime, speedDeltaKmh } from '../lib/pacing';
import { buildGpxFromTrack } from '../lib/gpx';
import { fmtKm, fmtKmSigned, fmtKmh, fmtHMM, fmtETA } from '../lib/format';
import MetricCard from './MetricCard';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

interface RideProps {
  initialSession: Session;
  onReset: () => void;
}

export default function Ride({ initialSession, onReset }: RideProps) {
  const [session, setSession] = useState<Session>(initialSession);
  const [view, setView] = useState<'stats' | 'map'>('stats');
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'watching' | 'ok' | 'error'>('idle');
  const [now, setNow] = useState(Date.now());
  const watchIdRef = useRef<number | null>(null);

  // Live clock — 1 s tick drives elapsed time, ghost position, speed delta
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Process one geolocation fix — shared by watchPosition callback
  const processPosition = useCallback((pos: GeolocationPosition) => {
    setGpsStatus('ok');
    const { latitude, longitude, speed, altitude, heading: gpsHeading } = pos.coords;
    const nowMs = Date.now();
    setNow(nowMs);

    setSession((prev) => {
      // Pass previous distanceAlong as hint so loop routes don't snap to finish segment
      const hintDist = prev.lastFix?.distanceAlong ?? 0;
      const fix = projectOntoRoute(latitude, longitude, prev.route, hintDist);
      const offRoute = fix.offsetMeters > OFF_ROUTE_THRESHOLD_M;

      // Auto-pause / auto-resume
      let updated = { ...prev };
      if (offRoute && !prev.manualPaused && !prev.pausedAt) {
        updated = { ...updated, pausedAt: nowMs, status: 'paused' };
      } else if (!offRoute && !prev.manualPaused && prev.pausedAt) {
        updated = {
          ...updated,
          totalPausedMs: prev.totalPausedMs + (nowMs - prev.pausedAt),
          pausedAt: null,
          status: 'riding',
        };
      }

      // Current speed: prefer GPS (m/s ≥ 0), else derive from consecutive fix pair
      let currentSpeedMs: number | null = (speed !== null && speed >= 0) ? speed : null;
      if (currentSpeedMs === null && prev.lastFix && prev.lastFixAt !== null) {
        const dt = (nowMs - prev.lastFixAt) / 1000;
        const dd = fix.distanceAlong - prev.lastFix.distanceAlong;
        if (dt >= 1 && dt < 60) currentSpeedMs = Math.max(0, dd / dt);
      }

      // Heading: prefer GPS heading (valid 0–360), else derive from consecutive fixes
      let newHeading: number | null = null;
      const h = gpsHeading;
      if (h !== null && h !== undefined && !isNaN(h) && h >= 0 && h <= 360) {
        newHeading = h;
      } else if (prev.lastFix) {
        const dist = Math.abs(fix.distanceAlong - prev.lastFix.distanceAlong);
        // Only compute bearing if we've actually moved (avoid stationary noise)
        if (dist > 3) {
          newHeading = bearing(
            { lat: prev.lastFix.lat, lon: prev.lastFix.lon },
            { lat: fix.lat, lon: fix.lon }
          );
        } else {
          newHeading = prev.lastHeading;
        }
      }

      // Track recording — throttle to ≥2 s to cap localStorage size
      const lastTrackT = prev.track.length > 0 ? prev.track[prev.track.length - 1].t : 0;
      let newTrack = prev.track;
      if (nowMs - lastTrackT >= 2000) {
        // Interpolate route elevation as fallback when GPS altitude is unavailable
        let routeEle = 0;
        for (let i = 0; i < prev.route.length - 1; i++) {
          const a = prev.route[i], b = prev.route[i + 1];
          if (fix.distanceAlong >= a.dist && fix.distanceAlong <= b.dist) {
            const span = b.dist - a.dist;
            const t = span > 0 ? (fix.distanceAlong - a.dist) / span : 0;
            routeEle = a.ele + t * (b.ele - a.ele);
            break;
          }
        }
        const sample: TrackSample = {
          t: nowMs,
          lat: latitude,
          lon: longitude,
          ele: (altitude !== null && !isNaN(altitude as number)) ? altitude as number : routeEle,
          speed: currentSpeedMs ?? 0,
          dist: fix.distanceAlong,
        };
        newTrack = [...prev.track, sample];
      }

      const newSession: Session = {
        ...updated,
        lastFix: fix,
        prevFix: prev.lastFix
          ? { ...prev.lastFix, timestamp: prev.lastFixAt ?? nowMs }
          : null,
        startDistanceAlong: prev.startDistanceAlong ?? fix.distanceAlong,
        lastFixAt: nowMs,
        lastSpeedMs: currentSpeedMs,
        lastHeading: newHeading,
        track: newTrack,
      };
      saveSession(newSession);
      return newSession;
    });
  }, []);

  // Stop GPS watch (saves battery during manual pause / page hide / finish)
  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Start continuous GPS watch
  const startWatch = useCallback(() => {
    if (!navigator.geolocation || watchIdRef.current !== null) return;
    setGpsStatus('watching');
    watchIdRef.current = navigator.geolocation.watchPosition(
      processPosition,
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
  }, [processPosition]);

  // Watch lifecycle: run while not manually paused + page is visible + not finished.
  // Keeps running through auto-pause so we can detect back-on-route.
  useEffect(() => {
    const shouldWatch = !session.manualPaused && session.status !== 'finished';

    const update = () => {
      if (shouldWatch && document.visibilityState === 'visible') {
        startWatch();
      } else {
        stopWatch();
      }
    };

    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      stopWatch();
    };
  }, [session.manualPaused, session.status, startWatch, stopWatch]);

  function togglePause() {
    const nowMs = Date.now();
    setSession((prev) => {
      let updated: Session;
      if (prev.manualPaused) {
        const pauseDuration = prev.pausedAt ? nowMs - prev.pausedAt : 0;
        updated = {
          ...prev,
          manualPaused: false,
          pausedAt: null,
          totalPausedMs: prev.totalPausedMs + pauseDuration,
          status: 'riding',
        };
      } else {
        updated = { ...prev, manualPaused: true, pausedAt: nowMs, status: 'paused' };
      }
      saveSession(updated);
      return updated;
    });
  }

  function handleFinish() {
    const nowMs = Date.now();
    stopWatch();
    setSession((prev) => {
      // Finalise any open pause so moving time is accurate
      const openPauseMs = prev.pausedAt ? nowMs - prev.pausedAt : 0;
      const updated: Session = {
        ...prev,
        status: 'finished',
        endTimestamp: nowMs,
        manualPaused: false,
        pausedAt: null,
        totalPausedMs: prev.totalPausedMs + openPauseMs,
      };
      saveSession(updated);
      return updated;
    });
  }

  function handleReset() {
    stopWatch();
    clearSession();
    onReset();
  }

  function exportGpx() {
    if (session.track.length === 0) {
      alert('No GPS track recorded yet.');
      return;
    }
    const gpx = buildGpxFromTrack(session.track, {
      startTimestamp: session.startTimestamp,
      name: 'PaceTrack Ride',
    });
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date(session.startTimestamp);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    a.href = url;
    a.download = `pacetrack-${stamp}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Derived metrics ────────────────────────────────────────────────────────
  // Freeze elapsed at endTimestamp when finished so the clock doesn't keep ticking
  const elapsedS = session.status === 'finished' && session.endTimestamp !== null
    ? getMovingElapsed(session, session.endTimestamp)
    : getMovingElapsed(session, now);

  const distanceAlong = session.lastFix?.distanceAlong ?? 0;
  const totalDistanceM = session.route[session.route.length - 1]?.dist ?? 1;

  const expected = expectedAtTime(elapsedS, session.route, session.schedule);
  const aheadBehindM = distanceAlong - expected.distanceAlong; // + ahead, − behind
  const speedDelta = speedDeltaKmh(
    distanceAlong, elapsedS, session.targetSeconds, session.route, session.schedule
  );

  // Avg speed: distance ridden since first fix / moving elapsed (not from route start)
  const startDist = session.startDistanceAlong ?? distanceAlong;
  const traveledM = Math.max(0, distanceAlong - startDist);
  const avgSpeedMs = elapsedS > 0 ? traveledM / elapsedS : 0;

  // Current speed from GPS/derived; null → show '—'
  const currentSpeedDisplay =
    session.lastSpeedMs !== null && session.lastSpeedMs !== undefined
      ? fmtKmh(session.lastSpeedMs)
      : '—';

  const isFinished = session.status === 'finished';
  const isPaused = !isFinished && (session.manualPaused || (session.pausedAt !== null && !session.manualPaused));
  const aheadColor = aheadBehindM >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]';
  const deltaColor = speedDelta <= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]';
  const gpsLabel = gpsStatus === 'watching' ? 'GPS…' : gpsStatus === 'error' ? 'GPS ✗' : null;

  const statusChip = isFinished
    ? <span className="text-xs px-2 py-1 rounded-full font-semibold bg-[#FC4C02]/20 text-[#FC4C02]">FINISHED</span>
    : <span className={`text-xs px-2 py-1 rounded-full font-semibold ${isPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
        {isPaused ? 'PAUSED' : 'RIDING'}
      </span>;

  return (
    <div className="h-[100dvh] bg-[#0a0a0a] text-white flex flex-col overflow-hidden">
      {/* Header bar — fixed height */}
      <div className="flex-none flex items-center justify-between px-4 pt-6 pb-2">
        <div className="text-lg font-black text-[#FC4C02] tracking-tight">PACETRACK</div>
        <div className="flex items-center gap-2">
          {statusChip}
          {gpsLabel && <span className="text-xs text-gray-400">{gpsLabel}</span>}
        </div>
      </div>

      {/* View toggle — fixed height */}
      <div className="flex-none flex mx-4 mb-3 bg-[#111] rounded-lg p-1 gap-1">
        {(['stats', 'map'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-2 rounded-md text-sm font-bold uppercase tracking-wide transition-colors ${view === v ? 'bg-[#FC4C02] text-white' : 'text-gray-400'}`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Content area — map always mounted; metrics shown/hidden via CSS */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-4">
        {/* Map container — tall on map tab, compact on stats tab */}
        <div className={`rounded-xl overflow-hidden ${view === 'map' ? 'flex-1 min-h-0' : 'h-[170px] flex-none'}`}>
          <MapView
            route={session.route}
            currentFix={session.lastFix}
            expectedPosition={expected}
            distanceAlong={distanceAlong}
            follow={true}
            heading={session.lastHeading}
          />
        </div>

        {/* Metrics — hidden (not unmounted) on map tab so state persists */}
        <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain pt-3 ${view === 'stats' ? '' : 'hidden'}`}>
          {isFinished ? (
            /* ── Finished summary ── */
            <>
              <div className="text-center py-4">
                <div className="text-2xl font-black text-[#FC4C02]">🏁 FINISHED</div>
                <div className="text-xs text-gray-400 mt-1">Great ride!</div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <MetricCard
                  label="Moving Time"
                  value={fmtHMM(elapsedS)}
                  subtext={`target ${fmtHMM(session.targetSeconds)}`}
                />
                <MetricCard
                  label="Distance"
                  value={fmtKm(distanceAlong)}
                  unit="km"
                />
                <MetricCard
                  label="Avg Speed"
                  value={fmtKmh(avgSpeedMs)}
                  unit="km/h"
                />
                <MetricCard
                  label="vs Target"
                  value={fmtKmSigned(aheadBehindM)}
                  unit="km"
                  color={aheadColor}
                />
              </div>
            </>
          ) : (
            /* ── Live stats ── */
            <>
              {/* Primary metrics */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <MetricCard
                  label="Ahead / Behind"
                  value={fmtKmSigned(aheadBehindM)}
                  unit="km"
                  color={aheadColor}
                  large
                />
                <MetricCard
                  label="Speed Adj."
                  value={`${speedDelta > 0 ? '+' : ''}${speedDelta.toFixed(1)}`}
                  unit="km/h"
                  color={deltaColor}
                  large
                />
              </div>

              {/* Speed metrics */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <MetricCard label="Current" value={currentSpeedDisplay} unit="km/h" />
                <MetricCard label="Avg" value={fmtKmh(avgSpeedMs)} unit="km/h" />
                <MetricCard label="Expected" value={fmtKmh(expected.expectedSpeedMs)} unit="km/h" />
              </div>

              {/* Time / distance */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <MetricCard
                  label="Elapsed"
                  value={fmtHMM(elapsedS)}
                  subtext={`of ${fmtHMM(session.targetSeconds)}`}
                />
                <MetricCard
                  label="Distance"
                  value={fmtKm(distanceAlong)}
                  subtext={`of ${fmtKm(totalDistanceM)} km`}
                />
              </div>

              <div className="mb-3">
                <MetricCard
                  label="ETA"
                  value={fmtETA(distanceAlong, avgSpeedMs, totalDistanceM, now)}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Controls — always visible, pinned to bottom, respects iOS safe area */}
      <div
        className="flex-none px-4 pt-3 flex flex-col gap-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
      >
        {isFinished ? (
          /* ── Finished controls ── */
          <>
            <button
              onClick={exportGpx}
              className="w-full py-4 rounded-xl bg-[#1a1a1a] text-[#FC4C02] font-black text-base border border-[#FC4C02]/40 active:scale-95 transition-transform"
            >
              EXPORT GPX
            </button>
            <button
              onClick={handleReset}
              className="w-full py-4 rounded-xl bg-[#FC4C02] text-white font-black text-base active:scale-95 transition-transform"
            >
              NEW RIDE
            </button>
          </>
        ) : (
          /* ── Riding controls ── */
          <>
            {/* Big FINISH button */}
            <button
              onClick={handleFinish}
              className="w-full py-4 rounded-xl bg-[#FC4C02] text-white font-black text-lg tracking-wide active:scale-95 transition-transform"
            >
              FINISH
            </button>
            {/* PAUSE + RESET row */}
            <div className="flex gap-2">
              <button
                onClick={togglePause}
                className={`flex-1 py-3 rounded-xl text-sm font-bold active:scale-95 transition-transform ${isPaused ? 'bg-[#FC4C02] text-white' : 'bg-[#1a1a1a] text-gray-300'}`}
              >
                {isPaused ? 'RESUME' : 'PAUSE'}
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-3 rounded-xl bg-[#1a1a1a] text-sm font-bold text-red-400 active:scale-95 transition-transform"
              >
                RESET
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
