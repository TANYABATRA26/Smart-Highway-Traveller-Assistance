const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

require('dotenv').config();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Haversine Distance Formula ───────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

// ─── Time Bonus Logic ─────────────────────────────────────────────────────────
function getTimeBonus(type, hour) {
  if (type === 'fuel' && hour >= 6 && hour <= 10) return 1.5;
  if (type === 'food' && hour >= 12 && hour <= 14) return 2.0;
  if (type === 'hospital') return 1.0; // always neutral (hospitals handled separately)
  return 1.0;
}

// ─── Route Proximity Filter ───────────────────────────────────────────────────
// routePoints: array of {lat, lng} along the route path
// Returns true if the place is within thresholdKm of ANY point on the route
function isNearRoute(place, routePoints, thresholdKm = 10) {
  if (!routePoints || routePoints.length === 0) return true; // no route = no filter
  return routePoints.some(
    (pt) => haversine(place.lat, place.lng, pt.lat, pt.lng) <= thresholdKm
  );
}

// ─── Main Recommendation Endpoint ────────────────────────────────────────────
// GET /recommend?lat=28.6&lng=77.2&time=13
// Optional: &route=[{"lat":..,"lng":..}, ...] (JSON-encoded array)
app.get('/recommend', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const hour = parseInt(req.query.time, 10) || new Date().getHours();

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query params are required.' });
  }

  // Parse optional route points
  let routePoints = null;
  if (req.query.route) {
    try {
      routePoints = JSON.parse(req.query.route);
    } catch (e) {
      // ignore malformed route param
    }
  }

  const places = JSON.parse(fs.readFileSync(path.join(__dirname, 'places.json'), 'utf8'));

  // Filter by route proximity if route is provided
  const candidates = places.filter((p) => isNearRoute(p, routePoints));

  // Score each candidate
  const scored = candidates.map((place) => {
    const distKm = haversine(lat, lng, place.lat, place.lng);
    const timeBonus = getTimeBonus(place.type, hour);
    const score = (1 / (distKm + 0.1)) * place.rating * timeBonus;

    return {
      ...place,
      distance_km: Math.round(distKm * 10) / 10,
      score: Math.round(score * 1000) / 1000,
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Ensure at least one hospital in top 3 (safety guarantee)
  const top5 = guaranteeHospitalInTop3(scored);

  res.json(top5);
});

// ─── Hospital Guarantee Rule ──────────────────────────────────────────────────
function guaranteeHospitalInTop3(sorted) {
  const top3 = sorted.slice(0, 3);
  const hasHospital = top3.some((p) => p.type === 'hospital');

  if (!hasHospital) {
    // Find the best-scored hospital in the full list
    const bestHospital = sorted.find((p) => p.type === 'hospital');
    if (bestHospital) {
      // Insert hospital at position 2 (index 2), push others down
      sorted = sorted.filter((p) => p.id !== bestHospital.id);
      sorted.splice(2, 0, bestHospital);
    }
  }

  return sorted.slice(0, 5);
}

// ─── Frontend Configuration ─────────────────────────────────────────────────────
app.get('/config', (req, res) => {
  res.json({
    WEATHER_API_KEY: process.env.WEATHER_API_KEY,
    GCP_API_KEY: process.env.GCP_API_KEY,
  });
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Smart Highway Traveller API running.' });
});

app.listen(PORT, () => {
  console.log(`\n🚗 Smart Highway Traveller API`);
  console.log(`   Server running at http://localhost:${PORT}`);
  console.log(`   Endpoint: GET /recommend?lat=28.57&lng=77.32&time=13\n`);
});
