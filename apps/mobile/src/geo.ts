/** Same haversine the server uses, so the app and the API never disagree. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = p2 - p1;
  const dl = toRad(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** PROVISIONAL - from a map pin, not yet confirmed on site. */
export const OFFICE = {
  name: 'IIMA Ventures, Ahmedabad',
  lat: 23.03479,
  lng: 72.53238,
  radiusM: 200,
};
