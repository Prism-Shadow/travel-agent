/** Equirectangular bounds shared by the dotted-map generator and route overlay. */
export const MAP_REGION = {
  lat: { min: -60, max: 85 },
  lng: { min: -180, max: 180 },
};
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 400;

export interface MapLocation {
  lat: number;
  lng: number;
  label?: string;
}

export function projectMapPoint({ lat, lng }: MapLocation) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < MAP_REGION.lat.min || lat > MAP_REGION.lat.max || lng < -180 || lng > 180) {
    return null;
  }
  return {
    x: ((lng - MAP_REGION.lng.min) / 360) * MAP_WIDTH,
    y: ((MAP_REGION.lat.max - lat) / (MAP_REGION.lat.max - MAP_REGION.lat.min)) * MAP_HEIGHT,
  };
}

export function curvedMapPath(start: { x: number; y: number }, end: { x: number; y: number }) {
  const lift = Math.min(85, Math.hypot(end.x - start.x, end.y - start.y) * 0.22);
  const midY = Math.max(8, Math.min(start.y, end.y) - lift);
  return `M ${start.x} ${start.y} Q ${(start.x + end.x) / 2} ${midY} ${end.x} ${end.y}`;
}
