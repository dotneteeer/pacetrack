import { writeFileSync } from 'fs';

const POINTS = 100;
const TOTAL_DISTANCE_M = 30000; // 30 km
const STEP_M = TOTAL_DISTANCE_M / POINTS;

// Start: near Adeje, Tenerife
const startLat = 28.27;
const startLon = -16.63;

// Simulate a loop: go north-east then curve back
// Each step ~300m, heading roughly northeast
const DEG_PER_M_LAT = 1 / 111000;
const DEG_PER_M_LON = 1 / (111000 * Math.cos(startLat * Math.PI / 180));

function elevation(i) {
  // Gaussian-ish climb: peak at midpoint
  const t = i / (POINTS - 1); // 0 to 1
  const base = 100;
  const peak = 500;
  // Parabolic: rises to peak at t=0.5, returns to base
  return base + (peak - base) * 4 * t * (1 - t);
}

const points = [];
for (let i = 0; i < POINTS; i++) {
  const t = i / POINTS;
  // Loop trajectory: parametric circle-ish path
  const angle = t * 2 * Math.PI;
  const radius = 0.07; // degrees
  const lat = startLat + radius * Math.sin(angle);
  const lon = startLon + radius * (1 - Math.cos(angle)) * 0.6;
  const ele = elevation(i);
  points.push({ lat: lat.toFixed(7), lon: lon.toFixed(7), ele: ele.toFixed(1) });
}

const trkpts = points.map(p =>
  `    <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele></trkpt>`
).join('\n');

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PaceTrack Sample" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Sample Route — Tenerife Loop</name></metadata>
  <trk>
    <name>Tenerife 30km Loop</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

writeFileSync('public/sample-route.gpx', gpx);
console.log(`Generated ${POINTS} track points`);
