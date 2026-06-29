'use client';

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { RoutePoint, Session } from '../types';
import { parseGpx } from '../lib/gpx';
import { buildSchedule } from '../lib/pacing';
import { saveSession } from '../lib/session';
import { fmtKm, fmtHMM } from '../lib/format';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

interface SetupProps {
  onStart: (session: Session) => void;
}

export default function Setup({ onStart }: SetupProps) {
  const [route, setRoute] = useState<RoutePoint[] | null>(null);
  const [hours, setHours] = useState(2);
  const [minutes, setMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalDistanceM = route ? route[route.length - 1].dist : 0;
  const elevGain = route ? computeElevGain(route) : 0;
  const targetSeconds = hours * 3600 + minutes * 60;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const pts = parseGpx(ev.target!.result as string);
        setRoute(pts);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
        setRoute(null);
      }
    };
    reader.readAsText(file);
  }

  function handleStart() {
    if (!route || targetSeconds < 60) return;
    const schedule = buildSchedule(route, targetSeconds);
    const session: Session = {
      route,
      schedule,
      targetSeconds,
      startTimestamp: Date.now(),
      totalPausedMs: 0,
      status: 'riding',
      manualPaused: false,
      pausedAt: null,
      lastFix: null,
      prevFix: null,
    };
    saveSession(session);
    onStart(session);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Header */}
      <div className="px-6 pt-8 pb-4">
        <h1 className="text-3xl font-black tracking-tight text-[#FC4C02]">PACETRACK</h1>
        <p className="text-sm text-gray-400 mt-1">GPX pacing assistant for cyclists</p>
      </div>

      {/* GPX Upload */}
      <div className="px-6 py-4">
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-4 border-2 border-dashed border-[#333] rounded-xl text-gray-400 hover:border-[#FC4C02] hover:text-[#FC4C02] transition-colors text-sm font-semibold"
        >
          {route ? `✓ ${route.length} track points loaded` : 'TAP TO UPLOAD GPX FILE'}
        </button>
        <input ref={fileRef} type="file" accept=".gpx" className="hidden" onChange={handleFile} />
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>

      {/* Route stats (if loaded) */}
      {route && (
        <>
          <div className="px-6 grid grid-cols-2 gap-3 py-2">
            <div className="bg-[#111] rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase tracking-widest">Distance</div>
              <div className="text-2xl font-black tabular-nums mt-1">{fmtKm(totalDistanceM)}<span className="text-sm font-normal text-gray-400 ml-1">km</span></div>
            </div>
            <div className="bg-[#111] rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase tracking-widest">Elevation +</div>
              <div className="text-2xl font-black tabular-nums mt-1">{Math.round(elevGain)}<span className="text-sm font-normal text-gray-400 ml-1">m</span></div>
            </div>
          </div>

          {/* Map preview */}
          <div className="mx-6 my-3 rounded-xl overflow-hidden" style={{ height: '220px' }}>
            <MapView route={route} currentFix={null} expectedPosition={null} distanceAlong={0} />
          </div>
        </>
      )}

      {/* Target time picker */}
      <div className="px-6 py-4">
        <div className="text-xs text-gray-400 uppercase tracking-widest mb-3">Target time</div>
        <div className="flex items-center gap-4 bg-[#111] rounded-xl p-4">
          <div className="flex flex-col items-center flex-1">
            <input
              type="number"
              min={0}
              max={99}
              value={hours}
              onChange={(e) => setHours(Math.max(0, Math.min(99, Number(e.target.value))))}
              className="w-full text-center text-4xl font-black tabular-nums bg-transparent outline-none"
            />
            <span className="text-xs text-gray-400">HRS</span>
          </div>
          <span className="text-4xl font-black text-gray-500">:</span>
          <div className="flex flex-col items-center flex-1">
            <input
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(0, Math.min(59, Number(e.target.value))))}
              className="w-full text-center text-4xl font-black tabular-nums bg-transparent outline-none"
            />
            <span className="text-xs text-gray-400">MIN</span>
          </div>
        </div>
        {route && (
          <p className="text-xs text-gray-400 mt-2 text-center">
            Target avg: {(totalDistanceM / 1000 / (targetSeconds / 3600)).toFixed(1)} km/h
            {' · '}{fmtHMM(targetSeconds)}
          </p>
        )}
      </div>

      {/* Start button */}
      <div className="px-6 pb-8 mt-auto">
        <button
          onClick={handleStart}
          disabled={!route || targetSeconds < 60}
          className="w-full py-5 rounded-xl font-black text-xl tracking-wide bg-[#FC4C02] text-white disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-transform"
        >
          START RIDE
        </button>
      </div>
    </div>
  );
}

function computeElevGain(route: RoutePoint[]): number {
  let gain = 0;
  for (let i = 1; i < route.length; i++) {
    const diff = route[i].ele - route[i - 1].ele;
    if (diff > 0) gain += diff;
  }
  return gain;
}
