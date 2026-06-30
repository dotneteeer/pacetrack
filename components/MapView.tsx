'use client';

import { useEffect, useRef } from 'react';
import type { RoutePoint, FixResult } from '../types';

interface MapViewProps {
  route: RoutePoint[];
  currentFix: FixResult | null;
  expectedPosition: { lat: number; lon: number } | null;
  distanceAlong: number; // metres — used to shade completed portion
  follow?: boolean;       // pan to currentFix on each update
  heading?: number | null; // degrees 0–360; null = show pulse dot, number = show arrow
}

export default function MapView({
  route,
  currentFix,
  expectedPosition,
  distanceAlong,
  follow = false,
  heading = null,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<{ dot?: any; ghost?: any; dotLayer?: any; completedLayer?: any }>({});
  const roRef = useRef<ResizeObserver | null>(null);
  const initialFollowZoomDoneRef = useRef(false);

  useEffect(() => {
    import('leaflet').then((L) => {
      leafletRef.current = L;
      if (!mapRef.current || mapInstanceRef.current) return;

      // Fix Leaflet default icon paths (Next.js asset handling)
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
        // Canvas renderer prevents SVG polyline clipping on pan for long routes
        preferCanvas: true,
      });

      // CartoDB Voyager — bright street map, Strava/Komoot style
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 20,
        }
      ).addTo(map);

      mapInstanceRef.current = map;

      // Draw full route: white casing underneath, faded orange on top
      if (route.length > 1) {
        const latlngs = route.map((p) => [p.lat, p.lon] as [number, number]);
        L.polyline(latlngs, { color: '#ffffff', weight: 6, opacity: 0.7 }).addTo(map);
        L.polyline(latlngs, { color: '#FC4C02', weight: 4, opacity: 0.45 }).addTo(map);
        map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
      }

      // Force tile-load after container has correct layout dimensions
      requestAnimationFrame(() => map.invalidateSize());

      // ResizeObserver: keeps map correct when container changes size (tab switch)
      if (mapRef.current) {
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mapRef.current);
        roRef.current = ro;
      }
    });

    return () => {
      roRef.current?.disconnect();
      roRef.current = null;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      initialFollowZoomDoneRef.current = false;
    };
  }, []); // mount only — route drawn once

  // Update completed portion, current marker, ghost, and follow position when props change
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    // Remove old dynamic layers
    markersRef.current.completedLayer?.remove();
    markersRef.current.dotLayer?.remove();
    markersRef.current.ghost?.remove();

    // Completed portion — solid orange on top of casing
    const completedPoints = route.filter((p) => p.dist <= distanceAlong);
    if (completedPoints.length > 1) {
      const latlngs = completedPoints.map((p) => [p.lat, p.lon] as [number, number]);
      markersRef.current.completedLayer = L.polyline(latlngs, {
        color: '#FC4C02',
        weight: 5,
        opacity: 1,
      }).addTo(map);
    }

    // Current position marker
    if (currentFix) {
      const hasHeading = heading !== null && heading !== undefined && !isNaN(heading as number);

      if (hasHeading) {
        // Arrow marker — triangular SVG pointing north, rotated to heading
        const arrowIcon = L.divIcon({
          className: '',
          html: `<svg width="20" height="28" viewBox="0 0 20 28"
            style="transform:rotate(${heading}deg);transform-origin:50% 50%;display:block;overflow:visible;">
            <polygon points="10,0 20,28 10,21 0,28"
              fill="#FC4C02" stroke="white" stroke-width="2" stroke-linejoin="round"/>
          </svg>`,
          iconSize: [20, 28],
          iconAnchor: [10, 14],
        });
        markersRef.current.dotLayer = L.marker([currentFix.lat, currentFix.lon], {
          icon: arrowIcon,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        // Fallback — pulsing dot when stationary / no heading
        const dotIcon = L.divIcon({
          className: '',
          html: '<div class="pulse-dot"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        markersRef.current.dotLayer = L.marker([currentFix.lat, currentFix.lon], {
          icon: dotIcon,
          zIndexOffset: 1000,
        }).addTo(map);
      }

      // Follow mode: pan to (or zoom+pan to on first fix) current position
      if (follow) {
        if (!initialFollowZoomDoneRef.current) {
          map.setView([currentFix.lat, currentFix.lon], 16);
          initialFollowZoomDoneRef.current = true;
        } else {
          map.panTo([currentFix.lat, currentFix.lon]);
        }
      }
    }

    // Ghost marker — expected position (hollow orange circle)
    if (expectedPosition) {
      const ghostIcon = L.divIcon({
        className: '',
        html: '<div style="width:14px;height:14px;border-radius:50%;border:3px solid #FC4C02;background:transparent;opacity:0.8;"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      markersRef.current.ghost = L.marker([expectedPosition.lat, expectedPosition.lon], {
        icon: ghostIcon,
        zIndexOffset: 500,
      }).addTo(map);
    }
  }, [route, currentFix, expectedPosition, distanceAlong, follow, heading]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />;
}
