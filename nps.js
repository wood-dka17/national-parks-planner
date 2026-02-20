// nps.js
// Fetches NPS visitor center coordinates and updates window.PARKS in place.
// Must be loaded after parks.js and before app.js.
// Exposes window.NPS_READY — a Promise that resolves when enrichment is done.

(function () {
  "use strict";

  const NPS_API_KEY = "ODwJ89F5Hz61QFa3Mk6YhqRhCGweSwKszdGdnNgT";
  const NPS_BASE    = "https://developer.nps.gov/api/v1";

  // Batch size: NPS API supports up to 50 results per request.
  // We request all park codes in one call to /visitorcenters.
  const BATCH_SIZE = 50;

  /**
   * Fetch all visitor centers for the given park codes (max 50 per call).
   * Returns a Map<parkCode, {lat, lon, name}> for the primary visitor center
   * of each park (lowest sort-order / first returned).
   */
  async function fetchVisitorCenters(parkCodes) {
    const codeParam = parkCodes.join(",");
    const url =
      `${NPS_BASE}/visitorcenters` +
      `?parkCode=${encodeURIComponent(codeParam)}` +
      `&limit=${BATCH_SIZE}` +
      `&fields=latLong` +
      `&api_key=${NPS_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`NPS API error ${res.status}: ${res.statusText}`);

    const json = await res.json();
    const centers = json?.data ?? [];

    // Build parkCode -> coords map, keeping only the first center per park.
    const byPark = new Map();
    for (const vc of centers) {
      const code = vc.parkCode?.toLowerCase();
      if (!code || byPark.has(code)) continue;

      const lat = parseFloat(vc.latitude);
      const lon = parseFloat(vc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat === 0 && lon === 0) continue;

      byPark.set(code, { lat, lon, visitorCenterName: vc.name ?? "" });
    }

    return byPark;
  }

  /**
   * Enrich window.PARKS with visitor center coordinates where available.
   * Falls back silently to the existing centroid coords on any error.
   */
  async function enrichParks() {
    const parks = window.PARKS;
    if (!Array.isArray(parks) || !parks.length) return;

    // Deduplicate park codes (Kings Canyon + Sequoia share "seki")
    const allCodes = [...new Set(parks.map((p) => p.parkCode).filter(Boolean))];

    // Fetch in batches of BATCH_SIZE
    const batches = [];
    for (let i = 0; i < allCodes.length; i += BATCH_SIZE) {
      batches.push(allCodes.slice(i, i + BATCH_SIZE));
    }

    const combined = new Map();
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const result = await fetchVisitorCenters(batch);
          for (const [code, data] of result) combined.set(code, data);
        } catch (err) {
          console.warn("[NPS] Failed to fetch batch:", batch, err);
        }
      })
    );

    let updatedCount = 0;
    for (const park of parks) {
      const data = combined.get(park.parkCode?.toLowerCase());
      if (!data) continue;

      park.lat = data.lat;
      park.lon = data.lon;
      park.visitorCenterName = data.visitorCenterName;
      updatedCount++;
    }

    console.info(
      `[NPS] Visitor center coords loaded for ${updatedCount}/${parks.length} parks.`
    );
  }

  // Expose a promise that app.js awaits before booting the map.
  window.NPS_READY = enrichParks().catch((err) => {
    console.warn("[NPS] Enrichment failed, using fallback centroid coords.", err);
  });
})();
