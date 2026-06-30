'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Session } from '../types';
import { saveSession, clearSession, getMovingElapsed, OFF_ROUTE_THRESHOLD_M } from '../lib/session';
import { projectOntoRoute } from '../lib/geo';
import { expectedAtTime, speedDeltaKmh } from '../lib/pacing';
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

  // Process one geolocation fix — shared by watchPosition and manual takeFix
  const processPosition = useCallback((pos: GeolocationPosition) => {
    setGpsStatus('ok');
    const { latitude, longitude, speed } = pos.coords;
    const nowMs = Date.now();
    setNow(nowMs);

    setSession((prev) => {
      const fix = projectOntoRoute(latitude, longitude, prev.route);
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
        // Only use derivation for reasonable Δt (1–60 s)
        if (dt >= 1 && dt < 60) currentSpeedMs = Math.max(0, dd / dt);
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
      };
      saveSession(newSession);
      return newSession;
    });
  }, []);

  // Stop GPS watch (saves battery during manual pause / page hide)
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

  // Manual GPS refresh (button + initial fix on mount)
  const takeFix = useCallback(() => {
    if (!navigator.geolocation) return;
    setGpsStatus('watching');
    navigator.geolocation.getCurrentPosition(
      processPosition,
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [processPosition]);

  // Watch lifecycle: run while not manually paused + page is visible.
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

  function handleReset() {
    stopWatch();
    clearSession();
    onReset();
  }

  // ── Derived metrics ────────────────────────────────────────────────────────
  const elapsedS = getMovingElapsed(session, now);
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

  const isPaused = session.manualPaused || (session.pausedAt !== null && !session.manualPaused);
  const aheadColor = aheadBehindM >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]';
  const deltaColor = speedDelta <= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]';
  const gpsLabel = gpsStatus === 'watching' ? 'GPS…' : gpsStatus === 'error' ? 'GPS ✗' : null;

  return (
    <div className="h-[100dvh] bg-[#0a0a0a] text-white flex flex-col overflow-hidden">
      {/* Header bar — fixed height */}
      <div className="flex-none flex items-center justify-between px-4 pt-6 pb-2">
        <div className="text-lg font-black text-[#FC4C02] tracking-tight">PACETRACK</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-semibold ${isPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
            {isPaused ? 'PAUSED' : 'RIDING'}
          </span>
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
          />
        </div>

        {/* Metrics — hidden (not unmounted) on map tab so state persists */}
        <div className={`flex-1 min-h-0 overflow-y-auto pt-3 ${view === 'stats' ? '' : 'hidden'}`}>
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
        </div>
      </div>

      {/* Controls — always visible, pinned to bottom, respects iOS safe area */}
      <div
        className="flex-none px-4 pt-3 flex gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
      >
        <button
          onClick={takeFix}
          className="flex-1 py-3 rounded-xl bg-[#1a1a1a] text-sm font-bold text-gray-300 active:scale-95 transition-transform"
        >
          REFRESH GPS
        </button>
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
    </div>
  );
}
