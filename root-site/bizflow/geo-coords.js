// Port of backend app/coordinate_transform.py; Hong Kong stays unshifted.
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;
const HONG_KONG_BOUNDARY = [[22.1969416960648, 113.838958740235], [22.1537034512515, 113.899383544922], [22.1543394041216, 114.259185791016], [22.1562472454872, 114.476165771485], [22.4021412473078, 114.483032226563], [22.5341221556096, 114.460372924805], [22.5620250647352, 114.441146850586], [22.5569522282241, 114.183654785157], [22.5639273303204, 114.158935546875], [22.5442693207795, 114.136276245118], [22.5341221556096, 114.110183715821], [22.5360248058869, 114.088211059571], [22.5296825363499, 114.077224731446], [22.5214371505615, 114.073791503907], [22.5176314219237, 114.061431884766], [22.5081166418536, 114.056625366211], [22.5043105464718, 114.051818847657], [22.5062136072577, 114.030532836915], [22.510653980572, 114.003067016602], [22.4218194474714, 113.891143798829], [22.4059501487257, 113.869171142579], [22.213470449827, 113.82179260254]];

function inHongKong(latitude, longitude) {
  let inside = false;
  let previous = HONG_KONG_BOUNDARY.length - 1;
  for (let current = 0; current < HONG_KONG_BOUNDARY.length; current++) {
    const [lat, lng] = HONG_KONG_BOUNDARY[current];
    const [prevLat, prevLng] = HONG_KONG_BOUNDARY[previous];
    if ((lng < longitude && longitude <= prevLng) || (prevLng < longitude && longitude <= lng)) {
      if (lat + (longitude - lng) / (prevLng - lng) * (prevLat - lat) < latitude) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

export function wgs84ToGcj02(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [latitude, longitude];
  if (!(72.004 <= longitude && longitude <= 137.8347 && 0.8293 <= latitude && latitude <= 55.8271) || inHongKong(latitude, longitude)) return [latitude, longitude];
  const lat = latitude - 35;
  const lng = longitude - 105;
  let dlat = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  dlat += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  dlat += (20 * Math.sin(lat * PI) + 40 * Math.sin(lat / 3 * PI)) * 2 / 3;
  dlat += (160 * Math.sin(lat / 12 * PI) + 320 * Math.sin(lat * PI / 30)) * 2 / 3;
  let dlng = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  dlng += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  dlng += (20 * Math.sin(lng * PI) + 40 * Math.sin(lng / 3 * PI)) * 2 / 3;
  dlng += (150 * Math.sin(lng / 12 * PI) + 300 * Math.sin(lng / 30 * PI)) * 2 / 3;
  const radians = latitude / 180 * PI;
  const magic = 1 - EE * Math.sin(radians) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  dlat = dlat * 180 / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dlng = dlng * 180 / (A / sqrtMagic * Math.cos(radians) * PI);
  return [latitude + dlat, longitude + dlng];
}
