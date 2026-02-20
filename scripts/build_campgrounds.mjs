#!/usr/bin/env node
/**
 * build_campgrounds.mjs — v2 (NPS campgrounds + USFS campgrounds + NPS lodges)
 * Build-time script: fetches campground data from Recreation.gov (RIDB API)
 * for NPS units and National Forests, then writes static GeoJSON to
 * docs/data/campgrounds.json for the runtime app to consume.
 *
 * Usage:
 *   RIDB_API_KEY=<your_key> node scripts/build_campgrounds.mjs
 *
 * Outputs:
 *   docs/data/campgrounds.json — GeoJSON FeatureCollection of campgrounds
 *
 * The RIDB_API_KEY is read from the environment only — never committed.
 * In GitHub Actions it comes from the RIDB_API_KEY repository secret.
 *
 * RIDB API docs: https://ridb.recreation.gov/docs
 * Uses the dedicated /campgrounds endpoint (not /facilities).
 * OrgAbbrevCode: "USFS" = National Forests, "NPS" = National Park Service
 * API key sent as "apikey" header per RIDB docs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname }  from "node:path";
import { fileURLToPath }     from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "docs", "data");

const RIDB_KEY  = process.env.RIDB_API_KEY;
const RIDB_BASE = "https://ridb.recreation.gov/api/v1";

if (!RIDB_KEY) {
  console.error("ERROR: RIDB_API_KEY environment variable is not set.");
  console.error("  Usage: RIDB_API_KEY=<key> node scripts/build_campgrounds.mjs");
  process.exit(1);
}

/* ─── helpers ──────────────────────────────────────────────────── */

async function ridbGet(endpoint, params = {}) {
  const url = new URL(`${RIDB_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { apikey: RIDB_KEY, accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RIDB ${endpoint} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Paginate through all results for an endpoint (RIDB uses offset/limit). */
async function ridbGetAll(endpoint, extraParams = {}) {
  const limit  = 100;
  let   offset = 0;
  let   total  = Infinity;
  const items  = [];

  while (offset < total) {
    const json = await ridbGet(endpoint, { ...extraParams, limit, offset });

    // Log first-page metadata so we can see what the API is returning
    if (offset === 0) {
      console.log(`    METADATA: ${JSON.stringify(json.METADATA?.RESULTS ?? json.METADATA ?? "(none)")}`);
    }

    total = parseInt(json.METADATA?.RESULTS?.TOTAL_COUNT ?? "0", 10);
    const batch = json.RECDATA ?? [];
    items.push(...batch);
    offset += limit;
    if (batch.length === 0) break;
  }
  return items;
}

/** Build a Recreation.gov reservation URL from a FacilityID. */
function reservationUrl(facilityId) {
  return `https://www.recreation.gov/camping/campgrounds/${facilityId}`;
}

/** Parse a fee string like "$18.00 per night" → "$18" or return null. */
function parseFee(feeDesc) {
  if (!feeDesc) return null;
  const match = feeDesc.match(/\$[\d,.]+/);
  return match ? match[0] : feeDesc.trim().slice(0, 30) || null;
}

/** Map a RIDB campground record to a GeoJSON feature (returns null if no coords). */
function toFeature(f, type) {
  const lat = parseFloat(f.FacilityLatitude);
  const lon = parseFloat(f.FacilityLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;

  const fee = parseFee(f.FacilityUseFeeDescription);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      name:        f.FacilityName,
      type,
      facilityId:  f.FacilityID,
      reserveUrl:  reservationUrl(f.FacilityID),
      fee,
      description: f.FacilityDescription
        ? f.FacilityDescription.replace(/<[^>]*>/g, "").trim().slice(0, 200) || null
        : null,
    },
  };
}

/* ─── main ────────────────────────────────────────────────────── */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Writing data to: ${OUT_DIR}`);

  const features = [];
  const seen     = new Set(); // deduplicate by FacilityID

  /* ── 1+2. NPS + USFS Campgrounds ────────────────────────────── */
  console.log("Fetching all campgrounds from RIDB (NPS + USFS)…");
  try {
    const allCamps = await ridbGetAll("campgrounds", {});
    console.log(`  → ${allCamps.length} total campground records`);

    // Log the keys of the first record so we can see the actual field names
    if (allCamps.length > 0) {
      console.log("  First record keys:", Object.keys(allCamps[0]).join(", "));
      console.log("  First record sample:", JSON.stringify({
        FacilityID:       allCamps[0].FacilityID,
        FacilityName:     allCamps[0].FacilityName,
        OrgAbbrevCode:    allCamps[0].OrgAbbrevCode,
        FacilityOrgType:  allCamps[0].FacilityOrgType,
        ORGANIZATION:     allCamps[0].ORGANIZATION,
        ParentOrgID:      allCamps[0].ParentOrgID,
        FacilityTypeDescription: allCamps[0].FacilityTypeDescription,
      }));
    }

    // Try matching by OrgAbbrevCode first; fall back to name/type heuristics
    const npsCamps  = allCamps.filter((f) =>
      f.OrgAbbrevCode === "NPS" ||
      (Array.isArray(f.ORGANIZATION) && f.ORGANIZATION.some((o) => o.OrgAbbrevCode === "NPS"))
    );
    const usfsCamps = allCamps.filter((f) =>
      f.OrgAbbrevCode === "USFS" ||
      (Array.isArray(f.ORGANIZATION) && f.ORGANIZATION.some((o) => o.OrgAbbrevCode === "USFS"))
    );
    console.log(`  → ${npsCamps.length} NPS, ${usfsCamps.length} USFS after filter`);

    for (const f of npsCamps) {
      if (seen.has(f.FacilityID)) continue;
      seen.add(f.FacilityID);
      const feat = toFeature(f, "NPS");
      if (feat) features.push(feat);
    }
    for (const f of usfsCamps) {
      if (seen.has(f.FacilityID)) continue;
      seen.add(f.FacilityID);
      const feat = toFeature(f, "National Forest");
      if (feat) features.push(feat);
    }
  } catch (e) {
    console.warn("  Campground fetch failed:", e.message);
  }

  /* ── 3. NPS Lodges (in-park lodging facilities) ──────────────── */
  console.log("Fetching NPS lodge facilities from RIDB…");
  try {
    // Fetch all NPS facilities and filter client-side by FacilityTypeDescription.
    // The query param is not reliably server-side-filtered by the RIDB API.
    const allNpsFacilities = await ridbGetAll("facilities", {
      OrgAbbrevCode: "NPS",
    });
    const lodgeKeywords = /lodg|inn|hotel|cabin|chalet|motel|resort|lodge/i;
    const npsLodges = allNpsFacilities.filter(
      (f) => lodgeKeywords.test(f.FacilityTypeDescription ?? "") ||
              lodgeKeywords.test(f.FacilityName ?? "")
    );
    console.log(`  → ${allNpsFacilities.length} NPS facility records, ${npsLodges.length} lodges after filter`);

    for (const f of npsLodges) {
      if (seen.has(f.FacilityID)) continue;
      seen.add(f.FacilityID);
      const feat = toFeature(f, "Lodge");
      if (feat) features.push(feat);
    }
  } catch (e) {
    console.warn("  NPS lodge fetch failed:", e.message);
  }

  /* ── 4. Write output ─────────────────────────────────────────── */
  const geojson = { type: "FeatureCollection", features };

  const npsCt   = features.filter((f) => f.properties.type === "NPS").length;
  const usfsCt  = features.filter((f) => f.properties.type === "National Forest").length;
  const lodgeCt = features.filter((f) => f.properties.type === "Lodge").length;

  await writeFile(
    resolve(OUT_DIR, "campgrounds.json"),
    JSON.stringify(geojson),   // minified — no need for pretty-print on data files
    "utf8"
  );

  console.log(`\n✅ Done.`);
  console.log(`   campgrounds.json → ${features.length} total features`);
  console.log(`     NPS campgrounds: ${npsCt}`);
  console.log(`     National Forest: ${usfsCt}`);
  console.log(`     NPS lodges:      ${lodgeCt}`);
}

main().catch((err) => {
  console.error("build_campgrounds failed:", err);
  process.exit(1);
});
