'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Session, FixResult } from '../types';
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
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'acquiring' | 'ok' | 'error'>('idle');
  const [now, setNow] = useState(Date.now());

  // Recompute now every 30 seconds to keep elapsed time fresh
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const takeFix = useCallback(() => {
    if (!navigator.geolocation) return;
    setGpsStatus('acquiring');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsStatus('ok');
        const { latitude, longitude, speed } = pos.coords;
        const nowMs = Date.now();
        setNow(nowMs);

        setSession((prev) => {
          const fix = projectOntoRoute(latitude, longitude, prev.route);
          // getMovingElapsed returns seconds already
          const elapsedS = getMovingElapsed(prev, nowMs);

          // Auto-pause logic
          let updated = { ...prev };
          const offRoute = fix.offsetMeters > OFF_ROUTE_THRESHOLD_M;
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

          // Speed from GPS or derived from prev fix
          let derivedSpeed: number | null = speed; // m/s or null
          if ((derivedSpeed === null || derivedSpeed < 0) && prev.lastFix) {
            const dt = (nowMs - (prev.prevFix?.timestamp ?? nowMs - 1)) / 1000;
            const dd = fix.distanceAlong - prev.lastFix.distanceAlong;
            if (dt > 0) derivedSpeed = dd / dt;
          }

          // suppress unused variable warning — derivedSpeed used for future speed display
          void derivedSpeed;
          void elapsedS;

          const newFix: FixResult = fix;
          const newSession: Session = {
            ...updated,
            lastFix: newFix,
            prevFix: prev.lastFix ? { ...prev.lastFix, timestamp: nowMs } : null,
          };
          saveSession(newSession);
          return newSession;
        });
      },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }, []);

  // Take fix on screen open
  useEffect(() => {
    takeFix();
    const onVisible = () => { if (document.visibilityState === 'visible') takeFix(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [takeFix]);

  function togglePause() {
    const nowMs = Date.now();
    setSession((prev) => {
      let updated: Session;
      if (prev.manualPaused) {
        // Resume
        const pauseDuration = prev.pausedAt ? (nowMs - prev.pausedAt) : 0;
        updated = {
          ...prev,
          manualPaused: false,
          pausedAt: null,
          totalPausedMs: prev.totalPausedMs + pauseDuration,
          status: 'riding',
        };
      } else {
        // Pause
        updated = { ...prev, manualPaused: true, pausedAt: nowMs, status: 'paused' };
      }
      saveSession(updated);
      return updated;
    });
  }

  function handleReset() {
    clearSession();
    onReset();
  }

  // Derived metrics
  // getMovingElapsed returns seconds
  const elapsedS = getMovingElapsed(session, now);
  const distanceAlong = session.lastFix?.distanceAlong ?? 0;
  const totalDistanceM = session.route[session.route.length - 1]?.dist ?? 1;

  const expected = expectedAtTime(elapsedS, session.route, session.schedule);
  const aheadBehindM = distanceAlong - expected.distanceAlong; // + ahead, - behind
  const speedDelta = speedDeltaKmh(distanceAlong, elapsedS, session.targetSeconds, session.route, session.schedule);

  const avgSpeedMs = elapsedS > 0 ? distanceAlong / elapsedS : 0;
  // Current speed: fallback to avg; real speed from GPS handled in takeFix
  const currentSpeedMs = avgSpeedMs;

  const isPaused = session.manualPaused || (session.pausedAt !== null && !session.manualPaused);
  const aheadColor = aheadBehindM >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]';
  const deltaColor = speedDelta <= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]';

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2">
        <div className="text-lg font-black text-[#FC4C02] tracking-tight">PACETRACK</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-semibold ${isPaused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
            {isPaused ? 'PAUSED' : 'RIDING'}
          </span>
          {gpsStatus === 'acquiring' && <span className="text-xs text-gray-400">GPS…</span>}
        </div>
      </div>

      {/* View toggle */}
      <div className="flex mx-4 mb-3 bg-[#111] rounded-lg p-1 gap-1">
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

      {/* Main content */}
      {view === 'map' ? (
        <div className="flex-1 mx-4 rounded-xl overflow-hidden" style={{ minHeight: '60vh' }}>
          <MapView
            route={session.route}
            currentFix={session.lastFix}
            expectedPosition={expected}
            distanceAlong={distanceAlong}
          />
        </div>
      ) : (
        <div className="flex-1 px-4">
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

          {/* Secondary metrics */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <MetricCard label="Current" value={fmtKmh(currentSpeedMs)} unit="km/h" />
            <MetricCard label="Avg" value={fmtKmh(avgSpeedMs)} unit="km/h" />
            <MetricCard label="Expected" value={fmtKmh(expected.expectedSpeedMs)} unit="km/h" />
          </div>

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
      )}

      {/* Controls */}
      <div className="px-4 pb-8 pt-3 flex gap-3">
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
