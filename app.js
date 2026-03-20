const API_BASE      = 'https://smart-highway-traveller-assistance.onrender.com';
let OWM_KEY         = '';
const MARKER_COLORS = {
  fuel:     '#f6a623',
  food:     '#48bb78',
  hospital: '#fc5c65',
  rest:     '#a78bfa',
};
const BADGE_ICONS = {
  fuel:     '⛽',
  food:     '🍽️',
  hospital: '🏥',
  rest:     '🛋️',
};

// ─── Highway Routes (no Geocoder needed) ────────────
// Waypoints sampled every ~5 km along each highway
const HIGHWAYS = {
  'yamuna-expressway': {
    label:  'Yamuna Expressway — Greater Noida → Agra',
    color:  '#4f9ef8',
    bounds: { north: 28.54, south: 27.17, east: 77.70, west: 77.38 },
    points: [
      { lat: 28.5355, lng: 77.3910 }, // Greater Noida Pari Chowk (start)
      { lat: 28.4744, lng: 77.5040 }, // Jewar
      { lat: 28.3740, lng: 77.5620 }, // Tappal
      { lat: 28.2750, lng: 77.6030 }, // Mathura approach
      { lat: 28.1500, lng: 77.6350 },
      { lat: 28.0100, lng: 77.6550 },
      { lat: 27.8600, lng: 77.6680 },
      { lat: 27.7100, lng: 77.6730 },
      { lat: 27.5800, lng: 77.6690 },
      { lat: 27.4924, lng: 77.6737 }, // Agra (end)
    ],
  },
  'noida-greater-noida-expy': {
    label:  'Noida–Greater Noida Expressway',
    color:  '#48bb78',
    bounds: { north: 28.58, south: 28.46, east: 77.52, west: 77.30 },
    points: [
      { lat: 28.5706, lng: 77.3217 }, // Noida Sector 18
      { lat: 28.5550, lng: 77.3500 },
      { lat: 28.5350, lng: 77.3780 },
      { lat: 28.5150, lng: 77.4100 },
      { lat: 28.4980, lng: 77.4420 },
      { lat: 28.4744, lng: 77.5040 }, // Greater Noida Pari Chowk
    ],
  },
  'nh9-delhi-meerut': {
    label:  'NH-9 — Delhi → Meerut',
    color:  '#f6a623',
    bounds: { north: 28.98, south: 28.61, east: 77.72, west: 77.20 },
    points: [
      { lat: 28.6280, lng: 77.2200 }, // Delhi Anand Vihar
      { lat: 28.6411, lng: 77.3687 }, // Indirapuram
      { lat: 28.6692, lng: 77.4538 }, // Kaushambi NH-9
      { lat: 28.6820, lng: 77.4710 }, // Mohan Nagar
      { lat: 28.7120, lng: 77.5010 }, // Meerut approach
      { lat: 28.7900, lng: 77.5500 },
      { lat: 28.8600, lng: 77.5900 },
      { lat: 28.9800, lng: 77.7070 }, // Meerut city
    ],
  },
};

let map, userMarker, routePolyline, directionsRenderer;
let currentMarkers = [];
let currentResults = [];
let allResults     = [];
let activeFilter   = 'all';
let userLat        = null;
let userLng        = null;
let activeHighway  = null;

// ─── Map Initialisation ───────────────────────────────────────
function initMap() {
  const defaultCenter = { lat: 28.5706, lng: 77.3217 };

  map = new google.maps.Map(document.getElementById('map'), {
    center: defaultCenter,
    zoom: 12,
    mapTypeId: 'roadmap',
    disableDefaultUI: true,
    zoomControl: true,
    styles: DARK_MAP_STYLE,
  });

  directionsRenderer = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    polylineOptions: {
      strokeColor: '#4f9ef8',
      strokeWeight: 5,
      strokeOpacity: 0.8,
    },
  });
  directionsRenderer.setMap(map);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        map.setCenter({ lat: userLat, lng: userLng });
        map.setZoom(13);
        placeUserMarker(userLat, userLng);
        fetchRecommendations();
        fetchWeather(userLat, userLng);
      },
      () => {
        userLat = defaultCenter.lat;
        userLng = defaultCenter.lng;
        placeUserMarker(userLat, userLng);
        fetchRecommendations();
        fetchWeather(userLat, userLng);
        showToast('📍 Using default location (Noida Sector 18)');
      }
    );
  }

  updateClock();
  setInterval(updateClock, 1000);

  // Wire up highway selector
  document.getElementById('highway-select').addEventListener('change', function () {
    const key = this.value;
    if (!key) {
      clearHighway();
    } else {
      selectHighway(key);
    }
  });

  document.getElementById('clear-route-btn').addEventListener('click', clearHighway);
}

// ─── User Location Marker ─────────────────────────────────────
function placeUserMarker(lat, lng) {
  if (userMarker) userMarker.setMap(null);
  userMarker = new google.maps.Marker({
    position: { lat, lng },
    map,
    title: 'Your Location',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#4f9ef8',
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 3,
    },
    zIndex: 999,
  });
}

// ─── Highway Selection ────────
function selectHighway(key) {
  const highway = HIGHWAYS[key];
  if (!highway) return;
  activeHighway = key;

  // Remove old polyline
  if (routePolyline) routePolyline.setMap(null);
  directionsRenderer.setDirections({ routes: [] });

  // Draw polyline
  routePolyline = new google.maps.Polyline({
    path: highway.points,
    geodesic: true,
    strokeColor: highway.color,
    strokeWeight: 5,
    strokeOpacity: 0.85,
    map,
  });

  // Fit map to route
  const bounds = new google.maps.LatLngBounds();
  highway.points.forEach(p => bounds.extend(p));
  map.fitBounds(bounds, { padding: 60 });

  // Update route info badge
  document.getElementById('route-dest').textContent    = highway.label;
  document.getElementById('route-details').textContent =
    `${highway.points.length} waypoints · ${key === 'yamuna-expressway' ? '165 km' : key === 'noida-greater-noida-expy' ? '25 km' : '90 km'}`;
  document.getElementById('route-info').classList.add('visible');

  // Fetch filtered recommendations
  fetchRecommendations(highway.points);
  showToast(`🛣️ Showing services along ${highway.label.split('—')[0].trim()}`);
}

function clearHighway() {
  activeHighway = null;
  if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
  directionsRenderer.setDirections({ routes: [] });
  document.getElementById('route-info').classList.remove('visible');
  document.getElementById('highway-select').value = '';
  fetchRecommendations();
  showToast('🔄 Showing all nearby services');
}

// ─── Fetch Recommendations ────────────────────────────────────
async function fetchRecommendations(routePoints = null) {
  const hour = new Date().getHours();
  showSkeleton();

  let url = `${API_BASE}/recommend?lat=${userLat}&lng=${userLng}&time=${hour}`;
  if (routePoints && routePoints.length > 0) {
    // Sample every 2nd point to keep URL short
    const sampled = routePoints.filter((_, i) => i % 2 === 0);
    url += `&route=${encodeURIComponent(JSON.stringify(sampled))}`;
  }

  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    allResults = data;
    applyFilter(activeFilter);
    clearMapMarkers();
    plotMarkers(data);
  } catch (err) {
    document.getElementById('cards-container').innerHTML = `
      <div id="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Could not reach the API server.<br/>Make sure <strong>node server.js</strong> is running.</p>
      </div>`;
    console.error('Recommend API error:', err);
  }
}

function showSkeleton() {
  const container = document.getElementById('cards-container');
  container.innerHTML = Array(5).fill(0).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-line" style="height:14px;width:70%;margin-bottom:10px;"></div>
      <div class="skeleton-line" style="height:10px;width:40%;margin-bottom:6px;"></div>
      <div class="skeleton-line" style="height:10px;width:55%;"></div>
    </div>`).join('');
}

function renderCards(results) {
  const container = document.getElementById('cards-container');

  if (!results || results.length === 0) {
    container.innerHTML = `
      <div id="empty-state">
        <div class="empty-icon">🔍</div>
        <p>No services found along this route.<br/>Try a different highway or clear the route.</p>
      </div>`;
    return;
  }

  container.innerHTML = results.map((place, i) => `
    <div class="result-card" data-id="${place.id}" data-type="${place.type}"
         onclick="highlightCard(${place.id}); panToMarker(${place.id});"
         style="animation-delay:${i * 60}ms">
      <div class="card-top">
        <div class="card-name">${BADGE_ICONS[place.type]} ${place.name}</div>
        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
          <div class="card-score" title="Score = (1/distance) × rating × time bonus">${Math.round(place.score * 1000)} pts</div>
          <span class="card-badge badge-${place.type}">${place.type}</span>
          <div class="card-rank">#${i + 1}</div>
        </div>
      </div>
      <div class="card-meta">
        <div class="card-distance">📍 ${place.distance_km} km away</div>
        <div class="card-stars">${renderStars(place.rating)}<span style="margin-left:4px;color:var(--text-secondary)">${place.rating}</span></div>
      </div>
      <div class="card-address">${place.address}</div>
    </div>`).join('');
}

function renderStars(rating) {
  const full  = Math.floor(rating);
  const empty = 5 - full;
  return '★'.repeat(full).split('').map(s => `<span class="star">${s}</span>`).join('')
    + '★'.repeat(empty).split('').map(s => `<span class="star-empty">${s}</span>`).join('');
}

// ─── Filter Chips ─────────────────────────────────────────────
function applyFilter(type) {
  activeFilter = type;
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.type === type);
  });
  currentResults = type === 'all' ? allResults : allResults.filter(p => p.type === type);
  renderCards(currentResults);
}

window.filterBy = (type) => applyFilter(type);

// ─── Map Markers ──────────────────────────────────────────────
function plotMarkers(places) {
  places.forEach((place) => {
    const svgIcon = {
      path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z',
      fillColor: MARKER_COLORS[place.type],
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 1.5,
      scale: 1.8,
      anchor: new google.maps.Point(12, 22),
    };

    const marker = new google.maps.Marker({
      position: { lat: place.lat, lng: place.lng },
      map,
      title: place.name,
      icon: svgIcon,
      animation: google.maps.Animation.DROP,
    });

    marker.placeId = place.id;

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="font-family:'Outfit',sans-serif;padding:4px 2px;min-width:160px;">
          <strong style="font-size:13px;">${place.name}</strong><br/>
          <span style="font-size:11px;color:#555;">${place.type.toUpperCase()} · ${place.distance_km} km · ★ ${place.rating}</span><br/>
          <span style="font-size:11px;color:#888;">${place.address}</span>
        </div>`,
    });

    marker.addListener('click', () => {
      currentMarkers.forEach(m => { if (m._iw) m._iw.close(); });
      infoWindow.open({ map, anchor: marker });
      marker._iw = infoWindow;
      highlightCard(place.id);
    });

    marker._iw = null;
    currentMarkers.push(marker);
  });
}

function clearMapMarkers() {
  currentMarkers.forEach(m => {
    if (m._iw) m._iw.close();
    m.setMap(null);
  });
  currentMarkers = [];
}

// ─── Card / Marker Interaction ────────────────────────────────
function highlightCard(id) {
  document.querySelectorAll('.result-card').forEach(card => {
    card.classList.toggle('highlighted', parseInt(card.dataset.id) === id);
  });
  const el = document.querySelector(`.result-card[data-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function panToMarker(id) {
  const marker = currentMarkers.find(m => m.placeId === id);
  if (marker) {
    map.panTo(marker.getPosition());
    google.maps.event.trigger(marker, 'click');
  }
}

window.highlightCard = highlightCard;
window.panToMarker   = panToMarker;

// ─── Weather ──────────────────────────────────────────────────
async function fetchWeather(lat, lng) {
  try {
    const res  = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${OWM_KEY}`
    );
    const data = await res.json();

    if (data.cod !== 200) throw new Error('OWM error');
    const temp = Math.round(data.main.temp);
    const desc = data.weather[0].description;
    const city = `${data.name}, ${data.sys.country}`;
    document.getElementById('weather-icon').textContent = getWeatherEmoji(data.weather[0].id);
    document.getElementById('weather-temp').textContent = `${temp}°C`;
    document.getElementById('weather-city').textContent = city;
    document.getElementById('weather-desc').textContent = desc.charAt(0).toUpperCase() + desc.slice(1);
  } catch (err) {
    document.getElementById('weather-icon').textContent = '🌤️';
    document.getElementById('weather-temp').textContent = '--°C';
    document.getElementById('weather-city').textContent = 'Noida, IN';
    document.getElementById('weather-desc').textContent = 'Weather unavailable';
  }
}

function getWeatherEmoji(id) {
  if (id >= 200 && id < 300) return '⛈️';
  if (id >= 300 && id < 400) return '🌦️';
  if (id >= 500 && id < 600) return '🌧️';
  if (id >= 600 && id < 700) return '❄️';
  if (id >= 700 && id < 800) return '🌫️';
  if (id === 800)             return '☀️';
  if (id > 800)               return '⛅';
  return '🌤️';
}

// ─── Clock ────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clock-display').textContent = `${hh}:${mm}`;
}

// ─── Toast ────────────────────────────────────────────────────
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── Dark Map Style ───────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1c2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#8b96a8' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#181e2a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3044' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1f35' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3d4a6a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2741' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];

// ─── App Initialization ─────────────────────────────────────────
async function initializeApp() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    const config = await res.json();
    OWM_KEY = config.WEATHER_API_KEY;

    // Dynamically load Google Maps script
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${config.GCP_API_KEY}&libraries=places,marker&loading=async&callback=initMap`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  } catch (err) {
    console.error('Failed to load configuration:', err);
    document.getElementById('cards-container').innerHTML = `
      <div id="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Could not load configuration.<br/>Make sure your .env file is set and the server is running.</p>
      </div>`;
  }
}

// Start the app
initializeApp();