import { WorldMap } from "../components/ui/map";
import { S } from "../lib/strings";

/** Illustrative journeys only: no user destinations, availability or booking claims. */
export default function LoginMap() {
  const cities = S.auth.journey.cities;
  const london = { lat: 51.5074, lng: -0.1278, label: cities.london };
  const shanghai = { lat: 31.2304, lng: 121.4737, label: cities.shanghai };
  const singapore = { lat: 1.3521, lng: 103.8198, label: cities.singapore };
  return (
    <WorldMap
      dots={[
        { start: { lat: 40.7128, lng: -74.006, label: cities.newYork }, end: london },
        { start: london, end: shanghai },
        { start: shanghai, end: { lat: 35.6762, lng: 139.6503, label: cities.tokyo } },
        { start: shanghai, end: singapore },
        { start: singapore, end: { lat: -33.8688, lng: 151.2093, label: cities.sydney } },
      ]}
    />
  );
}
