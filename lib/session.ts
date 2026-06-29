import { Session } from '../types';

const STORAGE_KEY = 'pacetrack_session';

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getMovingElapsed(session: Session, now: number): number {
  const currentOpenPauseDuration = session.pausedAt ? now - session.pausedAt : 0;
  const elapsedMs =
    now - session.startTimestamp - session.totalPausedMs - currentOpenPauseDuration;
  return Math.max(0, elapsedMs) / 1000;
}
