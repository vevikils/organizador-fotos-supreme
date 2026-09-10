// server/geocoder.js
const CITIES = [
  // España
  { name: 'Madrid', region: 'Comunidad de Madrid', country: 'España', lat: 40.4168, lon: -3.7038 },
  { name: 'Barcelona', region: 'Cataluña', country: 'España', lat: 41.3851, lon: 2.1734 },
  { name: 'Valencia', region: 'Comunitat Valenciana', country: 'España', lat: 39.4699, lon: -0.3763 },
  { name: 'Sevilla', region: 'Andalucía', country: 'España', lat: 37.3891, lon: -5.9845 },
  { name: 'Zaragoza', region: 'Aragón', country: 'España', lat: 41.6488, lon: -0.8891 },
  { name: 'Málaga', region: 'Andalucía', country: 'España', lat: 36.7213, lon: -4.4214 },
  { name: 'Murcia', region: 'Región de Murcia', country: 'España', lat: 37.9922, lon: -1.1307 },
  { name: 'Palma', region: 'Islas Baleares', country: 'España', lat: 39.5696, lon: 2.6502 },
  { name: 'Las Palmas de Gran Canaria', region: 'Canarias', country: 'España', lat: 28.1235, lon: -15.4363 },
  { name: 'Bilbao', region: 'País Vasco', country: 'España', lat: 43.2630, lon: -2.9350 },
  { name: 'Alicante', region: 'Comunitat Valenciana', country: 'España', lat: 38.3452, lon: -0.4810 },
  { name: 'Córdoba', region: 'Andalucía', country: 'España', lat: 37.8882, lon: -4.7794 },
  { name: 'Valladolid', region: 'Castilla y León', country: 'España', lat: 41.6523, lon: -4.7245 },
  { name: 'Vigo', region: 'Galicia', country: 'España', lat: 42.2406, lon: -8.7207 },
  { name: 'Gijón', region: 'Asturias', country: 'España', lat: 43.5357, lon: -5.6615 },
  { name: 'A Coruña', region: 'Galicia', country: 'España', lat: 43.3623, lon: -8.4115 },
  { name: 'Granada', region: 'Andalucía', country: 'España', lat: 37.1773, lon: -3.5986 },
  { name: 'Santa Cruz de Tenerife', region: 'Canarias', country: 'España', lat: 28.4636, lon: -16.2518 },
  { name: 'Ibiza', region: 'Islas Baleares', country: 'España', lat: 38.9067, lon: 1.4206 },
  { name: 'Toledo', region: 'Castilla-La Mancha', country: 'España', lat: 39.8628, lon: -4.0273 },
  // Europa y Mundo
  { name: 'París', region: 'Île-de-France', country: 'Francia', lat: 48.8566, lon: 2.3522 },
  { name: 'Londres', region: 'Inglaterra', country: 'Reino Unido', lat: 51.5074, lon: -0.1278 },
  { name: 'Roma', region: 'Lazio', country: 'Italia', lat: 41.9028, lon: 12.4964 },
  { name: 'Berlín', region: 'Berlín', country: 'Alemania', lat: 52.5200, lon: 13.4050 },
  { name: 'Lisboa', region: 'Lisboa', country: 'Portugal', lat: 38.7223, lon: -9.1393 },
  { name: 'Ámsterdam', region: 'Holanda', country: 'Países Bajos', lat: 52.3676, lon: 4.9041 },
  { name: 'Nueva York', region: 'NY', country: 'Estados Unidos', lat: 40.7128, lon: -74.0060 },
  { name: 'Ciudad de México', region: 'CDMX', country: 'México', lat: 19.4326, lon: -99.1332 },
  { name: 'Buenos Aires', region: 'CABA', country: 'Argentina', lat: -34.6037, lon: -58.3816 },
  { name: 'Tokio', region: 'Kantō', country: 'Japón', lat: 35.6762, lon: 139.6503 }
];

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function reverseGeocode(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) {
    return null;
  }
  let closest = null;
  let minDist = Infinity;
  for (const c of CITIES) {
    const d = calculateDistance(latitude, longitude, c.lat, c.lon);
    if (d < minDist) {
      minDist = d;
      closest = c;
    }
  }
  if (!closest) return null;
  return {
    city: closest.name,
    region: closest.region,
    country: closest.country,
    location_name: minDist <= 80 ? `${closest.name}, ${closest.country}` : `${closest.region}, ${closest.country}`,
    distanceKm: Math.round(minDist)
  };
}

module.exports = { reverseGeocode, CITIES };
