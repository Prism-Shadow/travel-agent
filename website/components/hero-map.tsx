import { curvedMapPath, MAP_HEIGHT, MAP_WIDTH, projectMapPoint } from "../lib/world-map-geometry";

// Reuse the desktop login map's projection and illustrative journeys, without account data.
const locations = [
  { lat: 51.5074, lng: -0.1278 },
  { lat: 31.2304, lng: 121.4737 },
  { lat: 1.3521, lng: 103.8198 },
  { lat: -33.8688, lng: 151.2093 },
].map((location) => projectMapPoint(location)!);
const routes = locations.slice(1).map((end, index) => curvedMapPath(locations[index], end));

/** A quieter presentation of the existing login map: three routes and one moving light. */
export function HeroMap() {
  return (
    <div className="hero-map" aria-hidden="true">
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} focusable="false">
        <image
          className="hero-map-land"
          href="/media/world-dots.svg"
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          preserveAspectRatio="none"
        />
        <g className="hero-map-routes" fill="none" strokeLinecap="round">
          {routes.map((path) => (
            <path key={path} d={path} />
          ))}
        </g>
        <g className="hero-map-locations">
          {locations.map(({ x, y }) => (
            <g key={`${x}-${y}`}>
              <circle className="hero-map-halo" cx={x} cy={y} r="9" />
              <circle className="hero-map-point" cx={x} cy={y} r="3.5" />
              <circle className="hero-map-center" cx={x} cy={y} r="1.3" />
            </g>
          ))}
        </g>
        <circle className="hero-map-traveler" r="3" opacity="0">
          <animateMotion
            path={routes[0]}
            dur="12s"
            keyPoints="0;1;1"
            keyTimes="0;0.75;1"
            calcMode="linear"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0;0"
            keyTimes="0;0.06;0.69;0.75;1"
            dur="12s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  );
}
