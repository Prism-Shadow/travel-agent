"use client";

import { useId, useMemo, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { useTheme } from "../../state/theme";
import {
  curvedMapPath,
  MAP_HEIGHT,
  MAP_WIDTH,
  projectMapPoint,
} from "../../lib/world-map-geometry";
import type { MapLocation } from "../../lib/world-map-geometry";

export interface MapProps {
  dots?: Array<{ start: MapLocation; end: MapLocation }>;
  lineColor?: string;
  showLabels?: boolean;
  labelClassName?: string;
  animationDuration?: number;
  loop?: boolean;
  paused?: boolean;
  className?: string;
}

// Subscribe directly: the animation library's hook snapshots this preference only on mount.
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const getReducedMotion = () => window.matchMedia(motionQuery).matches;

/** Decorative route illustration. Coordinates share the local basemap's projection and crop. */
export function WorldMap({
  dots = [],
  lineColor,
  showLabels = true,
  labelClassName = "text-[13px]",
  animationDuration = 3,
  loop = true,
  paused = false,
  className = "",
}: MapProps) {
  const { dark } = useTheme();
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => true);
  const animate = !paused && !reducedMotion;
  const color = lineColor ?? (dark ? "#8aa6ff" : "#315efb");
  const gradientId = `map-route-${useId().replace(/:/g, "")}`;
  const duration = Number.isFinite(animationDuration) ? Math.max(0.2, animationDuration) : 3;
  const cycle = duration + 4;
  const drawEnd = duration / cycle;
  const routes = useMemo(
    () =>
      dots.flatMap(({ start, end }) => {
        const from = projectMapPoint(start);
        const to = projectMapPoint(end);
        return from && to ? [{ start, end, from, to, path: curvedMapPath(from, to) }] : [];
      }),
    [dots],
  );
  const locations = useMemo(() => {
    const points = new Map<string, MapLocation>();
    for (const route of routes) {
      for (const point of [route.start, route.end]) points.set(`${point.lat},${point.lng}`, point);
    }
    return [...points.entries()];
  }, [routes]);

  return (
    <div
      aria-hidden="true"
      data-testid="world-map"
      data-motion={animate ? "animated" : "static"}
      className={`pointer-events-none relative aspect-[2.5/1] w-full select-none ${className}`}
    >
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="block h-full w-full"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="45%" stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color} stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <image
          href="/maps/world-dots.svg"
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          preserveAspectRatio="none"
          opacity={dark ? 0.38 : 0.48}
        />
        {routes.map(({ path }, i) => (
          <g key={`${path}-${i}`}>
            <path d={path} fill="none" stroke={color} strokeWidth="0.8" opacity="0.12" />
            <motion.path
              key={animate ? "animated" : "static"}
              d={path}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="1.4"
              initial={animate ? { pathLength: 0, opacity: 0 } : false}
              animate={
                animate && loop
                  ? { pathLength: [0, 1, 1, 1], opacity: [0, 1, 1, 0] }
                  : { pathLength: 1, opacity: 1 }
              }
              transition={
                animate
                  ? {
                      duration: loop ? cycle : duration,
                      delay: i * 0.65,
                      ...(loop
                        ? {
                            times: [0, drawEnd, drawEnd + (1 - drawEnd) * 0.65, 1],
                            repeat: Infinity,
                          }
                        : {}),
                      ease: "easeInOut",
                    }
                  : { duration: 0 }
              }
            />
            {animate && (
              <circle r="2.8" fill={color} opacity="0">
                <animateMotion
                  path={path}
                  dur={`${cycle}s`}
                  begin={`${i * 0.65}s`}
                  keyPoints="0;1;1"
                  keyTimes={`0;${drawEnd};1`}
                  calcMode="linear"
                  repeatCount={loop ? "indefinite" : 1}
                />
                <animate
                  attributeName="opacity"
                  values="0;1;1;0;0"
                  keyTimes={`0;${drawEnd * 0.08};${drawEnd * 0.92};${drawEnd};1`}
                  dur={`${cycle}s`}
                  begin={`${i * 0.65}s`}
                  repeatCount={loop ? "indefinite" : 1}
                />
              </circle>
            )}
          </g>
        ))}
        {locations.map(([key, location]) => {
          const point = projectMapPoint(location)!;
          return (
            <g key={key}>
              <circle cx={point.x} cy={point.y} r="7" fill={color} opacity="0.1" />
              <circle cx={point.x} cy={point.y} r="3" fill={color} />
              <circle cx={point.x} cy={point.y} r="1.1" fill={dark ? "#dfe8ff" : "white"} />
              {showLabels && location.label && (
                <foreignObject
                  x={Math.min(MAP_WIDTH - 100, Math.max(0, point.x - 50))}
                  y={Math.max(0, point.y - 31)}
                  width="100"
                  height="24"
                >
                  <div className="flex h-full items-center justify-center">
                    <span
                      className={`rounded-md bg-white/90 px-2 py-0.5 font-medium text-slate-600 dark:bg-[#111a2b]/90 dark:text-slate-300 ${labelClassName}`}
                    >
                      {location.label}
                    </span>
                  </div>
                </foreignObject>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
