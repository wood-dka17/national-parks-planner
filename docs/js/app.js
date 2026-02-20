/* ===============================
   National Parks Planner — app.js
   Stable full rewrite (keeps features, fixes format/layout side-effects)
================================ */
"use strict";

/* ===============================
   CONFIG
================================ */
// Token + base path come from docs/js/config.js (single source of truth).
// See SECURITY.md for restriction requirements before deploying.
mapboxgl.accessToken = window.APP_CONFIG?.mapboxToken ?? "";

/* ===============================
   TRIP RULES MODEL
================================ */
const tripRules = {
  maxDriveHoursPerDay: 6,
  maxSingleLegHours: 10,
  breakMinutesPerDay: 0,
  startTimeHHMM: "08:00",   // kept for legacy / CSV export
  wakeHHMM: "08:00",        // earliest departure each day
  sleepHHMM: "20:00",       // latest arrival each day
  speedMph: 55,
  noBacktracking: false,     // penalise direction reversals during optimization
  travelMonth: 0,            // 0 = any; 1–12 = Jan–Dec
  filterClosedParks: true,   // hide/warn parks closed in travelMonth
  visitHoursPerPark: 1.5     // hours budgeted to explore each destination park
};

// Months (1-based) each park is typically fully or partially closed to road access.
// Empty array means year-round accessible. Source: NPS seasonal info.
const PARK_CLOSED_MONTHS = {
  acad: [],           badl: [],           bibe: [],           blca: [1,2,3,11,12],
  brca: [],           cave: [],           crla: [11,12,1,2],  cuva: [],
  dena: [10,11,12,1,2,3,4], drto: [],     ever: [],           gaar: [10,11,12,1,2,3],
  glac: [11,12,1,2,3], glba: [],          grca: [],           grte: [11,12,1,2],
  grba: [11,12,1,2],  grsa: [],           gumo: [],           hale: [],
  havo: [],           isro: [11,12,1,2,3,4,5], jotr: [],      katm: [10,11,12,1,2,3,4],
  kefj: [11,12,1,2,3], kova: [10,11,12,1,2,3,4,5], lacl: [10,11,12,1,2,3,4],
  lavo: [11,12,1,2],  mora: [11,12,1,2],  noca: [11,12,1,2],  olym: [],
  romo: [11,12,1,2],  seki: [11,12,1,2],  thro: [],           viis: [],
  voya: [4,5],        wrst: [10,11,12,1,2,3,4], yell: [11,12,1,2,3], yose: []
};

/* ===============================
   DATA LOADER (build-time static JSON)
================================ */
/**
 * Resolve a path under docs/data/ that works both locally and on GitHub Pages.
 * All asset fetches must go through this helper.
 */
function assetUrl(relPath) {
  const base = window.APP_CONFIG?.dataBase ?? "./data";
  return `${base}/${relPath}`;
}

// PARKS_DATA is populated by loadStaticData() before the map boots.
// It falls back to window.PARKS (the legacy parks.js bundle) so local dev
// still works even when docs/data/parks.json hasn't been built yet.
let PARKS_DATA = [];

/**
 * Load parks + stamp units from static JSON.
 * Falls back gracefully to the bundled window.PARKS / window.NPS_STAMPS if
 * the JSON files aren't present (e.g. first-time local dev before running
 * the build scripts).
 */
async function loadStaticData() {
  // ── parks ─────────────────────────────────────────────────────────────────
  try {
    const res = await fetch(assetUrl("parks.json"));
    if (res.ok) {
      const parks = await res.json();
      if (Array.isArray(parks) && parks.length) {
        PARKS_DATA = parks;
        console.info(`[data] Loaded ${parks.length} parks from parks.json`);
      }
    }
  } catch { /* fall through to bundled fallback */ }

  if (!PARKS_DATA.length && Array.isArray(window.PARKS) && window.PARKS.length) {
    PARKS_DATA = window.PARKS;
    console.info("[data] Using bundled parks.js (parks.json not found)");
  }

  // ── stamp units ───────────────────────────────────────────────────────────
  try {
    const res = await fetch(assetUrl("units.json"));
    if (res.ok) {
      const units = await res.json();
      if (Array.isArray(units) && units.length) {
        window.NPS_STAMPS = units;
        console.info(`[data] Loaded ${units.length} stamp units from units.json`);
      }
    }
  } catch { /* fall through to bundled nps-stamps.js */ }

  if (!Array.isArray(window.NPS_STAMPS) || !window.NPS_STAMPS.length) {
    console.info("[data] Using bundled nps-stamps.js (units.json not found)");
  }
}

/* ===============================
   STATE
================================ */
let selectedParks = []; // [{ id, name, coords:[lon,lat], locked:boolean }]
let currentLegs = [];   // [{ fromId,toId, fromName,toName, miles, hours, geometry }]
let selectedLegIndex = null;
let dayPlan = [];
let lastOptimizeSummary = null;

let map = null;
let markersById = new Map();
let labelsById = new Map();

let routeRequestController = null;
let routeUpdateTimer = null;

let originPoint  = null;  // { lngLat: [lon, lat], label: string } | null
let originMarker = null;  // mapboxgl.Marker instance | null

/* ===============================
   DOM (assigned in boot)
================================ */
let clearBtn,
  optimizeToggle,
  roundTripToggle,
  itineraryListEl,
  totalMilesEl,
  totalHoursEl,
  totalDaysEl,
  longestLegEl,
  violationsEl,
  optSummaryEl,
  exportCsvBtn,
  copyBriefBtn,
  modePlannerBtn,
  modeDayByDayBtn,
  plannerViewEl,
  dayByDayViewEl,
  startTimeEl,
  maxHoursEl,
  maxLegHoursEl,
  breakMinsEl,
  speedMphEl,
  autoScheduleBtn;

let statusModeEl, statusTripEl, statusCountEl;

/* ===============================
   BASICS / GUARDS
================================ */
function ensureBasics() {
  if (!PARKS_DATA.length) {
    console.error("No parks data found. parks.js must set window.PARKS = [...]");
    return false;
  }
  if (typeof turf === "undefined") {
    console.error("Turf.js not loaded. Turf must load before app.js.");
    return false;
  }
  return true;
}

function ensureRouteSources() {
  return !!map?.getSource("route") && !!map?.getSource("route-highlight");
}

/* ===============================
   HELPERS
================================ */
function emptyLineStringFeature() {
  return { type: "Feature", geometry: { type: "LineString", coordinates: [] } };
}

function setGeoJSON(sourceId, feature) {
  const src = map?.getSource(sourceId);
  if (!src) return;
  src.setData(feature);
}

function setRoutingState(isRouting) {
  document.body.classList.toggle("is-routing", !!isRouting);
}

function debounceRouteUpdate(ms = 160) {
  window.clearTimeout(routeUpdateTimer);
  routeUpdateTimer = window.setTimeout(() => {
    // Avoid calling updateRoute before map sources exist
    if (!map || !ensureRouteSources()) return;
    updateRoute();
  }, ms);
}

function fmt(n, digits = 1) {
  return Number.isFinite(n) ? Number(n).toFixed(digits) : "—";
}

/* Park closure helper */
function isParkClosedInMonth(parkCode, month) {
  if (!month || !parkCode) return false;
  return (PARK_CLOSED_MONTHS[parkCode] ?? []).includes(month);
}

/* Compass bearing (degrees) from point a to point b — [lon,lat] arrays */
function bearingBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/* Angular difference between two bearings (0–180) */
function bearingDiff(b1, b2) {
  const d = Math.abs(b1 - b2) % 360;
  return d > 180 ? 360 - d : d;
}

/* Time helpers */
function hhmmToMins(hhmm) {
  const [h, m] = String(hhmm || "08:00").split(":").map(Number);
  return (Number.isFinite(h) ? h : 8) * 60 + (Number.isFinite(m) ? m : 0);
}
function minsToHHMM(mins) {
  const mm = Math.max(0, Math.round(mins));
  const hh = String(Math.floor(mm / 60)).padStart(2, "0");
  const m = String(mm % 60).padStart(2, "0");
  return `${hh}:${m}`;
}

/* ===============================
   CORE GEOMETRY / ROUTING
================================ */
function milesBetween(a, b) {
  return turf.distance(turf.point(a), turf.point(b), { units: "miles" });
}

/**
 * Build legs from stops.
 * If roundTrip is ON, include last -> first leg.
 */
function buildLegs(orderedStops, roundTripOn) {
  currentLegs = [];
  if (!Array.isArray(orderedStops) || orderedStops.length < 2) return;

  const stopsForLegs = roundTripOn ? [...orderedStops, orderedStops[0]] : [...orderedStops];

  for (let i = 0; i < stopsForLegs.length - 1; i++) {
    const from = stopsForLegs[i];
    const to = stopsForLegs[i + 1];

    const miles = milesBetween(from.coords, to.coords);
    const hours = miles / Math.max(1, tripRules.speedMph);

    currentLegs.push({
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      miles,
      hours,
      geometry: { type: "LineString", coordinates: [] } // filled later
    });
  }
}

/**
 * Fetch a route LineString using Mapbox Directions if possible.
 * Always returns a fallback straight-line geometry on failure.
 * @returns {{ geometry: GeoJSON.LineString|null }}
 */
async function fetchDirectionsGeometry(orderedStops, roundTripOn) {
  if (!orderedStops || orderedStops.length < 2) return { geometry: null };

  const stopsForRoute = roundTripOn ? [...orderedStops, orderedStops[0]] : [...orderedStops];
  const fallbackGeom  = {
    type: "LineString",
    coordinates: stopsForRoute.map((s) => s.coords)
  };

  // Mapbox Directions v5 accepts at most 25 waypoints
  if (stopsForRoute.length > 25) {
    console.warn("fetchDirectionsGeometry: too many waypoints (>25), using straight-line fallback");
    return { geometry: fallbackGeom };
  }

  try {
    const coords = stopsForRoute.map((s) => s.coords.join(",")).join(";");
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
      `?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

    const res = await fetch(url, { signal: routeRequestController?.signal });
    if (!res.ok) return { geometry: fallbackGeom };

    const json = await res.json();
    const geom = json?.routes?.[0]?.geometry;

    if (geom?.type === "LineString" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
      return { geometry: geom };
    }
    return { geometry: fallbackGeom };
  } catch {
    return { geometry: fallbackGeom };
  }
}

/**
 * Slice full route geometry into per-leg geometries for highlighting.
 */
function attachLegGeometriesFromRoute(fullGeometry, orderedStops, roundTripOn) {
  try {
    if (!fullGeometry || fullGeometry.type !== "LineString") return;
    if (!Array.isArray(fullGeometry.coordinates) || fullGeometry.coordinates.length < 2) return;
    if (!Array.isArray(orderedStops) || orderedStops.length < 2) return;
    if (!Array.isArray(currentLegs) || !currentLegs.length) return;

    const stopsForLegs = roundTripOn ? [...orderedStops, orderedStops[0]] : [...orderedStops];
    if (currentLegs.length !== stopsForLegs.length - 1) return;

    const line = turf.lineString(fullGeometry.coordinates);

    for (let i = 0; i < stopsForLegs.length - 1; i++) {
      const a = turf.point(stopsForLegs[i].coords);
      const b = turf.point(stopsForLegs[i + 1].coords);

      const aOn = turf.nearestPointOnLine(line, a);
      const bOn = turf.nearestPointOnLine(line, b);

      const sliced = turf.lineSlice(aOn, bOn, line);
      if (sliced?.geometry?.type === "LineString" && sliced.geometry.coordinates?.length) {
        currentLegs[i].geometry = sliced.geometry;
      } else {
        currentLegs[i].geometry = { type: "LineString", coordinates: [] };
      }
    }
  } catch (e) {
    console.warn("attachLegGeometriesFromRoute failed:", e);
  }
}

/* ===============================
   OPTIMIZATION
================================ */
/**
 * Nearest-neighbor route with optional no-backtracking penalty.
 * Respects locked stops by keeping them in their original indices.
 * Optional parks (mustSee === false) are included normally in ordering;
 * they may be dropped later by generateDayPlan if the day fills up.
 */
async function computeStopOrder() {
  const beforeOrder = selectedParks.map((s) => s.name);

  // Need at least 2 unlocked stops to optimize.
  // When an origin is set the effective trip has origin + N stops, so 2 stops
  // is enough to be worth optimizing; without an origin we need ≥3 stops.
  const minForOptimize = originPoint ? 2 : 3;
  if (!optimizeToggle?.checked || selectedParks.length < minForOptimize) {
    return { orderedStops: [...selectedParks], optimized: false, beforeOrder };
  }

  const lockedByIndex = new Map();
  selectedParks.forEach((p, idx) => {
    if (p.locked) lockedByIndex.set(idx, p);
  });

  const unlocked = selectedParks.filter((p) => !p.locked);
  if (unlocked.length <= 1) {
    return { orderedStops: [...selectedParks], optimized: false, beforeOrder };
  }

  const remaining = new Set(unlocked.map((p) => p.id));
  const byId = new Map(unlocked.map((p) => [p.id, p]));

  // Determine the greedy starting position for the nearest-neighbour sweep:
  // • If an origin is set, seed from the origin coordinates so the first stop
  //   picked is the one nearest the user's actual departure point.
  // • Otherwise fall back to the first unlocked stop as before.
  let seedCoords;
  let route = [];

  if (originPoint) {
    // All unlocked stops are candidates for the first pick — none pre-selected.
    seedCoords = originPoint.lngLat;
  } else {
    // No origin: pin selectedParks[0] (or first unlocked) as the starting stop.
    let start = selectedParks[0];
    if (start.locked) {
      start = selectedParks.find((p) => !p.locked) ?? start;
    }
    route.push(start);
    remaining.delete(start.id);
    seedCoords = start.coords;
  }

  // Greedy nearest-neighbour loop
  while (remaining.size) {
    const prevCoords = route.length >= 2 ? route[route.length - 2].coords : null;
    const lastCoords = route.length >= 1 ? route[route.length - 1].coords : seedCoords;
    const prevBearing = (route.length >= 2 && prevCoords)
      ? bearingBetween(prevCoords, lastCoords)
      : null;

    let best = null;
    let bestScore = Infinity;

    for (const id of remaining) {
      const cand = byId.get(id);
      let score = milesBetween(lastCoords, cand.coords);

      // No-backtracking: add a penalty proportional to how much this leg
      // reverses the current direction of travel (max 2× the leg distance).
      if (tripRules.noBacktracking && prevBearing !== null && score > 0) {
        const legBearing = bearingBetween(lastCoords, cand.coords);
        const diff = bearingDiff(prevBearing, legBearing); // 0–180
        const penalty = (diff / 180) * score; // up to 100% of distance
        score += penalty;
      }

      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    route.push(best);
    remaining.delete(best.id);
  }

  // Reinsert locked stops into original indices
  const rebuilt = new Array(selectedParks.length).fill(null);
  for (const [idx, p] of lockedByIndex.entries()) rebuilt[idx] = p;

  let r = 0;
  for (let i = 0; i < rebuilt.length; i++) {
    if (rebuilt[i]) continue;
    rebuilt[i] = route[r++];
  }

  return { orderedStops: rebuilt, optimized: true, beforeOrder };
}

/* ===============================
   LEG LABELS (midpoint drive-time badges on the map)
================================ */
/**
 * Build a readable "Xhr Ymin" string from decimal hours.
 * e.g. 2.25 → "2h 15m"
 */
function hoursToLabel(decimalHours) {
  const totalMins = Math.round(decimalHours * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Refresh the "leg-labels" GeoJSON source with midpoint features.
 * Called after legs are built and geometries attached.
 */
function updateLegLabels() {
  if (!map) return;

  const features = currentLegs
    .filter((leg) => leg.geometry?.coordinates?.length >= 2)
    .map((leg) => {
      const coords  = leg.geometry.coordinates;
      const midIdx  = Math.floor(coords.length / 2);
      const midPt   = coords[midIdx];
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: midPt },
        properties: { label: hoursToLabel(leg.hours) }
      };
    });

  setGeoJSON("leg-labels", { type: "FeatureCollection", features });
}

/* ===============================
   LEG HIGHLIGHTING
================================ */
function clearLegHighlight() {
  selectedLegIndex = null;

  document.querySelectorAll(".itin-row").forEach((el) => {
    el.classList.remove("is-selected");
    el.setAttribute("aria-selected", "false");
  });

  setGeoJSON("route-highlight", emptyLineStringFeature());
}

function highlightLeg(index) {
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= currentLegs.length) {
    clearLegHighlight();
    return;
  }

  selectedLegIndex = i;

  document.querySelectorAll(".itin-row").forEach((el) => {
    const isSel = Number(el.dataset.index) === i;
    el.classList.toggle("is-selected", isSel);
    el.setAttribute("aria-selected", String(isSel));
  });

  const leg = currentLegs[i];
  const geom = leg?.geometry?.type === "LineString" ? leg.geometry : null;

  setGeoJSON("route-highlight", geom?.coordinates?.length ? { type: "Feature", geometry: geom } : emptyLineStringFeature());
}

/* ===============================
   UI: STATUS / ACTIONS / VALIDATION
================================ */
function updateActionAvailability() {
  const hasRoute    = currentLegs.length > 0;
  const canOptimize = selectedParks.length >= 3;
  const canReverse  = selectedParks.length >= 2;

  if (optimizeToggle) optimizeToggle.disabled = !canOptimize;
  if (autoScheduleBtn) autoScheduleBtn.disabled = !hasRoute;
  if (exportCsvBtn) exportCsvBtn.disabled = !hasRoute;
  if (copyBriefBtn) copyBriefBtn.disabled = !hasRoute;

  const reverseBtn = document.getElementById("reverse-route");
  if (reverseBtn) reverseBtn.disabled = !canReverse;

  const pdfBtn = document.getElementById("export-pdf");
  if (pdfBtn) pdfBtn.disabled = !hasRoute;

  if (optimizeToggle) {
    optimizeToggle.title = canOptimize ? "Optimize route order" : "Select at least 3 parks to optimize";
  }
  if (autoScheduleBtn) {
    autoScheduleBtn.title = hasRoute ? "Generate day-by-day plan" : "Create a route first";
  }
}

function validateRules() {
  if (!maxLegHoursEl) return;

  if (tripRules.maxSingleLegHours > tripRules.maxDriveHoursPerDay) {
    maxLegHoursEl.classList.add("is-warning");
    maxLegHoursEl.title = "Max single-leg hours should not exceed max hours per day";
  } else {
    maxLegHoursEl.classList.remove("is-warning");
    maxLegHoursEl.title = "";
  }
}

function renderStatus() {
  const isOptimized = !!optimizeToggle?.checked;
  const isRoundTrip = !!roundTripToggle?.checked;

  if (statusModeEl) statusModeEl.textContent = isOptimized ? "Optimized" : "Manual";
  if (statusTripEl) statusTripEl.textContent = isRoundTrip ? "Round trip" : "One-way";

  // IMPORTANT: HTML already prints "parks" next to the number in many layouts.
  // So we set ONLY the number here (prevents "0 parks parks").
  if (statusCountEl) statusCountEl.textContent = String(selectedParks.length);
}

/* ===============================
   MARKERS (numbered)
================================ */
function ensureMarkers() {
  PARKS_DATA.forEach((p, i) => {
    const id = i;
    if (markersById.has(id)) return;

    const el = document.createElement("div");
    el.className = "park-marker";
    el.style.display = "none";

    const badge = document.createElement("div");
    badge.className = "park-marker__badge";
    el.appendChild(badge);

    const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([p.lon, p.lat])
      .addTo(map);

    markersById.set(id, marker);
    labelsById.set(id, badge);
  });
}

function updateMarkerNumbers() {
  for (const [id, marker] of markersById.entries()) {
    const el = marker.getElement();
    el.style.display = "none";
    el.classList.remove("is-locked");
    const badge = labelsById.get(id);
    if (badge) badge.textContent = "";
  }

  selectedParks.forEach((p, idx) => {
    const marker = markersById.get(p.id);
    const badge = labelsById.get(p.id);
    if (!marker || !badge) return;

    const el = marker.getElement();
    el.style.display = "grid";
    badge.textContent = String(idx + 1);
    el.classList.toggle("is-locked", !!p.locked);
  });
}

/* ===============================
   VIOLATIONS / SUMMARY
================================ */
function computeViolations(legs) {
  const issues = [];
  const maxLeg = tripRules.maxSingleLegHours;

  if (!legs.length) return issues;

  // Wake/sleep window
  const wakeMins  = hhmmToMins(tripRules.wakeHHMM  || "08:00");
  const sleepMins = hhmmToMins(tripRules.sleepHHMM || "20:00");
  const breakMins = tripRules.breakMinutesPerDay || 0;
  const windowMins = Math.min(
    Math.max(0, sleepMins - wakeMins - breakMins),
    tripRules.maxDriveHoursPerDay * 60
  );
  const windowHours = windowMins / 60;

  // Longest single leg
  const longest = legs.reduce((m, l) => Math.max(m, l.hours || 0), 0);
  if (longest > maxLeg) {
    issues.push({
      type: "leg",
      text: `Longest leg is ${fmt(longest)} hrs, exceeds your ${fmt(maxLeg)} hr single-leg limit.`
    });
  }

  // Leg exceeds the daily driving window
  if (longest > windowHours) {
    issues.push({
      type: "window",
      text: `A leg (${fmt(longest)} hrs) exceeds your ${tripRules.wakeHHMM}–${tripRules.sleepHHMM} driving window of ${fmt(windowHours)} hrs.`
    });
  }

  // Total trip length
  const totalHours = legs.reduce((s, l) => s + (l.hours || 0), 0);
  const requiredDays = Math.max(1, Math.ceil(totalHours / Math.max(0.1, windowHours)));
  if (requiredDays >= 10) {
    issues.push({
      type: "days",
      text: `Trip requires ~${requiredDays} days. Consider raising max drive hours/day or reducing stops.`
    });
  }

  // Backtracking detection (when no-backtracking is OFF, still warn)
  if (legs.length >= 2) {
    let backtrackCount = 0;
    for (let i = 1; i < legs.length; i++) {
      const b1 = bearingBetween(
        selectedParks.find(p => p.id === legs[i-1].fromId)?.coords ?? [0,0],
        selectedParks.find(p => p.id === legs[i-1].toId)?.coords ?? [0,0]
      );
      const b2 = bearingBetween(
        selectedParks.find(p => p.id === legs[i].fromId)?.coords ?? [0,0],
        selectedParks.find(p => p.id === legs[i].toId)?.coords ?? [0,0]
      );
      if (bearingDiff(b1, b2) > 120) backtrackCount++;
    }
    if (backtrackCount > 0) {
      issues.push({
        type: "backtrack",
        text: `${backtrackCount} leg${backtrackCount > 1 ? "s" : ""} reverse direction significantly.${tripRules.noBacktracking ? " No-backtracking is ON and may help." : " Enable no-backtracking to reduce this."}`
      });
    }
  }

  // Seasonal closures
  if (tripRules.travelMonth) {
    const closedParks = selectedParks.filter((p) => {
      const park = PARKS_DATA[p.id];
      return park && isParkClosedInMonth(park.parkCode, tripRules.travelMonth);
    });
    closedParks.forEach((p) => {
      const monthName = new Date(2000, tripRules.travelMonth - 1).toLocaleString("default", { month: "long" });
      issues.push({
        type: "closed",
        text: `${p.name} may be closed or have limited access in ${monthName}.`
      });
    });
  }

  // Lock + round trip warning
  const lockedCount = selectedParks.filter((p) => p.locked).length;
  if (optimizeToggle?.checked && lockedCount > 0 && roundTripToggle?.checked) {
    issues.push({
      type: "lock",
      text: "Optimization with locked stops + round trip is constrained. Try one-way or unlock stops."
    });
  }

  return issues;
}

function renderViolations(issues) {
  if (!violationsEl) return;

  violationsEl.innerHTML = "";

  if (!issues.length) {
    violationsEl.innerHTML = `<div class="empty">No issues detected based on your rules.</div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "violations__list";

  issues.forEach((it) => {
    const row = document.createElement("div");
    row.className = "violations__item";
    if (it.type) row.dataset.type = it.type;
    row.innerHTML = `<div class="dot"></div><div class="txt">${it.text}</div>`;
    list.appendChild(row);
  });

  violationsEl.appendChild(list);
}

function renderSummary(legs) {
  if (!totalMilesEl || !totalHoursEl || !totalDaysEl || !longestLegEl) return;

  const totalMiles = legs.reduce((s, l) => s + (l.miles || 0), 0);
  const totalHours = legs.reduce((s, l) => s + (l.hours || 0), 0);
  const longest = legs.reduce((m, l) => Math.max(m, l.hours || 0), 0);

  totalMilesEl.textContent = `${fmt(totalMiles)} mi`;
  totalHoursEl.textContent = `${fmt(totalHours)} hr`;

  if (legs.length) {
    const days = Math.max(1, Math.ceil(totalHours / tripRules.maxDriveHoursPerDay));
    totalDaysEl.textContent = `${days} day(s)`;
    longestLegEl.textContent = `${fmt(longest)} hr`;
    longestLegEl.classList.toggle("is-bad", longest > tripRules.maxSingleLegHours);
  } else {
    totalDaysEl.textContent = "—";
    longestLegEl.textContent = "—";
    longestLegEl.classList.remove("is-bad");
  }
}

/* ===============================
   OPT SUMMARY UI
================================ */
function renderOptimizeSummary(summary) {
  if (!optSummaryEl) return;

  optSummaryEl.innerHTML = "";
  if (!summary) return;

  const el = document.createElement("div");
  el.className = "optcard";
  el.innerHTML = `
    <div class="optcard__title">Optimization Summary</div>
    <div class="optcard__grid">
      <div><span class="k">Miles (before)</span><span class="v">${fmt(summary.beforeMiles)} mi</span></div>
      <div><span class="k">Miles (after)</span><span class="v">${fmt(summary.afterMiles)} mi</span></div>
      <div><span class="k">Longest leg (before)</span><span class="v">${fmt(summary.beforeLongest)} hr</span></div>
      <div><span class="k">Longest leg (after)</span><span class="v">${fmt(summary.afterLongest)} hr</span></div>
    </div>
    <details class="optcard__order">
      <summary class="optcard__order-toggle">Stop order changes</summary>
      <div class="optcard__order-body mono">
        <div><span class="muted">Before:</span> ${summary.beforeOrder.join(" → ")}</div>
        <div style="margin-top:6px;"><span class="muted">After:</span> ${summary.afterOrder.join(" → ")}</div>
      </div>
    </details>
  `;
  optSummaryEl.appendChild(el);
}

/* ===============================
   ITINERARY UI
================================ */
function renderItinerary(legs) {
  if (!itineraryListEl) return;

  itineraryListEl.innerHTML = "";

  if (!legs.length) {
    itineraryListEl.innerHTML = `<div class="empty">Select at least two parks to build a route.</div>`;
    return;
  }

  legs.forEach((leg, i) => {
    const row = document.createElement("div");
    row.className = "itin-row";
    row.dataset.index = String(i);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-selected", "false");

    row.innerHTML = `
      <div class="itin-row__num">${i + 1}</div>
      <div class="itin-row__main">
        <div class="itin-row__leg">${leg.fromName} → ${leg.toName}</div>
      </div>
      <div class="itin-row__metrics">
        <div>${fmt(leg.miles)} mi</div>
        <div>${fmt(leg.hours)} hr</div>
      </div>
    `;

    itineraryListEl.appendChild(row);
  });
}

/* ===============================
   DAY PLAN
================================ */
/**
 * Build a day-by-day schedule from currentLegs, honouring:
 *  - Wake/sleep window  (available driving minutes per day)
 *  - Max driving hours/day cap
 *  - Break minutes/day
 *  - Must-see vs optional stops: if a leg's destination is optional and
 *    adding it would bust the day budget, it is skipped (noted in droppedOptional)
 *
 * Returns {plan, droppedOptional[]} and writes dayPlan.
 */
function generateDayPlan() {
  if (!currentLegs.length) {
    dayPlan = [];
    return { plan: [], droppedOptional: [] };
  }

  const wakeMins    = hhmmToMins(tripRules.wakeHHMM  || tripRules.startTimeHHMM || "08:00");
  const sleepMins   = hhmmToMins(tripRules.sleepHHMM || "20:00");
  const breakMins   = tripRules.breakMinutesPerDay || 0;
  const visitMins   = Math.round((tripRules.visitHoursPerPark || 0) * 60);

  // Total available time per day (capped by maxDriveHoursPerDay drive budget)
  // Drive budget does NOT include visit time — those are additive to the day.
  const driveBudgetMins = Math.min(
    Math.max(0, sleepMins - wakeMins - breakMins),
    tripRules.maxDriveHoursPerDay * 60
  );

  // Build a lookup: toId → mustSee flag (default true if not set)
  const mustSeeById = new Map(
    selectedParks.map((p) => [p.id, p.mustSee !== false])
  );

  let day = 1;
  let dayLegs = [];
  let dayDriveMins = 0;
  let dayMiles = 0;
  const plan = [];
  const droppedOptional = [];

  function pushDay() {
    if (!dayLegs.length) return;
    // endMins includes drive time, visit time at each intermediate park, and breaks
    const visitsInDay  = Math.max(0, dayLegs.length - 1); // visits at intermediate stops
    const totalEndMins = wakeMins + dayDriveMins + visitsInDay * visitMins + breakMins;
    plan.push({
      day,
      legs:       [...dayLegs],
      miles:      dayMiles,
      driveHours: dayDriveMins / 60,
      visitMins,          // store so renderDayPlan can show explore nodes
      startMins:  wakeMins,
      endMins:    totalEndMins
    });
    day++;
    dayLegs      = [];
    dayDriveMins = 0;
    dayMiles     = 0;
  }

  for (let i = 0; i < currentLegs.length; i++) {
    const leg     = currentLegs[i];
    const legMins = (leg.hours || 0) * 60;

    // Would adding this leg (+ a visit at the destination) exceed drive budget?
    if (dayLegs.length && dayDriveMins + legMins > driveBudgetMins) {
      const destIsMustSee = mustSeeById.get(leg.toId) !== false;
      if (!destIsMustSee) {
        droppedOptional.push(leg.toName);
        continue;
      }
      pushDay();
    }

    dayLegs.push(i);
    dayDriveMins += legMins;
    dayMiles     += leg.miles || 0;
  }

  pushDay();
  dayPlan = plan;
  return { plan, droppedOptional };
}

function renderDayPlan(plan, droppedOptional = []) {
  const container = document.getElementById("dayplan");
  if (!container) return;

  container.innerHTML = "";

  if (!plan.length) {
    container.innerHTML = `<div class="empty">Generate a route, then click "Generate day plan" to see a schedule.</div>`;
    return;
  }

  // Show dropped optional parks banner
  if (droppedOptional.length) {
    const banner = document.createElement("div");
    banner.className = "dayplan-notice";
    banner.innerHTML = `<span class="dayplan-notice__icon">ℹ</span> Optional stop${droppedOptional.length > 1 ? "s" : ""} skipped to fit your driving window: <strong>${droppedOptional.join(", ")}</strong>.`;
    container.appendChild(banner);
  }

  plan.forEach((d) => {
    const card = document.createElement("div");
    card.className = "daycard";

    // Build timed leg entries — walk a running clock through the day
    let clockMins = d.startMins;
    const timedRows = [];

    const visitMinutes = d.visitMins ?? 0;  // per-park visit budget from generateDayPlan
    const totalLegs = d.legs.length;

    d.legs.forEach((idx, legPos) => {
      const leg      = currentLegs[idx];
      const legMins  = Math.round((leg.hours || 0) * 60);
      const isLastLeg = legPos === totalLegs - 1;

      // First leg: show the departure location as a start node
      if (legPos === 0) {
        timedRows.push(
          `<div class="dayleg-node dayleg-node--start">` +
          `<span class="dayleg-node__time">${minsToHHMM(clockMins)}</span>` +
          `<span class="dayleg-node__name">${leg.fromName}</span>` +
          `</div>`
        );
        // Visit time at the starting park (if it's not the true origin)
        if (visitMinutes > 0 && legPos === 0 && totalLegs > 1) {
          timedRows.push(
            `<div class="dayleg-visit">` +
            `<span class="dayleg-visit__bar"></span>` +
            `<span class="dayleg-visit__label">Explore park (${hoursToLabel(visitMinutes / 60)})</span>` +
            `</div>`
          );
          clockMins += visitMinutes;
        }
      }

      const departAt = clockMins;
      const arriveAt = clockMins + legMins;
      clockMins = arriveAt;

      // Drive segment
      timedRows.push(
        `<div class="dayleg-drive">` +
        `<span class="dayleg-drive__bar"></span>` +
        `<span class="dayleg-drive__label">${fmt(leg.miles)} mi · ${fmt(leg.hours)} hr drive</span>` +
        `</div>`
      );

      // Arrival node
      timedRows.push(
        `<div class="dayleg-node dayleg-node--arrive">` +
        `<span class="dayleg-node__time">${minsToHHMM(arriveAt)}</span>` +
        `<span class="dayleg-node__name">${leg.toName}</span>` +
        `</div>`
      );

      // Visit time at this destination (not shown for the final stop of the day)
      if (visitMinutes > 0 && !isLastLeg) {
        timedRows.push(
          `<div class="dayleg-visit">` +
          `<span class="dayleg-visit__bar"></span>` +
          `<span class="dayleg-visit__label">Explore park (${hoursToLabel(visitMinutes / 60)})</span>` +
          `</div>`
        );
        clockMins += visitMinutes;
      }
    });

    card.innerHTML = `
      <div class="daycard__top">
        <div class="daycard__title">Day ${d.day}</div>
        <div class="daycard__meta">
          <span class="chip">${fmt(d.miles)} mi</span>
          <span class="chip">${fmt(d.driveHours)} hr drive</span>
          <span class="chip">${minsToHHMM(d.startMins)}–${minsToHHMM(d.endMins)}</span>
        </div>
      </div>
      <div class="daycard__body daycard__timeline">${timedRows.join("")}</div>
    `;

    container.appendChild(card);
  });
}

/* ===============================
   EXPORTS
================================ */
function exportDayPlanCSV() {
  if (!dayPlan.length) generateDayPlan();
  if (!dayPlan.length) return;

  const lines = [];
  lines.push(["Generated", new Date().toISOString()].join(","));
  lines.push(["MaxHoursPerDay", tripRules.maxDriveHoursPerDay].join(","));
  lines.push(["MaxSingleLegHours", tripRules.maxSingleLegHours].join(","));
  lines.push(["BreakMinutesPerDay", tripRules.breakMinutesPerDay].join(","));
  lines.push(["SpeedMph", tripRules.speedMph].join(","));
  lines.push("");
  lines.push(["Day", "Leg", "Depart", "From", "Arrive", "To", "Miles", "DriveHr"].join(","));

  dayPlan.forEach((d) => {
    let clockMins = d.startMins;
    d.legs.forEach((idx, legPos) => {
      const leg     = currentLegs[idx];
      const legMins = Math.round((leg.hours || 0) * 60);
      const departAt = clockMins;
      const arriveAt = clockMins + legMins;
      clockMins = arriveAt;

      const q = (s) => `"${String(s).replaceAll('"', '""')}"`;
      lines.push(
        [
          d.day,
          legPos + 1,
          minsToHHMM(departAt),
          q(leg.fromName),
          minsToHHMM(arriveAt),
          q(leg.toName),
          fmt(leg.miles),
          fmt(leg.hours)
        ].join(",")
      );
    });
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "national-parks-day-plan.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyTripBrief() {
  const totalMiles = currentLegs.reduce((s, l) => s + (l.miles || 0), 0);
  const totalHours = currentLegs.reduce((s, l) => s + (l.hours || 0), 0);
  const longest = currentLegs.reduce((m, l) => Math.max(m, l.hours || 0), 0);
  const days = currentLegs.length
    ? Math.max(1, Math.ceil(totalHours / tripRules.maxDriveHoursPerDay))
    : 0;

  const order = selectedParks
    .map((p, i) => `${i + 1}. ${p.name}${p.locked ? " (locked)" : ""}`)
    .join("\n");

  const issues = computeViolations(currentLegs).map((x) => `- ${x.text}`).join("\n") || "- None";

  const text = [
    "National Parks Planner — Trip Brief",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "Rules",
    `- Max driving hours/day: ${tripRules.maxDriveHoursPerDay}`,
    `- Max single-leg hours: ${tripRules.maxSingleLegHours}`,
    `- Break minutes/day: ${tripRules.breakMinutesPerDay}`,
    `- Speed (mph): ${tripRules.speedMph}`,
    "",
    "Summary",
    `- Total miles: ${fmt(totalMiles)} mi`,
    `- Total drive hours: ${fmt(totalHours)} hr`,
    `- Required days: ${days}`,
    `- Longest leg: ${fmt(longest)} hr`,
    "",
    "Order",
    order || "(none)",
    "",
    "Issues to Fix",
    issues
  ].join("\n");

  await navigator.clipboard.writeText(text);
}

function printTrip() {
  // Ensure day plan is generated (uses current legs)
  let plan = dayPlan;
  let droppedOptional = [];
  if (!plan.length && currentLegs.length) {
    const result = generateDayPlan();
    plan = result.plan;
    droppedOptional = result.droppedOptional;
  }

  const totalMiles = currentLegs.reduce((s, l) => s + (l.miles || 0), 0);
  const totalHours = currentLegs.reduce((s, l) => s + (l.hours || 0), 0);
  const builtAt    = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Build stops list HTML
  const stopsHtml = selectedParks.map((p, i) =>
    `<li>${i + 1}. ${p.name}${p.mustSee === false ? " <em>(optional)</em>" : ""}</li>`
  ).join("");

  // Build day plan HTML
  const dayPlanHtml = plan.map((d) => {
    let clockMins = d.startMins;
    const rows = [];

    d.legs.forEach((idx, legPos) => {
      const leg     = currentLegs[idx];
      const legMins = Math.round((leg.hours || 0) * 60);
      const departAt = clockMins;
      const arriveAt = clockMins + legMins;
      clockMins = arriveAt;

      if (legPos === 0) {
        rows.push(`<div class="pdf-node pdf-node--start"><span class="pdf-time">${minsToHHMM(departAt)}</span><span class="pdf-place">${leg.fromName}</span></div>`);
      }
      rows.push(`<div class="pdf-drive">↓ ${fmt(leg.miles)} mi · ${fmt(leg.hours)} hr drive</div>`);
      rows.push(`<div class="pdf-node"><span class="pdf-time">${minsToHHMM(arriveAt)}</span><span class="pdf-place">${leg.toName}</span></div>`);
    });

    return `
      <div class="pdf-day">
        <div class="pdf-day-header">
          Day ${d.day}
          <span class="pdf-day-meta">${fmt(d.miles)} mi · ${fmt(d.driveHours)} hr drive · ${minsToHHMM(d.startMins)}–${minsToHHMM(d.endMins)}</span>
        </div>
        <div class="pdf-timeline">${rows.join("")}</div>
      </div>`;
  }).join("");

  // Airport suggestion text
  const airportEl  = document.getElementById("airport-suggestion-content");
  const airportTxt = airportEl?.innerText?.trim() ?? "";
  const airportHtml = airportTxt
    ? `<section class="pdf-section"><h2>✈ Suggested Airports</h2><pre class="pdf-airports">${airportTxt}</pre></section>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>National Parks Trip — ${builtAt}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Georgia",serif;color:#111;background:#fff;padding:32px;max-width:720px;margin:auto;font-size:14px;line-height:1.6}
  h1{font-size:22px;font-weight:700;margin-bottom:4px}
  h2{font-size:15px;font-weight:700;margin:0 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
  .pdf-meta{color:#555;font-size:12px;margin-bottom:24px}
  .pdf-section{margin-bottom:28px}
  .pdf-summary-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:8px}
  .pdf-stat{border:1px solid #ddd;border-radius:6px;padding:10px 14px}
  .pdf-stat__label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em}
  .pdf-stat__value{font-size:18px;font-weight:700;color:#111}
  ol,ul{padding-left:18px}
  li{margin-bottom:3px}
  .pdf-day{border:1px solid #ddd;border-radius:8px;padding:14px 18px;margin-bottom:16px;page-break-inside:avoid}
  .pdf-day-header{font-weight:700;font-size:15px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:baseline}
  .pdf-day-meta{font-size:12px;color:#666;font-weight:400}
  .pdf-timeline{display:flex;flex-direction:column;gap:2px}
  .pdf-node{display:flex;align-items:baseline;gap:12px}
  .pdf-node--start .pdf-time{color:#888}
  .pdf-time{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;min-width:40px;text-align:right;color:#7700cc;flex-shrink:0}
  .pdf-place{font-size:13px;font-weight:600}
  .pdf-drive{font-size:11px;color:#888;margin-left:52px;padding:2px 0;font-style:italic}
  .pdf-airports{font-family:inherit;white-space:pre-wrap;font-size:13px;color:#333}
  .pdf-footer{margin-top:36px;border-top:1px solid #eee;padding-top:12px;font-size:11px;color:#aaa;text-align:center}
  @media print{
    body{padding:16px}
    .pdf-day{page-break-inside:avoid}
  }
</style>
</head>
<body>
<h1>National Parks Trip Itinerary</h1>
<p class="pdf-meta">Generated ${builtAt} · ${selectedParks.length} stops · ${fmt(totalMiles)} mi · ${fmt(totalHours)} hr total drive</p>

<section class="pdf-section">
  <h2>Trip Summary</h2>
  <div class="pdf-summary-grid">
    <div class="pdf-stat"><div class="pdf-stat__label">Total Miles</div><div class="pdf-stat__value">${fmt(totalMiles)} mi</div></div>
    <div class="pdf-stat"><div class="pdf-stat__label">Total Drive</div><div class="pdf-stat__value">${fmt(totalHours)} hr</div></div>
    <div class="pdf-stat"><div class="pdf-stat__label">Days</div><div class="pdf-stat__value">${plan.length || "—"}</div></div>
  </div>
</section>

<section class="pdf-section">
  <h2>Stops (${selectedParks.length})</h2>
  <ul>${stopsHtml}</ul>
</section>

${airportHtml}

<section class="pdf-section">
  <h2>Day-by-Day Schedule</h2>
  ${dayPlanHtml || "<p>Generate a day plan in the Day-by-Day tab first.</p>"}
</section>

<div class="pdf-footer">National Parks Planner · national-parks-planner.github.io</div>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to use Print / Save as PDF."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  // Small delay so browser fully renders before print dialog
  setTimeout(() => win.print(), 400);
}

/* ===============================
   FEATURE #8 — BUILD MY TRIP WIZARD
================================ */
/**
 * Regions → US states mapping for park filtering.
 * Each region maps to a set of state codes present in parks.json `state` field.
 */
const WIZARD_REGIONS = [
  { id: "northeast",   label: "Northeast",     emoji: "🍂", states: ["ME","NH","VT","MA","RI","CT","NY","NJ","PA","MD","DE","WV","VA"] },
  { id: "southeast",   label: "Southeast",     emoji: "🌴", states: ["NC","SC","GA","FL","AL","MS","TN","KY","AR","LA"] },
  { id: "midwest",     label: "Midwest",       emoji: "🌾", states: ["OH","MI","IN","WI","MN","IA","MO","ND","SD","NE","KS","IL"] },
  { id: "southwest",   label: "Southwest",     emoji: "🏜️",  states: ["TX","OK","NM","AZ","CO","UT"] },
  { id: "west",        label: "West",          emoji: "🏔️",  states: ["WY","MT","ID","WA","OR","CA","NV"] },
  { id: "alaska",      label: "Alaska & Hawaii", emoji: "🌋", states: ["AK","HI"] },
  { id: "anywhere",    label: "Anywhere in the US", emoji: "🗺️", states: [] },  // empty = all
];

let wizardState = { regionId: null, days: 7, selectedIds: new Set() };

function openWizard() {
  wizardState = { regionId: null, days: 7, selectedIds: new Set() };
  showWizardStep(1);
  document.getElementById("wizard-overlay")?.classList.remove("is-hidden");
  document.body.classList.add("wizard-open");

  // Render region buttons
  const regionContainer = document.getElementById("wizard-regions");
  if (regionContainer) {
    regionContainer.innerHTML = WIZARD_REGIONS.map((r) =>
      `<button class="wizard-region-btn" data-region="${r.id}" type="button">
        <span class="wizard-region-emoji">${r.emoji}</span>
        <span class="wizard-region-label">${r.label}</span>
      </button>`
    ).join("");

    regionContainer.querySelectorAll(".wizard-region-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        regionContainer.querySelectorAll(".wizard-region-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        wizardState.regionId = btn.dataset.region;
        const nextBtn = document.getElementById("wizard-next-1");
        if (nextBtn) nextBtn.disabled = false;
      });
    });
  }
}

function closeWizard() {
  document.getElementById("wizard-overlay")?.classList.add("is-hidden");
  document.body.classList.remove("wizard-open");
}

function showWizardStep(step) {
  [1, 2, 3].forEach((n) => {
    document.getElementById(`wizard-step-${n}`)?.classList.toggle("is-hidden", n !== step);
  });
}

function wizardGetFilteredParks() {
  const region = WIZARD_REGIONS.find((r) => r.id === wizardState.regionId);
  if (!region || region.states.length === 0) return PARKS_DATA;   // "anywhere"
  return PARKS_DATA.filter((p) => {
    const parkStates = (p.state || "").split(",").map((s) => s.trim());
    return parkStates.some((s) => region.states.includes(s));
  });
}

function renderWizardParks() {
  const filtered    = wizardGetFilteredParks();
  const days        = wizardState.days;
  const hint        = document.getElementById("wizard-step3-hint");
  const buildBtn    = document.getElementById("wizard-build");
  const listEl      = document.getElementById("wizard-park-list");

  // Rough suggestion: ~1 park per day as a guide, not a cap
  if (hint) hint.textContent = `${filtered.length} parks in this region — select the ones you'd like to visit (${days}-day trip).`;

  wizardState.selectedIds = new Set();
  if (buildBtn) buildBtn.disabled = true;

  if (!listEl) return;
  listEl.innerHTML = filtered.map((p) =>
    `<label class="wizard-park-row" data-id="${p.id}">
      <input type="checkbox" class="wizard-park-chk" data-id="${p.id}" />
      <span class="wizard-park-name">${p.name}</span>
      <span class="wizard-park-state">${p.state}</span>
    </label>`
  ).join("");

  listEl.querySelectorAll(".wizard-park-chk").forEach((chk) => {
    chk.addEventListener("change", () => {
      const id = Number(chk.dataset.id);
      if (chk.checked) wizardState.selectedIds.add(id);
      else wizardState.selectedIds.delete(id);
      if (buildBtn) buildBtn.disabled = wizardState.selectedIds.size < 1;
    });
  });
}

function wizardBuildTrip() {
  if (!wizardState.selectedIds.size) return;

  // Clear any existing route
  selectedParks.forEach((p) => {
    if (p.source !== "stamp") map?.setFeatureState({ source: "parks", id: p.id }, { selected: false });
  });
  selectedParks = [];
  currentLegs   = [];
  dayPlan       = [];

  // Add each selected park in PARKS_DATA order (geographic order approximates a sensible route)
  wizardState.selectedIds.forEach((id) => {
    const park = PARKS_DATA[id];
    if (!park) return;
    selectedParks.push({ id, name: park.name, coords: [park.lon, park.lat], locked: false, source: "park" });
    map?.setFeatureState({ source: "parks", id }, { selected: true });
  });

  // Set the trip days in maxDriveHoursPerDay as a sensible default
  // (wizard days → auto-schedule settings)
  tripRules.maxDriveHoursPerDay = Math.min(8, Math.max(4, 6));

  closeWizard();
  renderStopsList();
  updateMarkerNumbers();
  renderStatus();
  updateActionAvailability();
  debounceRouteUpdate(120);

  // Switch to planner view and auto-optimize if ≥3 parks
  setMode("planner");
  if (selectedParks.length >= 3 && optimizeToggle) {
    optimizeToggle.checked = true;
  }
}

function initWizard() {
  document.getElementById("open-wizard")?.addEventListener("click", openWizard);
  document.getElementById("wizard-close")?.addEventListener("click", closeWizard);
  document.getElementById("wizard-cancel")?.addEventListener("click", closeWizard);

  // Step 1 → 2
  document.getElementById("wizard-next-1")?.addEventListener("click", () => {
    if (!wizardState.regionId) return;
    wizardState.days = Number(document.getElementById("wizard-days")?.value || 7);
    showWizardStep(2);
  });

  // Step 2 → 3
  document.getElementById("wizard-next-2")?.addEventListener("click", () => {
    wizardState.days = Number(document.getElementById("wizard-days")?.value || 7);
    renderWizardParks();
    showWizardStep(3);
  });

  // Step 3 ← 2
  document.getElementById("wizard-back-2")?.addEventListener("click", () => showWizardStep(1));
  document.getElementById("wizard-back-3")?.addEventListener("click", () => showWizardStep(2));

  // Build
  document.getElementById("wizard-build")?.addEventListener("click", wizardBuildTrip);

  // Close on overlay backdrop click
  document.getElementById("wizard-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeWizard();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("wizard-overlay")?.classList.contains("is-hidden")) {
      closeWizard();
    }
  });
}

/* ===============================
   FEATURE #9 — CAMPGROUND LAYER
================================ */
let campgroundCache  = null;
let campgroundLoading = false;
let campgroundVisible = false;

function initCampgroundLayer() {
  if (!map) return;

  map.addSource("campgrounds", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 10,
    clusterRadius: 35
  });

  // Cluster circles
  map.addLayer({
    id: "campground-clusters",
    type: "circle",
    source: "campgrounds",
    filter: ["has", "point_count"],
    layout: { visibility: "none" },
    paint: {
      "circle-color": "#00b894",
      "circle-opacity": 0.75,
      "circle-radius": ["step", ["get", "point_count"], 12, 10, 18, 50, 24]
    }
  });

  map.addLayer({
    id: "campground-cluster-count",
    type: "symbol",
    source: "campgrounds",
    filter: ["has", "point_count"],
    layout: {
      visibility: "none",
      "text-field": "{point_count_abbreviated}",
      "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Regular"],
      "text-size": 11
    },
    paint: { "text-color": "#fff" }
  });

  // Individual campground points
  map.addLayer({
    id: "campground-layer",
    type: "circle",
    source: "campgrounds",
    filter: ["!", ["has", "point_count"]],
    layout: { visibility: "none" },
    paint: {
      "circle-color": "#00b894",
      "circle-radius": 6,
      "circle-opacity": 0.85,
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1.5
    }
  });

  // Hover cursor + click popup
  let campPopup = null;
  ["campground-layer"].forEach((lid) => {
    map.on("mouseenter", lid, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", lid, () => { map.getCanvas().style.cursor = ""; });
    map.on("click", lid, (e) => {
      e.originalEvent.stopPropagation();
      const feat = e.features?.[0];
      if (!feat) return;
      const { name, url } = feat.properties;
      if (campPopup) campPopup.remove();
      campPopup = new mapboxgl.Popup({ closeButton: true, maxWidth: "240px" })
        .setLngLat(feat.geometry.coordinates)
        .setHTML(
          `<div style="font-family:system-ui;font-size:13px">` +
          `<strong style="font-size:14px">${name}</strong><br>` +
          (url ? `<a href="${url}" target="_blank" rel="noopener" style="color:#00b894">NPS page ↗</a>` : "") +
          `</div>`
        )
        .addTo(map);
    });
  });

  map.on("click", "campground-clusters", (e) => {
    e.originalEvent.stopPropagation();
    const feat = e.features?.[0];
    if (!feat) return;
    map.getSource("campgrounds")?.getClusterExpansionZoom(feat.properties.cluster_id, (err, zoom) => {
      if (!err) map.easeTo({ center: feat.geometry.coordinates, zoom: zoom + 1 });
    });
  });
  map.on("mouseenter", "campground-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "campground-clusters", () => { map.getCanvas().style.cursor = ""; });
}

async function loadCampgroundData() {
  if (campgroundCache)  return campgroundCache;
  if (campgroundLoading) return null;
  campgroundLoading = true;

  // NPS public ArcGIS FeatureServer — campgrounds point layer
  const url =
    "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/" +
    "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query" +
    "?where=1=1&outFields=UNIT_CODE,UNIT_NAME&f=geojson&resultRecordCount=1";
    // ↑ That's the boundary service; campgrounds need a different endpoint ↓

  // NPS public campgrounds from the developer.nps.gov API (no key, demo endpoint)
  // We fetch all campgrounds for the park codes we have in PARKS_DATA
  const codes = PARKS_DATA.map((p) => p.parkCode).join(",");
  const campUrl =
    `https://developer.nps.gov/api/v1/campgrounds?parkCode=${encodeURIComponent(codes)}&limit=500&api_key=DEMO_KEY`;

  try {
    const res = await fetch(campUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const features = (json.data ?? [])
      .filter((c) => c.latitude && c.longitude)
      .map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [parseFloat(c.longitude), parseFloat(c.latitude)] },
        properties: { name: c.name, url: c.url, parkCode: c.parkCode }
      }));

    campgroundCache = { type: "FeatureCollection", features };

    // Update count badge
    const countEl = document.getElementById("count-campgrounds");
    if (countEl) countEl.textContent = `(${features.length})`;

    campgroundLoading = false;
    return campgroundCache;
  } catch (err) {
    console.warn("[campgrounds] fetch failed:", err);
    campgroundLoading = false;
    return null;
  }
}

async function setCampgroundVisibility(visible) {
  campgroundVisible = visible;
  if (!map) return;

  if (visible && !campgroundCache) {
    const lbl = document.querySelector('label[for="layer-campgrounds"] .layer-toggle__label');
    const origText = lbl ? lbl.innerHTML : "";
    if (lbl) lbl.innerHTML = `<span class="layer-dot layer-dot--camp">⛺</span> Loading campgrounds…`;

    const data = await loadCampgroundData();

    if (lbl) lbl.innerHTML = origText;

    if (!data) {
      const chk = document.getElementById("layer-campgrounds");
      if (chk) chk.checked = false;
      campgroundVisible = false;
      return;
    }
    map.getSource("campgrounds")?.setData(data);
  }

  const vis = campgroundVisible ? "visible" : "none";
  ["campground-clusters", "campground-cluster-count", "campground-layer"].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
  });
}

/* ===============================
   STOPS LIST
================================ */
/**
 * Render the #stops-list panel with draggable-order row, must-see toggle,
 * closure badge, and × remove button for each selected park.
 */
function renderStopsList() {
  const container = document.getElementById("stops-list");
  if (!container) return;

  container.innerHTML = "";

  if (!selectedParks.length) {
    container.innerHTML = `<div class="empty">No stops yet. Search or click the map.</div>`;
    return;
  }

  selectedParks.forEach((stop, idx) => {
    const park = stop.source !== "stamp" ? PARKS_DATA[stop.id] : null;
    const isClosed = park && tripRules.travelMonth
      ? isParkClosedInMonth(park.parkCode, tripRules.travelMonth)
      : false;
    const isMustSee = stop.mustSee !== false;

    const row = document.createElement("div");
    row.className = "stop-row";
    row.dataset.idx = idx;
    row.draggable = true;

    row.innerHTML = `
      <div class="stop-row__drag-handle" aria-hidden="true" title="Drag to reorder">⠿</div>
      <div class="stop-row__num">${idx + 1}</div>
      <div class="stop-row__info">
        <div class="stop-row__name">${stop.name}${isClosed ? ` <span class="stop-badge stop-badge--closed" title="May be closed or limited access in the selected month">seasonal</span>` : ""}</div>
        <label class="stop-row__must-see-label">
          <input type="checkbox" class="stop-row__must-see" data-idx="${idx}"${isMustSee ? " checked" : ""}>
          <span class="stop-row__must-see-text">Must see</span>
        </label>
      </div>
      <button class="stop-row__remove" data-idx="${idx}" aria-label="Remove ${stop.name} from trip" title="Remove stop">×</button>
    `;

    container.appendChild(row);
  });

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  let dragSrcIdx = null;
  let dragOverRow = null;

  container.querySelectorAll(".stop-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragSrcIdx = Number(row.dataset.idx);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragSrcIdx); // required for Firefox
      // Defer adding class so the drag image captures the non-dimmed state
      requestAnimationFrame(() => row.classList.add("is-dragging"));
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      if (dragOverRow) {
        dragOverRow.classList.remove("drag-over--above", "drag-over--below");
        dragOverRow = null;
      }
      dragSrcIdx = null;
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverRow && dragOverRow !== row) {
        dragOverRow.classList.remove("drag-over--above", "drag-over--below");
      }
      dragOverRow = row;
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        row.classList.add("drag-over--above");
        row.classList.remove("drag-over--below");
      } else {
        row.classList.add("drag-over--below");
        row.classList.remove("drag-over--above");
      }
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over--above", "drag-over--below");
      if (dragOverRow === row) dragOverRow = null;
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over--above", "drag-over--below");
      const destIdx = Number(row.dataset.idx);
      if (dragSrcIdx === null || dragSrcIdx === destIdx) return;

      // Determine insert position (above or below the drop target)
      const rect = row.getBoundingClientRect();
      const insertAfter = e.clientY >= rect.top + rect.height / 2;

      // Remove dragged item and re-insert at the new position
      const [moved] = selectedParks.splice(dragSrcIdx, 1);
      let newIdx = destIdx;
      if (dragSrcIdx < destIdx) newIdx = destIdx - 1; // account for removal
      if (insertAfter) newIdx += 1;
      selectedParks.splice(newIdx, 0, moved);

      renderStopsList();
      updateMarkerNumbers();
      renderStatus();
      updateActionAvailability();
      debounceRouteUpdate(120);
    });
  });

  // ── Remove button ──────────────────────────────────────────────────────────
  container.querySelectorAll(".stop-row__remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      const stop = selectedParks[idx];
      if (!stop) return;
      if (stop.source !== "stamp") {
        map?.setFeatureState({ source: "parks", id: stop.id }, { selected: false });
      }
      selectedParks.splice(idx, 1);
      renderStopsList();
      updateMarkerNumbers();
      renderStatus();
      updateActionAvailability();
      debounceRouteUpdate(120);
    });
  });

  // ── Must-see toggle ────────────────────────────────────────────────────────
  container.querySelectorAll(".stop-row__must-see").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      if (selectedParks[idx]) {
        selectedParks[idx].mustSee = e.currentTarget.checked;
      }
    });
  });

  // Update airport suggestion whenever stops change
  renderAirportSuggestion();
}

/* ===============================
   ORIGIN SYSTEM
================================ */
function renderOriginDisplay() {
  const labelEl  = document.getElementById("origin-label");
  const clearBtn = document.getElementById("origin-clear");
  if (!labelEl) return;
  if (originPoint) {
    labelEl.textContent = originPoint.label;
    labelEl.className   = "origin-label origin-label--set";
    clearBtn?.classList.remove("is-hidden");
  } else {
    labelEl.textContent = "No origin set";
    labelEl.className   = "origin-label origin-label--none";
    clearBtn?.classList.add("is-hidden");
  }
}

function setOriginMarker(lngLat, label) {
  clearOriginMarker();
  originPoint = { lngLat, label };
  if (map) {
    const el = document.createElement("div");
    el.className = "origin-marker";
    originMarker = new mapboxgl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(map);
  }
  renderOriginDisplay();
}

function clearOriginMarker() {
  originMarker?.remove();
  originMarker = null;
  originPoint  = null;
  renderOriginDisplay();
}

async function geocodeOriginQuery(query) {
  if (!query.trim()) return [];
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?types=place,address,poi&country=us&access_token=${mapboxgl.accessToken}`;
  try {
    const res  = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.features ?? []).slice(0, 5).map((f) => ({
      label:  f.place_name,
      lngLat: f.geometry.coordinates
    }));
  } catch { return []; }
}

/* ===============================
   CLEAR
================================ */
function clearRoute() {
  if (selectedParks.length) {
    if (!confirm("This will clear your entire route, itinerary, and day plan. Continue?")) return;
  }

  selectedParks.forEach((p) => {
    if (p.source !== "stamp") {
      map?.setFeatureState({ source: "parks", id: p.id }, { selected: false });
    }
  });

  selectedParks = [];
  currentLegs = [];
  selectedLegIndex = null;
  dayPlan = [];
  lastOptimizeSummary = null;

  if (itineraryListEl) itineraryListEl.innerHTML = "";
  renderSummary([]);
  renderViolations([]);
  renderOptimizeSummary(null);
  renderStatus();
  renderStopsList();
  updateMarkerNumbers();
  updateActionAvailability();

  setGeoJSON("route", emptyLineStringFeature());
  setGeoJSON("route-highlight", emptyLineStringFeature());
  setGeoJSON("leg-labels", { type: "FeatureCollection", features: [] });
}

/* ===============================
   ROUTE UPDATE (main)
================================ */
async function updateRoute() {
  renderStatus();

  // Need at least 2 total waypoints to draw a route.
  // If an origin is set, 1 selected park is enough (origin + park = 2).
  const minStops = originPoint ? 1 : 2;
  if (selectedParks.length < minStops) {
    currentLegs = [];
    selectedLegIndex = null;
    dayPlan = [];
    lastOptimizeSummary = null;

    if (itineraryListEl) itineraryListEl.innerHTML = "";
    renderSummary([]);
    renderViolations([]);
    renderOptimizeSummary(null);
    updateActionAvailability();

    setGeoJSON("route", emptyLineStringFeature());
    setGeoJSON("route-highlight", emptyLineStringFeature());
    setGeoJSON("leg-labels", { type: "FeatureCollection", features: [] });
    return;
  }

  if (routeRequestController) routeRequestController.abort();
  routeRequestController = new AbortController();

  setRoutingState(true);

  const roundTripOn = !!roundTripToggle?.checked;

  try {
    const beforeMilesApprox = currentLegs.reduce((s, l) => s + (l.miles || 0), 0);
    const beforeLongestApprox = currentLegs.reduce((m, l) => Math.max(m, l.hours || 0), 0);

    const { orderedStops, optimized, beforeOrder: beforeFromFn } = await computeStopOrder();

    // Update the actual selection order if optimized
    selectedParks = orderedStops;
    updateMarkerNumbers();
    renderStatus();

    // Prepend origin as a virtual first stop (not stored in selectedParks)
    const stopsForRouting = originPoint
      ? [{ id: "__origin__", name: "Origin", coords: originPoint.lngLat, locked: true, source: "origin" }, ...orderedStops]
      : orderedStops;

    const result = await fetchDirectionsGeometry(stopsForRouting, roundTripOn);
    if (!result.geometry) return;

    setGeoJSON("route", { type: "Feature", geometry: result.geometry });

    buildLegs(stopsForRouting, roundTripOn);
    attachLegGeometriesFromRoute(result.geometry, stopsForRouting, roundTripOn);
    updateLegLabels();

    if (optimized) {
      const afterMiles = currentLegs.reduce((s, l) => s + (l.miles || 0), 0);
      const afterLongest = currentLegs.reduce((m, l) => Math.max(m, l.hours || 0), 0);
      lastOptimizeSummary = {
        beforeMiles: beforeMilesApprox,
        afterMiles,
        beforeLongest: beforeLongestApprox,
        afterLongest,
        beforeOrder: (beforeFromFn || selectedParks.map((s) => s.name)).slice(0, 10),
        afterOrder: selectedParks.map((s) => s.name).slice(0, 10)
      };
      renderOptimizeSummary(lastOptimizeSummary);
    } else {
      lastOptimizeSummary = null;
      renderOptimizeSummary(null);
    }

    renderItinerary(currentLegs);

    if (currentLegs.length) highlightLeg(0);
    else clearLegHighlight();

    renderSummary(currentLegs);
    renderViolations(computeViolations(currentLegs));

    if (dayPlan.length) {
      const { plan: rp, droppedOptional: rd } = generateDayPlan();
      renderDayPlan(rp, rd);
    }
  } catch (err) {
    if (err?.name !== "AbortError") console.error("updateRoute failed:", err);
  } finally {
    setRoutingState(false);
    updateActionAvailability();
  }
}

/* ===============================
   MODE SWITCH
================================ */
function setMode(mode) {
  const isPlanner = mode === "planner";

  modePlannerBtn?.classList.toggle("is-active", isPlanner);
  modeDayByDayBtn?.classList.toggle("is-active", !isPlanner);

  modePlannerBtn?.setAttribute("aria-selected", String(isPlanner));
  modeDayByDayBtn?.setAttribute("aria-selected", String(!isPlanner));

  plannerViewEl?.classList.toggle("is-hidden", !isPlanner);
  dayByDayViewEl?.classList.toggle("is-hidden", isPlanner);

  // This class is often used by CSS layouts to control panels
  document.body.classList.toggle("mode-daybyday", !isPlanner);
}

/* ===============================
   PARK INFO CARD
================================ */
// NPS API key intentionally removed from runtime.
// Park data is now served from docs/data/parks.json (built by scripts/build_nps_data.mjs).
// Fee + hours data for the card is fetched from docs/data/parks.json at card-open time.

let parkCardParkId = null;  // PARKS_DATA index currently shown in park mode
let cardMode = "park";      // "park" | "stamp" — which mode the card is in
let stampCardData = null;   // NPS_STAMPS entry currently shown (stamp mode only)

function openParkCard(parkIndex) {
  const park = PARKS_DATA[parkIndex];
  if (!park) return;

  parkCardParkId = parkIndex;
  cardMode = "park";
  stampCardData = null;

  // Ensure park-mode fields visible, stamp-mode fields hidden
  document.getElementById("park-card-fee")?.classList.remove("is-hidden");
  document.getElementById("park-card-hours")?.classList.remove("is-hidden");
  document.getElementById("park-card-designation")?.classList.add("is-hidden");
  document.getElementById("park-card-passport")?.classList.add("is-hidden");

  const cardEl      = document.getElementById("park-card");
  const nameEl      = document.getElementById("park-card-name");
  const stateEl     = document.getElementById("park-card-state");
  const descEl      = document.getElementById("park-card-desc");
  const feeValEl    = document.getElementById("park-card-fee-val");
  const hoursValEl  = document.getElementById("park-card-hours-val");
  const feeItemEl   = document.getElementById("park-card-fee");
  const hoursItemEl = document.getElementById("park-card-hours");
  const addBtn      = document.getElementById("park-card-add");
  const linkEl      = document.getElementById("park-card-link");

  if (!cardEl) return;

  // Static fields from parks.js
  nameEl.textContent  = park.name;
  stateEl.textContent = park.state ?? "";
  descEl.textContent  = park.description ?? "";

  // NPS website link
  linkEl.href = `https://www.nps.gov/${park.parkCode}/index.htm`;

  // Add/Remove button state
  const alreadyAdded = selectedParks.some((p) => p.id === parkIndex);
  syncCardAddButton(addBtn, alreadyAdded);

  // Reset dynamic fields to loading state
  feeValEl.textContent   = "Loading…";
  hoursValEl.textContent = "Loading…";
  feeItemEl.classList.add("is-loading");
  hoursItemEl.classList.add("is-loading");

  // Show card (remove is-hidden, re-trigger animation)
  cardEl.classList.remove("is-hidden");
  cardEl.style.animation = "none";
  // eslint-disable-next-line no-unused-expressions
  cardEl.offsetHeight; // reflow
  cardEl.style.animation = "";

  // Fetch NPS data asynchronously — doesn't block card display
  fetchNpsParkDetails(park.parkCode).then(({ fee, hours }) => {
    // Guard: user may have switched parks or closed the card
    if (parkCardParkId !== parkIndex) return;
    feeValEl.textContent   = fee;
    hoursValEl.textContent = hours;
    feeItemEl.classList.remove("is-loading");
    hoursItemEl.classList.remove("is-loading");
  });
}

function closeParkCard() {
  parkCardParkId = null;
  cardMode = "park";
  stampCardData = null;
  // Restore park-mode field visibility for next open
  document.getElementById("park-card-fee")?.classList.remove("is-hidden");
  document.getElementById("park-card-hours")?.classList.remove("is-hidden");
  document.getElementById("park-card-designation")?.classList.add("is-hidden");
  document.getElementById("park-card-passport")?.classList.add("is-hidden");
  document.getElementById("park-card")?.classList.add("is-hidden");
}

function openStampCard(stamp) {
  cardMode = "stamp";
  stampCardData = stamp;
  parkCardParkId = null;

  // Switch field visibility: hide park-only, show stamp-only
  document.getElementById("park-card-fee")?.classList.add("is-hidden");
  document.getElementById("park-card-hours")?.classList.add("is-hidden");
  document.getElementById("park-card-designation")?.classList.remove("is-hidden");
  document.getElementById("park-card-passport")?.classList.remove("is-hidden");

  // Populate fields
  document.getElementById("park-card-name").textContent  = stamp.name;
  document.getElementById("park-card-state").textContent = stamp.states ?? "";
  document.getElementById("park-card-desc").textContent  = stamp.designation;
  document.getElementById("park-card-designation-val").textContent = stamp.designation;
  document.getElementById("park-card-passport-val").textContent    = stamp.passportRegion ?? "—";
  document.getElementById("park-card-link").href =
    `https://www.nps.gov/${stamp.parkCode}/index.htm`;

  const stampId     = `stamp:${stamp.parkCode}`;
  const alreadyAdded = selectedParks.some((p) => p.id === stampId);
  syncCardAddButton(document.getElementById("park-card-add"), alreadyAdded);

  // Animate card open
  const cardEl = document.getElementById("park-card");
  if (!cardEl) return;
  cardEl.classList.remove("is-hidden");
  cardEl.style.animation = "none";
  cardEl.offsetHeight; // force reflow
  cardEl.style.animation = "";
}

function syncCardAddButton(btn, isAdded) {
  if (!btn) return;
  if (isAdded) {
    btn.textContent = "Remove from trip";
    btn.classList.add("is-added");
  } else {
    btn.textContent = "Add to trip";
    btn.classList.remove("is-added");
  }
}

function handleParkCardAddToTrip() {
  if (parkCardParkId === null) return;
  const parkIndex = parkCardParkId;
  const park = PARKS_DATA[parkIndex];
  if (!park) return;

  const addBtn = document.getElementById("park-card-add");
  const alreadyAdded = selectedParks.some((p) => p.id === parkIndex);

  if (alreadyAdded) {
    map?.setFeatureState({ source: "parks", id: parkIndex }, { selected: false });
    selectedParks = selectedParks.filter((p) => p.id !== parkIndex);
    syncCardAddButton(addBtn, false);
  } else {
    selectedParks.push({
      id: parkIndex,
      name: park.name,
      coords: [park.lon, park.lat],
      locked: false,
      source: "park"
    });
    map?.setFeatureState({ source: "parks", id: parkIndex }, { selected: true });
    syncCardAddButton(addBtn, true);
  }

  updateMarkerNumbers();
  renderStopsList();
  renderStatus();
  updateActionAvailability();
  debounceRouteUpdate(120);
}

function handleStampCardAddToTrip() {
  if (!stampCardData) return;
  const stampId = `stamp:${stampCardData.parkCode}`;
  const addBtn = document.getElementById("park-card-add");
  const alreadyAdded = selectedParks.some((p) => p.id === stampId);

  if (alreadyAdded) {
    selectedParks = selectedParks.filter((p) => p.id !== stampId);
    syncCardAddButton(addBtn, false);
  } else {
    selectedParks.push({
      id: stampId,
      name: stampCardData.name,
      coords: [stampCardData.lon, stampCardData.lat],
      locked: false,
      source: "stamp"
    });
    syncCardAddButton(addBtn, true);
  }

  updateMarkerNumbers();
  renderStopsList();
  renderStatus();
  updateActionAvailability();
  debounceRouteUpdate(120);
}

/**
 * Return fee + hours for a park from the locally-loaded PARKS_DATA.
 * No runtime NPS API calls — all data comes from docs/data/parks.json
 * which is built by scripts/build_nps_data.mjs.
 *
 * parks.json carries `entranceFee`, `entranceFeeDesc`, and `directionsInfo`
 * fields added by the build script. Falls back to NPS website link if absent.
 */
async function fetchNpsParkDetails(parkCode) {
  if (!parkCode) return { fee: "See NPS website", hours: "See NPS website" };
  const park = PARKS_DATA.find((p) => p.parkCode === parkCode);
  if (!park) return { fee: "See NPS website", hours: "See NPS website" };

  const npsLink = park.url
    ? `<a href="${park.url}" target="_blank" rel="noopener">NPS website ↗</a>`
    : "See NPS website";

  // Fee: built from entranceFee (cost) + entranceFeeDesc (title/description)
  let feeText;
  if (park.entranceFee != null) {
    const cost = Number(park.entranceFee);
    feeText = cost === 0 ? "Free" : `$${cost.toFixed(2)}`;
    if (park.entranceFeeDesc) feeText += ` — ${park.entranceFeeDesc}`;
  } else {
    feeText = npsLink;
  }

  // Hours: stored as directionsInfo (best available from build) or link
  const hoursText = park.operatingHours ?? npsLink;

  return { fee: feeText, hours: hoursText };
}

/* ===============================
   STAMP LAYERS
================================ */

/**
 * Stamp layer visibility state — keyed by layer group.
 * Persisted in memory for the session; initialized from checkbox defaults.
 */
const stampLayerVisible = {
  "national-park":    true,   // matches checkbox #layer-national-parks (default checked)
  "national-seashore": false, // matches checkbox #layer-seashores
  "other":            false   // matches checkbox #layer-other-stamps
};

/** Map layer IDs for each stamp group */
const STAMP_LAYER_IDS = {
  "national-park":    "stamps-np-layer",
  "national-seashore":"stamps-ss-layer",
  "other":            "stamps-other-layer"
};

/** Source IDs for each stamp group */
const STAMP_SOURCE_IDS = {
  "national-park":    "stamps-np",
  "national-seashore":"stamps-ss",
  "other":            "stamps-other"
};

/**
 * Build a GeoJSON FeatureCollection from NPS_STAMPS filtered by layer key.
 * Each feature carries all metadata as properties for tooltip display.
 */
function stampFeatureCollection(layerKey) {
  const stamps = Array.isArray(window.NPS_STAMPS) ? window.NPS_STAMPS : [];
  return {
    type: "FeatureCollection",
    features: stamps
      .filter((s) => s.layer === layerKey)
      .map((s, i) => ({
        type: "Feature",
        id: i,
        properties: {
          name: s.name,
          parkCode: s.parkCode,
          designation: s.designation,
          states: s.states,
          npsRegion: s.npsRegion,
          passportRegion: s.passportRegion
        },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] }
      }))
  };
}

/* ============================================================
   AIRPORT LAYER + SUGGESTION
============================================================ */

/**
 * Haversine distance in miles between two [lon, lat] points.
 */
function haversineMiles([lon1, lat1], [lon2, lat2]) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Return the closest airport to a given [lon, lat] coordinate.
 */
function nearestAirport(coords) {
  const airports = Array.isArray(window.AIRPORTS) ? window.AIRPORTS : [];
  if (!airports.length) return null;
  let best = null, bestDist = Infinity;
  airports.forEach((ap) => {
    const d = haversineMiles(coords, [ap.lon, ap.lat]);
    if (d < bestDist) { bestDist = d; best = { ...ap, distMi: Math.round(d) }; }
  });
  return best;
}

/**
 * Add or remove the airport GeoJSON source + symbol layer.
 * Called once inside map.on("load").
 */
function initAirportLayer() {
  if (!map) return;
  const airports = Array.isArray(window.AIRPORTS) ? window.AIRPORTS : [];

  // Update count badge
  const countEl = document.getElementById("count-airports");
  if (countEl) countEl.textContent = `(${airports.length})`;

  // Build GeoJSON
  const geojson = {
    type: "FeatureCollection",
    features: airports.map((ap) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ap.lon, ap.lat] },
      properties: { iata: ap.iata, name: ap.name, city: ap.city, state: ap.state }
    }))
  };

  map.addSource("airports", { type: "geojson", data: geojson });

  // Circle layer (always added, visibility toggled)
  map.addLayer({
    id: "airports-layer",
    type: "circle",
    source: "airports",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 6,
      "circle-color": "#00bfff",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.85
    }
  });

  // Symbol layer for IATA code label
  map.addLayer({
    id: "airports-labels",
    type: "symbol",
    source: "airports",
    layout: {
      visibility: "none",
      "text-field": ["get", "iata"],
      "text-size": 9,
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Regular"]
    },
    paint: {
      "text-color": "#00bfff",
      "text-halo-color": "#000",
      "text-halo-width": 1
    }
  });

  // Hover cursor
  map.on("mouseenter", "airports-layer", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "airports-layer", () => { map.getCanvas().style.cursor = ""; });

  // Click → popup
  map.on("click", "airports-layer", (e) => {
    e.originalEvent.stopPropagation();
    const { iata, name, city, state } = e.features[0].properties;
    new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(`
        <div style="font-size:13px;line-height:1.5">
          <strong style="font-size:15px">${iata}</strong><br>
          ${name}<br>
          <span style="color:#aaa">${city}, ${state}</span>
        </div>`)
      .addTo(map);
  });

  // Toggle wiring
  document.getElementById("layer-airports")?.addEventListener("change", (e) => {
    const vis = e.target.checked ? "visible" : "none";
    map.setLayoutProperty("airports-layer",  "visibility", vis);
    map.setLayoutProperty("airports-labels", "visibility", vis);
  });
}

/**
 * Compute and render the "Suggested Airports" box.
 * Shown whenever 2+ stops are selected; hidden otherwise.
 */
function renderAirportSuggestion() {
  const section = document.getElementById("airport-suggestion");
  const content = document.getElementById("airport-suggestion-content");
  if (!section || !content) return;

  if (selectedParks.length < 2) {
    section.classList.add("is-hidden");
    return;
  }

  const first = selectedParks[0];
  const last  = selectedParks[selectedParks.length - 1];

  const flyIn  = nearestAirport(first.coords);
  const flyOut = nearestAirport(last.coords);

  if (!flyIn || !flyOut) { section.classList.add("is-hidden"); return; }

  const sameAirport = flyIn.iata === flyOut.iata;

  content.innerHTML = `
    <div class="airport-row airport-row--in">
      <span class="airport-badge">✈ Fly in</span>
      <div class="airport-info">
        <strong>${flyIn.iata}</strong> — ${flyIn.city}, ${flyIn.state}
        <div class="airport-detail">${flyIn.name}</div>
        <div class="airport-dist">${flyIn.distMi} mi from ${first.name}</div>
      </div>
    </div>
    ${sameAirport ? `
    <div class="airport-same-note">Same airport for fly-out — consider reordering stops for a one-way trip.</div>
    ` : `
    <div class="airport-row airport-row--out">
      <span class="airport-badge airport-badge--out">✈ Fly out</span>
      <div class="airport-info">
        <strong>${flyOut.iata}</strong> — ${flyOut.city}, ${flyOut.state}
        <div class="airport-detail">${flyOut.name}</div>
        <div class="airport-dist">${flyOut.distMi} mi from ${last.name}</div>
      </div>
    </div>
    `}
  `;

  section.classList.remove("is-hidden");
}

/**
 * Park boundary layer — fetches NPS unit boundary polygons from the public
 * NPS ArcGIS REST API and renders them as a semi-transparent fill + outline.
 *
 * Data source: NPS public feature service (no key required).
 * Fetched lazily the first time the toggle is checked; cached thereafter.
 */
let boundaryDataCache = null;   // GeoJSON FeatureCollection once loaded
let boundaryLoading   = false;
let boundaryVisible   = false;

function initBoundaryLayer() {
  if (!map) return;

  // Add placeholder empty sources / layers now so setLayoutProperty works later
  map.addSource("park-boundaries", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });

  // Filled polygon (semi-transparent purple)
  map.addLayer({
    id: "park-boundaries-fill",
    type: "fill",
    source: "park-boundaries",
    paint: {
      "fill-color": "#bb00ff",
      "fill-opacity": 0.08
    },
    layout: { visibility: "none" }
  }, "route-layer"); // insert below route so route stays on top

  // Outline stroke
  map.addLayer({
    id: "park-boundaries-outline",
    type: "line",
    source: "park-boundaries",
    paint: {
      "line-color": "#bb00ff",
      "line-width": 1.5,
      "line-opacity": 0.55
    },
    layout: { visibility: "none" }
  }, "route-layer");
}

async function loadBoundaryData() {
  if (boundaryDataCache) return boundaryDataCache;
  if (boundaryLoading)   return null; // already in flight

  boundaryLoading = true;

  // NPS public ArcGIS FeatureServer — unit boundaries (polygon)
  // Returns up to 1000 features per request; national parks + monuments etc.
  // We request only the park codes present in PARKS_DATA to keep the payload small.
  const codes = PARKS_DATA.map((p) => p.parkCode.toUpperCase());
  const where  = codes.length
    ? `UNIT_CODE IN (${codes.map((c) => `'${c}'`).join(",")})`
    : "1=1";

  const url =
    "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/" +
    "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query" +
    `?where=${encodeURIComponent(where)}` +
    "&outFields=UNIT_CODE,UNIT_NAME" +
    "&f=geojson" +
    "&resultRecordCount=200";

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    boundaryDataCache = geojson;
    boundaryLoading   = false;
    return geojson;
  } catch (err) {
    console.warn("[boundaries] fetch failed:", err);
    boundaryLoading = false;
    return null;
  }
}

async function setBoundaryVisibility(visible) {
  boundaryVisible = visible;
  if (!map) return;

  if (visible && !boundaryDataCache) {
    // Show a subtle loading state on the toggle label
    const lbl = document.querySelector('label[for="show-boundaries"] span');
    if (lbl) lbl.textContent = "Loading boundaries…";

    const data = await loadBoundaryData();

    if (lbl) lbl.textContent = "Show park boundaries";

    if (!data) {
      // Fetch failed — uncheck the toggle and bail
      const chk = document.getElementById("show-boundaries");
      if (chk) chk.checked = false;
      boundaryVisible = false;
      return;
    }

    map.getSource("park-boundaries")?.setData(data);
  }

  const vis = boundaryVisible ? "visible" : "none";
  if (map.getLayer("park-boundaries-fill"))   map.setLayoutProperty("park-boundaries-fill",    "visibility", vis);
  if (map.getLayer("park-boundaries-outline")) map.setLayoutProperty("park-boundaries-outline", "visibility", vis);
}

/**
 * Initialise all three stamp GeoJSON sources and circle layers.
 * Called once inside map.on("load") after the parks layer is ready.
 */
function initStampLayers() {
  if (!map) return;

  const NPS_STAMPS = Array.isArray(window.NPS_STAMPS) ? window.NPS_STAMPS : [];

  // Count per group and update sidebar labels
  const counts = { "national-park": 0, "national-seashore": 0, "other": 0 };
  NPS_STAMPS.forEach((s) => { if (counts[s.layer] !== undefined) counts[s.layer]++; });

  const npCountEl = document.getElementById("count-national-parks");
  const ssCountEl = document.getElementById("count-seashores");
  const otCountEl = document.getElementById("count-other-stamps");
  if (npCountEl) npCountEl.textContent = `(${counts["national-park"]})`;
  if (ssCountEl) ssCountEl.textContent = `(${counts["national-seashore"]})`;
  if (otCountEl) otCountEl.textContent = `(${counts["other"]})`;

  // Layer configs: [groupKey, color, radius, opacity]
  const LAYER_CONFIG = [
    // National Parks — purple/violet, matches existing park dots
    ["national-park",    "#bb00ff", 7, 0.90],
    // National Seashores — teal/cyan
    ["national-seashore","#00d4c8", 6, 0.85],
    // Other stamp locations — amber/gold
    ["other",            "#ffb300", 5, 0.80]
  ];

  LAYER_CONFIG.forEach(([key, color, radius, opacity]) => {
    const sourceId = STAMP_SOURCE_IDS[key];
    const layerId  = STAMP_LAYER_IDS[key];
    const visible  = stampLayerVisible[key];

    // Add source (cluster enabled for the large "other" group)
    map.addSource(sourceId, {
      type: "geojson",
      data: stampFeatureCollection(key),
      cluster: key === "other",          // cluster only the 400-item set
      clusterMaxZoom: 10,
      clusterRadius: 40
    });

    // --- Cluster circle (only rendered for "other" group) ---
    if (key === "other") {
      map.addLayer({
        id: `${layerId}-clusters`,
        type: "circle",
        source: sourceId,
        filter: ["has", "point_count"],
        layout: { visibility: visible ? "visible" : "none" },
        paint: {
          "circle-color": color,
          "circle-opacity": 0.65,
          "circle-radius": [
            "step", ["get", "point_count"],
            14,   10,
            20,   50,
            26
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(255,255,255,0.6)"
        }
      });

      // Cluster count label
      map.addLayer({
        id: `${layerId}-cluster-count`,
        type: "symbol",
        source: sourceId,
        filter: ["has", "point_count"],
        layout: {
          visibility: visible ? "visible" : "none",
          "text-field": "{point_count_abbreviated}",
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 11
        },
        paint: {
          "text-color": "#fff"
        }
      });
    }

    // --- Individual points (unclustered or non-clustered groups) ---
    map.addLayer({
      id: layerId,
      type: "circle",
      source: sourceId,
      filter: key === "other" ? ["!", ["has", "point_count"]] : ["all"],
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "circle-radius": radius,
        "circle-color": color,
        "circle-opacity": opacity,
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(255,255,255,0.55)"
      }
    });
  });

  console.info(`[Stamps] Loaded ${NPS_STAMPS.length} NPS stamp units across 3 layers.`);
}

/**
 * Show or hide a stamp layer group.
 * @param {"national-park"|"national-seashore"|"other"} key
 * @param {boolean} visible
 */
function setStampLayerVisibility(key, visible) {
  if (!map) return;
  stampLayerVisible[key] = visible;
  const v = visible ? "visible" : "none";
  const layerId = STAMP_LAYER_IDS[key];

  [layerId, `${layerId}-clusters`, `${layerId}-cluster-count`].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
  });
}

/* ===============================
   MAP INIT
================================ */
function initMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl) {
    console.error('Missing <div id="map"></div> in index.html. Map cannot initialize.');
    return;
  }

  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: [-98.5, 39.5],
    zoom: 3
  });

  map.on("load", () => {
    // Parks source
    map.addSource("parks", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: PARKS_DATA.map((p, i) => ({
          type: "Feature",
          id: i,
          properties: { name: p.name },
          geometry: { type: "Point", coordinates: [p.lon, p.lat] }
        }))
      }
    });

    // (parks-layer circle dots removed — NPS stamp layers cover all locations)

    // Routes
    map.addSource("route", { type: "geojson", data: emptyLineStringFeature() });
    map.addSource("route-highlight", { type: "geojson", data: emptyLineStringFeature() });
    map.addSource("leg-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    map.addLayer({
      id: "route-layer",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#bb00ff", "line-width": 4, "line-opacity": 0.9 }
    });

    map.addLayer({
      id: "route-highlight-layer",
      type: "line",
      source: "route-highlight",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#00ff66", "line-width": 5, "line-opacity": 0.9 }
    });

    // Leg drive-time labels at midpoint of each leg
    map.addLayer({
      id: "leg-label-layer",
      type: "symbol",
      source: "leg-labels",
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Regular"],
        "text-size": 11,
        "text-anchor": "center",
        "text-allow-overlap": false,
        "symbol-placement": "point"
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#330055",
        "text-halo-width": 2
      }
    });

    ensureMarkers();
    initBoundaryLayer();
    initStampLayers();
    initAirportLayer();
    initCampgroundLayer();

    // If geolocation already resolved before the map loaded, materialize the marker now
    if (originPoint && !originMarker) {
      const el = document.createElement("div");
      el.className = "origin-marker";
      originMarker = new mapboxgl.Marker({ element: el })
        .setLngLat(originPoint.lngLat)
        .addTo(map);
    }

    // Click anywhere else on the map → close the card
    map.on("click", (e) => {
      if (e.originalEvent._parkCardHandled) return;
      closeParkCard();
    });

    // Stamp layer cursors + hover tooltip
    const STAMP_LAYERS = ["stamps-np-layer", "stamps-ss-layer", "stamps-other-layer"];
    let stampTooltip = null;

    STAMP_LAYERS.forEach((layerId) => {
      map.on("mouseenter", layerId, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feat = e.features?.[0];
        if (!feat) return;
        const { name, designation, states, passportRegion } = feat.properties;
        // Create or reuse a tooltip element
        if (!stampTooltip) {
          stampTooltip = document.createElement("div");
          stampTooltip.className = "stamp-tooltip";
          document.getElementById("map")?.appendChild(stampTooltip);
        }
        stampTooltip.innerHTML =
          `<div class="stamp-tooltip__name">${name}</div>` +
          `<div class="stamp-tooltip__meta">${designation} · ${states}</div>` +
          `<div class="stamp-tooltip__region">Passport: ${passportRegion}</div>`;
        stampTooltip.style.display = "block";
      });

      map.on("mousemove", layerId, (e) => {
        if (!stampTooltip) return;
        const { offsetX, offsetY } = e.originalEvent;
        const mapEl = document.getElementById("map");
        const rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
        stampTooltip.style.left = `${offsetX + 14}px`;
        stampTooltip.style.top  = `${offsetY - 10}px`;
      });

      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
        if (stampTooltip) stampTooltip.style.display = "none";
      });

      // Click individual stamp point → open stamp card
      map.on("click", layerId, (e) => {
        e.originalEvent.stopPropagation(); // prevent map-level close-card handler
        const feat = e.features?.[0];
        if (!feat) return;
        const { parkCode } = feat.properties;
        const stamp = (window.NPS_STAMPS ?? []).find((s) => s.parkCode === parkCode);
        if (stamp) openStampCard(stamp);
      });
    });

    // Cluster click → zoom in (for "other" group clusters)
    map.on("click", "stamps-other-layer-clusters", (e) => {
      e.originalEvent.stopPropagation();
      const feat = e.features?.[0];
      if (!feat) return;
      const clusterId = feat.properties.cluster_id;
      map.getSource("stamps-other")?.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({ center: feat.geometry.coordinates, zoom: zoom + 1 });
      });
    });
    map.on("mouseenter", "stamps-other-layer-clusters", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "stamps-other-layer-clusters", () => (map.getCanvas().style.cursor = ""));

    // Initial UI render (safe)
    setMode("planner");
    renderStatus();
    renderStopsList();
    renderSummary([]);
    renderViolations([]);
    renderOptimizeSummary(null);
    renderItinerary([]);
    validateRules();
    updateActionAvailability();
  });
}

/* ===============================
   BOOT
================================ */
window.addEventListener("DOMContentLoaded", () => {
  // DOM wiring (IDs must match index.html)
  clearBtn = document.getElementById("clear");
  optimizeToggle = document.getElementById("optimize");
  roundTripToggle = document.getElementById("roundtrip");

  itineraryListEl = document.getElementById("itinerary-list");
  totalMilesEl = document.getElementById("total-miles");
  totalHoursEl = document.getElementById("total-hours");
  totalDaysEl = document.getElementById("total-days");
  longestLegEl = document.getElementById("longest-leg");
  violationsEl = document.getElementById("violations");
  optSummaryEl = document.getElementById("opt-summary");

  exportCsvBtn = document.getElementById("export-csv");
  copyBriefBtn = document.getElementById("copy-brief");

  modePlannerBtn = document.getElementById("mode-planner");
  modeDayByDayBtn = document.getElementById("mode-daybyday");
  plannerViewEl = document.getElementById("planner-view");
  dayByDayViewEl = document.getElementById("daybyday-view");

  startTimeEl = document.getElementById("start-time");
  maxHoursEl = document.getElementById("max-hours");
  maxLegHoursEl = document.getElementById("max-leg-hours");
  breakMinsEl = document.getElementById("break-mins");
  speedMphEl = document.getElementById("speed-mph");
  autoScheduleBtn = document.getElementById("auto-schedule");

  statusModeEl = document.getElementById("status-mode");
  statusTripEl = document.getElementById("status-trip");
  statusCountEl = document.getElementById("status-count");

  // Note: ensureBasics() is NOT called here — PARKS_DATA is populated
  // asynchronously by loadStaticData() below. ensureBasics() is called
  // inside initMap() after data has loaded.

  // Load rule inputs (original + new)
  if (startTimeEl) { tripRules.startTimeHHMM = startTimeEl.value || "08:00"; tripRules.wakeHHMM = startTimeEl.value || "08:00"; }
  if (maxHoursEl) tripRules.maxDriveHoursPerDay = Number(maxHoursEl.value || 6);
  if (maxLegHoursEl) tripRules.maxSingleLegHours = Number(maxLegHoursEl.value || 10);
  if (breakMinsEl) tripRules.breakMinutesPerDay = Number(breakMinsEl.value || 0);
  if (speedMphEl) tripRules.speedMph = Number(speedMphEl.value || 55);

  const wakeTimeEl       = document.getElementById("wake-time");
  const sleepTimeEl      = document.getElementById("sleep-time");
  const travelMonthEl    = document.getElementById("travel-month");
  const noBacktrackingEl = document.getElementById("no-backtracking");
  const visitHoursEl     = document.getElementById("visit-hours");
  const filterClosedEl   = document.getElementById("filter-closed");

  if (wakeTimeEl)  tripRules.wakeHHMM  = wakeTimeEl.value  || "08:00";
  if (sleepTimeEl) tripRules.sleepHHMM = sleepTimeEl.value || "20:00";
  if (travelMonthEl)    tripRules.travelMonth       = Number(travelMonthEl.value || 0);
  if (noBacktrackingEl) tripRules.noBacktracking     = noBacktrackingEl.checked;
  if (filterClosedEl)   tripRules.filterClosedParks  = filterClosedEl.checked;
  if (visitHoursEl)     tripRules.visitHoursPerPark  = Number(visitHoursEl.value ?? 1.5);

  // UI events
  modePlannerBtn?.addEventListener("click", () => setMode("planner"));
  modeDayByDayBtn?.addEventListener("click", () => setMode("daybyday"));

  startTimeEl?.addEventListener("change", () => {
    tripRules.startTimeHHMM = startTimeEl.value || "08:00";
    tripRules.wakeHHMM = startTimeEl.value || "08:00";
    if (dayPlan.length) {
      const { plan, droppedOptional } = generateDayPlan();
      renderDayPlan(plan, droppedOptional);
    }
  });

  wakeTimeEl?.addEventListener("change", () => {
    tripRules.wakeHHMM = wakeTimeEl.value || "08:00";
    tripRules.startTimeHHMM = wakeTimeEl.value || "08:00";
    if (startTimeEl) startTimeEl.value = wakeTimeEl.value;
    renderViolations(computeViolations(currentLegs));
    if (dayPlan.length) { const { plan, droppedOptional } = generateDayPlan(); renderDayPlan(plan, droppedOptional); }
  });

  sleepTimeEl?.addEventListener("change", () => {
    tripRules.sleepHHMM = sleepTimeEl.value || "20:00";
    renderViolations(computeViolations(currentLegs));
    if (dayPlan.length) { const { plan, droppedOptional } = generateDayPlan(); renderDayPlan(plan, droppedOptional); }
  });

  travelMonthEl?.addEventListener("change", () => {
    tripRules.travelMonth = Number(travelMonthEl.value || 0);
    renderViolations(computeViolations(currentLegs));
    renderStopsList();
  });

  noBacktrackingEl?.addEventListener("change", () => {
    tripRules.noBacktracking = noBacktrackingEl.checked;
    if (optimizeToggle?.checked) debounceRouteUpdate(120);
  });

  filterClosedEl?.addEventListener("change", () => {
    tripRules.filterClosedParks = filterClosedEl.checked;
    renderViolations(computeViolations(currentLegs));
    renderStopsList();
  });

  visitHoursEl?.addEventListener("change", () => {
    tripRules.visitHoursPerPark = Number(visitHoursEl.value ?? 1.5);
    if (dayPlan.length) { const { plan, droppedOptional } = generateDayPlan(); renderDayPlan(plan, droppedOptional); }
  });

  maxHoursEl?.addEventListener("change", () => {
    tripRules.maxDriveHoursPerDay = Number(maxHoursEl.value || 6);
    validateRules();
    renderSummary(currentLegs);
    renderViolations(computeViolations(currentLegs));
  });

  maxLegHoursEl?.addEventListener("change", () => {
    tripRules.maxSingleLegHours = Number(maxLegHoursEl.value || 10);
    validateRules();
    renderSummary(currentLegs);
    renderViolations(computeViolations(currentLegs));
  });

  breakMinsEl?.addEventListener("change", () => {
    tripRules.breakMinutesPerDay = Number(breakMinsEl.value || 0);
    if (dayPlan.length) {
      const { plan, droppedOptional } = generateDayPlan();
      renderDayPlan(plan, droppedOptional);
    }
  });

  speedMphEl?.addEventListener("change", () => {
    tripRules.speedMph = Number(speedMphEl.value || 55);
    debounceRouteUpdate(100);
  });

  autoScheduleBtn?.addEventListener("click", () => {
    const { plan, droppedOptional } = generateDayPlan();
    renderDayPlan(plan, droppedOptional);
    setMode("daybyday");
  });

  document.getElementById("export-pdf")?.addEventListener("click", printTrip);
  exportCsvBtn?.addEventListener("click", exportDayPlanCSV);
  copyBriefBtn?.addEventListener("click", copyTripBrief);

  document.getElementById("reverse-route")?.addEventListener("click", () => {
    if (selectedParks.length < 2) return;
    selectedParks.reverse();
    renderStopsList();
    updateMarkerNumbers();
    renderStatus();
    updateActionAvailability();
    debounceRouteUpdate(120);
  });

  clearBtn?.addEventListener("click", clearRoute);

  optimizeToggle?.addEventListener("change", () => {
    renderStatus();
    debounceRouteUpdate(120);
  });

  roundTripToggle?.addEventListener("change", () => {
    renderStatus();
    debounceRouteUpdate(120);
  });

  itineraryListEl?.addEventListener("click", (e) => {
    const row = e.target.closest(".itin-row");
    if (!row) return;
    highlightLeg(Number(row.dataset.index));
  });

  itineraryListEl?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest(".itin-row");
    if (!row) return;
    e.preventDefault();
    highlightLeg(Number(row.dataset.index));
  });

  validateRules();
  updateActionAvailability();

  // ── Passport Stamp Layer Toggles ──────────────────────────────────────────
  const layerNpEl  = document.getElementById("layer-national-parks");
  const layerSsEl  = document.getElementById("layer-seashores");
  const layerOtEl  = document.getElementById("layer-other-stamps");

  // Sync initial visibility state from checkbox defaults
  if (layerNpEl)  stampLayerVisible["national-park"]    = layerNpEl.checked;
  if (layerSsEl)  stampLayerVisible["national-seashore"] = layerSsEl.checked;
  if (layerOtEl)  stampLayerVisible["other"]             = layerOtEl.checked;

  layerNpEl?.addEventListener("change", () => setStampLayerVisibility("national-park",    layerNpEl.checked));
  layerSsEl?.addEventListener("change", () => setStampLayerVisibility("national-seashore", layerSsEl.checked));
  layerOtEl?.addEventListener("change", () => setStampLayerVisibility("other",             layerOtEl.checked));

  // Park boundaries toggle
  const showBoundariesEl = document.getElementById("show-boundaries");
  showBoundariesEl?.addEventListener("change", () => setBoundaryVisibility(showBoundariesEl.checked));

  // Campground layer toggle
  const layerCampEl = document.getElementById("layer-campgrounds");
  layerCampEl?.addEventListener("change", () => setCampgroundVisibility(layerCampEl.checked));

  // Wizard
  initWizard();

  // Park info card buttons
  document.getElementById("park-card-close")?.addEventListener("click", closeParkCard);

  document.getElementById("park-card-add")?.addEventListener("click", () => {
    if (cardMode === "stamp") {
      handleStampCardAddToTrip();
    } else {
      handleParkCardAddToTrip();
    }
  });

  // Close card on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeParkCard();
  });

  // ── Origin system ──────────────────────────────────────────────────────────
  // Geolocation fires before map is ready; setOriginMarker guards against null map
  renderOriginDisplay(); // show "No origin set" immediately
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lngLat = [pos.coords.longitude, pos.coords.latitude];
        setOriginMarker(lngLat, "Current location");
        if (selectedParks.length >= 1) debounceRouteUpdate(120);
      },
      () => renderOriginDisplay(),
      { timeout: 8000 }
    );
  }

  const originInputEl   = document.getElementById("origin-input");
  const originResultsEl = document.getElementById("origin-results");
  let originDebounceTimer = null;

  originInputEl?.addEventListener("input", () => {
    clearTimeout(originDebounceTimer);
    const q = originInputEl.value;
    if (!q.trim()) {
      originResultsEl?.classList.add("is-hidden");
      return;
    }
    originDebounceTimer = setTimeout(async () => {
      const results = await geocodeOriginQuery(q);
      if (!originResultsEl) return;
      if (!results.length) {
        originResultsEl.classList.add("is-hidden");
        return;
      }
      originResultsEl.innerHTML = results
        .map((r, i) => `<div class="origin-result" data-idx="${i}">${r.label}</div>`)
        .join("");
      originResultsEl._results = results;
      originResultsEl.classList.remove("is-hidden");
    }, 300);
  });

  originResultsEl?.addEventListener("click", (e) => {
    const row = e.target.closest(".origin-result");
    if (!row) return;
    const idx = Number(row.dataset.idx);
    const r   = originResultsEl._results?.[idx];
    if (!r) return;
    setOriginMarker(r.lngLat, r.label);
    if (originInputEl) originInputEl.value = "";
    originResultsEl.classList.add("is-hidden");
    if (selectedParks.length >= 1) debounceRouteUpdate(120);
  });

  document.getElementById("origin-clear")?.addEventListener("click", () => {
    clearOriginMarker();
    if (selectedParks.length >= 1) debounceRouteUpdate(120);
  });

  // ── Map boot ───────────────────────────────────────────────────────────────
  // Load static JSON data (parks.json + units.json from docs/data/), then boot.
  // Falls back to bundled parks.js / nps-stamps.js if JSON files aren't built yet.
  loadStaticData().finally(() => {
    initMap();
  });
});
