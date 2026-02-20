#!/usr/bin/env node
/**
 * build_nps_data.mjs
 * Build-time script: fetches NPS park + stamp data and writes static JSON
 * into docs/data/ so the runtime app never needs to call the NPS API.
 *
 * Usage:
 *   NPS_API_KEY=<your_key> node scripts/build_nps_data.mjs
 *
 * Outputs:
 *   docs/data/parks.json      — 63 national parks (slim fields)
 *   docs/data/units.json      — all 474 NPS passport stamp units
 *   docs/data/meta.json       — build date + content hash for cache busting
 *
 * The NPS_API_KEY is read from the environment only — never committed.
 * In GitHub Actions it comes from the NPS_API_KEY repository secret.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const OUT_DIR   = resolve(ROOT, "docs", "data");

const NPS_KEY  = process.env.NPS_API_KEY;
const NPS_BASE = "https://developer.nps.gov/api/v1";

if (!NPS_KEY) {
  console.error("ERROR: NPS_API_KEY environment variable is not set.");
  console.error("  Usage: NPS_API_KEY=<key> node scripts/build_nps_data.mjs");
  process.exit(1);
}

/* ─── helpers ─────────────────────────────────────────────────── */

async function npsGet(endpoint, params = {}) {
  const url = new URL(`${NPS_BASE}/${endpoint}`);
  url.searchParams.set("api_key", NPS_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NPS ${endpoint} → HTTP ${res.status}`);
  return res.json();
}

/** Extract the best entrance fee from the NPS entranceFees array. */
function parseBestFee(entranceFees) {
  if (!Array.isArray(entranceFees) || !entranceFees.length) return {};
  // Prefer the "per vehicle" fee, else take the first non-zero, else first entry
  const perVehicle = entranceFees.find((f) =>
    /vehicle/i.test(f.title) || /vehicle/i.test(f.description)
  );
  const nonZero = entranceFees.find((f) => Number(f.cost) > 0);
  const chosen  = perVehicle ?? nonZero ?? entranceFees[0];
  return {
    entranceFee:     Number(chosen.cost ?? 0),
    entranceFeeDesc: chosen.title || chosen.description || "",
  };
}

/** Summarise operating hours for display. Returns a short string or null. */
function parseOperatingHours(operatingHours) {
  if (!Array.isArray(operatingHours) || !operatingHours.length) return null;
  const first = operatingHours[0];
  const desc  = first.description?.trim();
  // Truncate to 120 chars to keep parks.json slim
  return desc ? desc.slice(0, 120) + (desc.length > 120 ? "…" : "") : null;
}

/** Fetch all pages of an NPS endpoint (limit/start pagination). */
async function npsGetAll(endpoint, extraParams = {}) {
  const limit = 50;
  let start = 0;
  let total = Infinity;
  const items = [];

  while (start < total) {
    const json = await npsGet(endpoint, { ...extraParams, limit, start });
    total = parseInt(json.total ?? "0", 10);
    items.push(...(json.data ?? []));
    start += limit;
    if (json.data?.length === 0) break;
  }

  return items;
}

function sha256(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
}

/* ─── NPS Passport stamp region lookup (state → region) ──────── */
const STATE_TO_PASSPORT = {
  ME:"North Atlantic", NH:"North Atlantic", VT:"North Atlantic",
  MA:"North Atlantic", RI:"North Atlantic", CT:"North Atlantic",
  NY:"North Atlantic", NJ:"North Atlantic",
  PA:"Mid-Atlantic", MD:"Mid-Atlantic", DE:"Mid-Atlantic",
  VA:"Mid-Atlantic", WV:"Mid-Atlantic",
  DC:"National Capital",
  NC:"Southeast", SC:"Southeast", GA:"Southeast",
  FL:"Southeast", AL:"Southeast", MS:"Southeast",
  TN:"Southeast", KY:"Southeast", AR:"Southeast",
  OH:"Midwest", MI:"Midwest", IN:"Midwest",
  WI:"Midwest", MN:"Midwest", IL:"Midwest",
  MO:"Midwest", IA:"Midwest",
  ND:"Midwest", SD:"Midwest", NE:"Midwest",
  KS:"Midwest",
  TX:"Southwest", OK:"Southwest", NM:"Southwest",
  AZ:"Southwest", CO:"Southwest",
  UT:"Rocky Mountain", WY:"Rocky Mountain",
  MT:"Rocky Mountain", ID:"Rocky Mountain",
  WA:"Pacific Northwest & Alaska", OR:"Pacific Northwest & Alaska",
  AK:"Pacific Northwest & Alaska",
  CA:"Western", NV:"Western", HI:"Western",
  PR:"Southeast", VI:"Southeast", GU:"Pacific", AS:"Pacific",
  MP:"Pacific",
};

function passportRegion(statesStr) {
  if (!statesStr) return "Other";
  const codes = statesStr.split(",").map((s) => s.trim());
  return STATE_TO_PASSPORT[codes[0]] ?? "Other";
}

/* ─── main ────────────────────────────────────────────────────── */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Writing data to: ${OUT_DIR}`);

  /* ── 1. Fetch all NPS parks ──────────────────────────────────── */
  console.log("Fetching NPS parks list…");
  const allUnits = await npsGetAll("parks", { fields: "entranceFees,operatingHours,description,addresses" });
  console.log(`  → ${allUnits.length} total NPS units`);

  /* ── 2. Identify national park designation set ───────────────── */
  const NP_DESIGNATIONS = new Set([
    "National Park", "National Parks",           // singular + plural (e.g. Sequoia & Kings Canyon)
    "National Park & Preserve",
    "National Park and Preserve", "National Preserve",
    "National Reserve",
  ]);
  const NS_DESIGNATIONS = new Set([
    "National Seashore", "National Lakeshore",
  ]);

  /* ── 3. Build passport stamp units list (all 474) ────────────── */
  console.log("Building units.json…");
  const stampUnits = allUnits
    .filter((u) => {
      const lat = parseFloat(u.latitude);
      const lon = parseFloat(u.longitude);
      return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
    })
    .map((u) => {
      const designation = u.designation || "Other";
      let layer = "other";
      if (NP_DESIGNATIONS.has(designation))  layer = "national-park";
      else if (NS_DESIGNATIONS.has(designation)) layer = "national-seashore";

      return {
        name:          u.fullName,
        parkCode:      u.parkCode,
        designation,
        layer,
        lat:           parseFloat(u.latitude),
        lon:           parseFloat(u.longitude),
        states:        u.states,
        url:           u.url,
        passportRegion: passportRegion(u.states),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  /* ── 4. Build slim parks.json (63 national parks) ───────────── */
  console.log("Building parks.json…");

  // Build a lookup from parkCode → raw NPS unit so we can pull extra fields
  const rawByCode = new Map(allUnits.map((u) => [u.parkCode, u]));

  const parks = stampUnits
    .filter((u) => u.layer === "national-park")
    .map((u, i) => {
      const raw = rawByCode.get(u.parkCode) ?? {};
      const { entranceFee, entranceFeeDesc } = parseBestFee(raw.entranceFees);
      const operatingHours = parseOperatingHours(raw.operatingHours);
      // Trim description to 300 chars for the park card
      const description = raw.description
        ? raw.description.replace(/<[^>]*>/g, "").trim().slice(0, 300) +
          (raw.description.length > 300 ? "…" : "")
        : "";
      return {
        id:              i,       // numeric index for Mapbox feature-state
        name:            u.name,
        parkCode:        u.parkCode,
        state:           u.states,
        lat:             u.lat,
        lon:             u.lon,
        url:             u.url,
        designation:     u.designation,
        description:     description     || undefined,
        entranceFee:     entranceFee     ?? undefined,
        entranceFeeDesc: entranceFeeDesc || undefined,
        operatingHours:  operatingHours  || undefined,
      };
    });

  /* ── 5. Fetch visitor center coords and merge into parks ────── */
  console.log("Fetching visitor center coordinates…");
  const parkCodes = parks.map((p) => p.parkCode);
  const vcByCode  = new Map();

  // The NPS visitorcenters API does NOT support URL-encoded commas in parkCode,
  // so we must fetch each park individually. latitude/longitude are returned by
  // default — no special fields parameter needed.
  for (const code of parkCodes) {
    try {
      const vcs = await npsGetAll("visitorcenters", { parkCode: code });
      for (const vc of vcs) {
        const vcCode = vc.parkCode?.toLowerCase();
        if (!vcCode || vcByCode.has(vcCode)) continue;
        const lat = parseFloat(vc.latitude);
        const lon = parseFloat(vc.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
          vcByCode.set(vcCode, { lat, lon, visitorCenterName: vc.name ?? "" });
        }
      }
    } catch (e) {
      console.warn(`  VC fetch failed for ${code}:`, e.message);
    }
  }

  let vcUpdated = 0;
  for (const park of parks) {
    const vc = vcByCode.get(park.parkCode?.toLowerCase());
    if (vc) {
      park.lat = vc.lat;
      park.lon = vc.lon;
      park.visitorCenterName = vc.visitorCenterName;
      vcUpdated++;
    }
  }
  console.log(`  → Visitor center coords for ${vcUpdated}/${parks.length} parks`);

  /* ── 6. Write files ─────────────────────────────────────────── */
  const meta = {
    builtAt:      new Date().toISOString(),
    parksCount:   parks.length,
    unitsCount:   stampUnits.length,
    parksHash:    sha256(parks),
    unitsHash:    sha256(stampUnits),
  };

  await Promise.all([
    writeFile(resolve(OUT_DIR, "parks.json"),  JSON.stringify(parks,      null, 2), "utf8"),
    writeFile(resolve(OUT_DIR, "units.json"),  JSON.stringify(stampUnits, null, 2), "utf8"),
    writeFile(resolve(OUT_DIR, "meta.json"),   JSON.stringify(meta,       null, 2), "utf8"),
  ]);

  console.log(`\n✅ Done.`);
  console.log(`   parks.json  → ${parks.length} parks`);
  console.log(`   units.json  → ${stampUnits.length} stamp units`);
  console.log(`   meta.json   → built ${meta.builtAt}`);
}

main().catch((err) => {
  console.error("build_nps_data failed:", err);
  process.exit(1);
});
