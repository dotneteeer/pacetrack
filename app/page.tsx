'use client';

import { useEffect, useState } from 'react';
import { Session } from '../types';
import { loadSession } from '../lib/session';
import Setup from '../components/Setup';
import Ride from '../components/Ride';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    // Restore session
    const s = loadSession();
    setSession(s);
    setLoaded(true);
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-[#FC4C02] text-2xl font-black tracking-tight">PACETRACK</div>
      </div>
    );
  }

  if (session && session.status !== 'idle') {
    return <Ride initialSession={session} onReset={() => setSession(null)} />;
  }

  return (
    <Setup
      onStart={(newSession) => setSession(newSession)}
    />
  );
}
