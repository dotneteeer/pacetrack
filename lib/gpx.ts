import { RoutePoint, TrackSample } from '../types';

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseGpx(xml: string): RoutePoint[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid GPX XML');
  }

  const trkpts = doc.getElementsByTagName('trkpt');
  const points: RoutePoint[] = [];
  let cumDist = 0;

  for (let i = 0; i < trkpts.length; i++) {
    const pt = trkpts[i];
    const lat = parseFloat(pt.getAttribute('lat') ?? '');
    const lon = parseFloat(pt.getAttribute('lon') ?? '');

    if (isNaN(lat) || isNaN(lon)) continue;

    // Filter consecutive duplicates
    if (points.length > 0) {
      const prev = points[points.length - 1];
      if (prev.lat === lat && prev.lon === lon) continue;
      cumDist += haversineM(prev.lat, prev.lon, lat, lon);
    }

    const eleEl = pt.getElementsByTagName('ele')[0];
    const ele = eleEl ? parseFloat(eleEl.textContent ?? '0') : 0;

    points.push({ lat, lon, ele: isNaN(ele) ? 0 : ele, dist: cumDist });
  }

  if (points.length < 2) {
    throw new Error('GPX has fewer than 2 track points');
  }

  return points;
}

export interface GpxExportMeta {
  startTimestamp: number; // ms epoch
  name?: string;
}

/** Build a GPX 1.1 string from a recorded track (for post-ride export). */
export function buildGpxFromTrack(track: TrackSample[], meta: GpxExportMeta): string {
  const rideName = meta.name ?? 'PaceTrack Ride';
  const startTime = new Date(meta.startTimestamp).toISOString();

  const trkpts = track.map(s => {
    const time = new Date(s.t).toISOString();
    return [
      `    <trkpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}">`,
      `      <ele>${s.ele.toFixed(1)}</ele>`,
      `      <time>${time}</time>`,
      `      <extensions>`,
      `        <gpxtpx:TrackPointExtension>`,
      `          <gpxtpx:speed>${s.speed.toFixed(2)}</gpxtpx:speed>`,
      `        </gpxtpx:TrackPointExtension>`,
      `      </extensions>`,
      `    </trkpt>`,
    ].join('\n');
  }).join('\n');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="PaceTrack"`,
    `  xmlns="http://www.topografix.com/GPX/1/1"`,
    `  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">`,
    `  <metadata>`,
    `    <name>${rideName}</name>`,
    `    <time>${startTime}</time>`,
    `  </metadata>`,
    `  <trk>`,
    `    <name>${rideName}</name>`,
    `    <trkseg>`,
    trkpts,
    `    </trkseg>`,
    `  </trk>`,
    `</gpx>`,
  ].join('\n');
}
