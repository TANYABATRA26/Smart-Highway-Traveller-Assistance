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

let map, userMarker, directionsRenderer;
let currentMarkers = [];
let currentResults = [];
let allResults     = [];
let activeFilter   = 'all';
let userLat        = null;
let userLng        = null;

// ─── Map Initialisation (called by Maps SDK callback) ─────────
function initMap() {
  const defaultCenter = { lat: 28.5706, lng: 77.3217 };

  map = new google.maps.Map(document.getElementById('map'), {
    center: defaultCenter,
    zoom: 13,
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

  // Get real user location
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

// ─── Fetch Recommendations ────────────────────────────────────
async function fetchRecommendations(routePoints = null) {
  const hour = new Date().getHours();
  showSkeleton();

  let url = `${API_BASE}/recommend?lat=${userLat}&lng=${userLng}&time=${hour}`;
  if (routePoints && routePoints.length > 0) {
    const sampled = routePoints.filter((_, i) => i % 5 === 0);
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
        <p>Could not reach the API server.<br/>Make sure <strong>node server.js</strong> is running on port 3000.</p>
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
        <p>No services found nearby.<br/>Try a different location or route.</p>
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
          <div class="card-score" title="Ranked by: (1 / distance_km) × rating × time context">${Math.round(place.score * 1000)} pts</div>
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

// ─── Map Markers (Standard Marker) ────────────────────────────
function plotMarkers(places) {
  places.forEach((place) => {
    // Custom SVG icon matching the previous aesthetic
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

// ─── Route Drawing ────────────────────────────────────────────
function drawRoute(destLat, destLng, destName) {
  const directionsService = new google.maps.DirectionsService();

  directionsService.route(
    {
      origin:      { lat: userLat, lng: userLng },
      destination: { lat: destLat, lng: destLng },
      travelMode:  google.maps.TravelMode.DRIVING,
    },
    (result, status) => {
      if (status === 'OK') {
        directionsRenderer.setDirections(result);

        const routePath = result.routes[0].overview_path.map(p => ({
          lat: p.lat(), lng: p.lng(),
        }));

        const totalDist = result.routes[0].legs[0].distance.text;
        const totalTime = result.routes[0].legs[0].duration.text;
        document.getElementById('route-dest').textContent    = destName || 'Destination';
        document.getElementById('route-details').textContent = `${totalDist} · ${totalTime}`;
        document.getElementById('route-info').classList.add('visible');

        fetchRecommendations(routePath);
        showToast('🗺️ Route drawn — showing services within 5 km of path');
      } else {
        showToast('❌ Could not draw route. Try a different destination.');
        console.error('Directions error:', status);
      }
    }
  );
}

// Go button
document.getElementById('go-btn').addEventListener('click', () => {
  const val = document.getElementById('destination-input').value.trim();
  if (!val) { showToast('🔍 Enter a destination first'); return; }

  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: val + ', India' }, (results, status) => {
    if (status === 'OK') {
      const loc = results[0].geometry.location;
      drawRoute(loc.lat(), loc.lng(), results[0].formatted_address);
    } else {
      showToast('❌ Destination not found. Try adding the state name.');
    }
  });
});

// Enter key
document.getElementById('destination-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('go-btn').click();
});

// Clear route
document.getElementById('clear-route-btn').addEventListener('click', () => {
  directionsRenderer.setDirections({ routes: [] });
  document.getElementById('route-info').classList.remove('visible');
  document.getElementById('destination-input').value = '';
  fetchRecommendations();
  showToast('🔄 Showing all nearby services');
});

// ─── Weather ──────────────────────────────────────────────────
async function fetchWeather(lat, lng) {
  try {
    const res  = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${OWM_KEY}`
    );
    const data = await res.json();

    if (data.cod !== 200) throw new Error('OWM error');

    const temp      = Math.round(data.main.temp);
    const desc      = data.weather[0].description;
    const city      = `${data.name}, ${data.sys.country}`;
    const weatherId = data.weather[0].id;

    document.getElementById('weather-icon').textContent = getWeatherEmoji(weatherId);
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