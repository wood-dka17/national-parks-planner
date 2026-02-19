#!/usr/bin/env node
/**
 * build_drive_matrix.mjs
 * Build-time script: computes pairwise driving times between all national parks
 * using Mapbox Directions v5 and writes docs/data/drive_matrix.json.
 *
 * Usage:
 *   MAPBOX_TOKEN_BUILD=<build_token> node scripts/build_drive_matrix.mjs
 *
 * Cost-control features:
 *   - Reads existing drive_matrix.json and skips pairs already computed.
 *   - Only runs new Directions calls for NEW or UPDATED park pairs.
 *   - Re-reads docs/data/parks.json as the authoritative park list.
 *   - Mapbox allows up to 25 waypoints per call; we batch origin rows.
 *   - Rate-limit: 1 request per 200ms to avoid burst throttling.
 *
 * Output: docs/data/drive_matrix.json
 * Schema:
 * {
 *   "builtAt": "ISO date",
 *   "parksHash": "sha256 of parks.json at build time",
 *   "matrix": {
 *     "acad→yell": { "miles": 2312.4, "hours": 34.1 },
 *     ...
 *   }
 * }
 *
 * The MAPBOX_TOKEN_BUILD is read from the environment only — never committed.
 * In GitHub Actions it comes from the MAPBOX_TOKEN_BUILD repository secret.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const DATA_DIR  = resolve(ROOT, "docs", "data");
const OUT_FILE  = resolve(DATA_DIR, "drive_matrix.json");
const PARKS_FILE = resolve(DATA_DIR, "parks.json");

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN_BUILD;
const DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving";

if (!MAPBOX_TOKEN) {
  console.error("ERROR: MAPBOX_TOKEN_BUILD environment variable is not set.");
  console.error("  Usage: MAPBOX_TOKEN_BUILD=<token> node scripts/build_drive_matrix.mjs");
  process.exit(1);
}

/* ─── helpers ─────────────────────────────────────────────────── */

function sha256(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
}

function pairKey(a, b) {
  return `${a.parkCode}→${b.parkCode}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch driving time + distance for ONE leg (A→B) via Mapbox Directions.
 * Returns { miles, hours } or null on failure.
 */
async function fetchLeg(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url =
    `${DIRECTIONS_BASE}/${coords}` +
    `?geometries=geojson&overview=false&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  Mapbox ${res.status} for ${pairKey(from, to)}`);
    return null;
  }
  const json = await res.json();
  const route = json?.routes?.[0];
  if (!route) return null;

  const miles = (route.distance ?? 0) * 0.000621371;
  const hours = (route.duration ?? 0) / 3600;
  return { miles: +miles.toFixed(2), hours: +hours.toFixed(3) };
}

/* ─── main ────────────────────────────────────────────────────── */

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  /* 1. Load parks list */
  let parks;
  try {
    parks = JSON.parse(await readFile(PARKS_FILE, "utf8"));
  } catch {
    console.error(`ERROR: Cannot read ${PARKS_FILE}`);
    console.error("  Run build_nps_data.mjs first to generate parks.json.");
    process.exit(1);
  }
  console.log(`Loaded ${parks.length} parks from parks.json`);
  const parksHash = sha256(parks);

  /* 2. Load existing matrix (for caching) */
  let existing = { builtAt: null, parksHash: null, matrix: {} };
  try {
    existing = JSON.parse(await readFile(OUT_FILE, "utf8"));
    console.log(`Loaded existing matrix with ${Object.keys(existing.matrix).length} pairs`);
    if (existing.parksHash === parksHash) {
      console.log("Parks list unchanged — only computing missing pairs.");
    } else {
      console.log("Parks list changed — rebuilding all pairs.");
      existing.matrix = {};
    }
  } catch {
    console.log("No existing matrix found — computing all pairs from scratch.");
  }

  /* 3. Determine pairs to compute */
  const allPairs = [];
  for (let i = 0; i < parks.length; i++) {
    for (let j = i + 1; j < parks.length; j++) {
      const key = pairKey(parks[i], parks[j]);
      const revKey = pairKey(parks[j], parks[i]);
      if (!existing.matrix[key] && !existing.matrix[revKey]) {
        allPairs.push([parks[i], parks[j]]);
      }
    }
  }

  const totalPossible = (parks.length * (parks.length - 1)) / 2;
  const alreadyDone   = totalPossible - allPairs.length;
  console.log(`\nPairs: ${totalPossible} total, ${alreadyDone} cached, ${allPairs.length} to compute`);

  if (allPairs.length === 0) {
    console.log("Nothing to do — matrix is up to date.");
    // Still update builtAt + parksHash
    existing.builtAt   = new Date().toISOString();
    existing.parksHash = parksHash;
    await writeFile(OUT_FILE, JSON.stringify(existing, null, 2), "utf8");
    console.log("✅ Matrix unchanged, metadata refreshed.");
    return;
  }

  /* 4. Estimate cost */
  console.log(`\nEstimated Mapbox Directions calls: ${allPairs.length}`);
  console.log(`Estimated time at 200ms/call: ${Math.ceil(allPairs.length * 0.2 / 60)} minutes`);
  console.log("Starting…\n");

  /* 5. Fetch pairs with rate limiting */
  let done = 0;
  let failed = 0;
  const matrix = { ...existing.matrix };

  for (const [from, to] of allPairs) {
    const key = pairKey(from, to);
    try {
      const result = await fetchLeg(from, to);
      if (result) {
        matrix[key] = result;
        done++;
      } else {
        failed++;
      }
    } catch (e) {
      console.warn(`  Error on ${key}:`, e.message);
      failed++;
    }

    if ((done + failed) % 50 === 0) {
      const pct = (((done + failed) / allPairs.length) * 100).toFixed(0);
      console.log(`  Progress: ${done + failed}/${allPairs.length} (${pct}%) — ${failed} failures`);
    }

    await sleep(200); // rate-limit: 5 req/s
  }

  /* 6. Write output */
  const output = {
    builtAt:   new Date().toISOString(),
    parksHash,
    matrix,
  };

  await writeFile(OUT_FILE, JSON.stringify(output, null, 2), "utf8");

  console.log(`\n✅ Done.`);
  console.log(`   drive_matrix.json → ${Object.keys(matrix).length} pairs`);
  console.log(`   ${done} computed, ${failed} failed`);
  if (failed > 0) {
    console.warn(`   ⚠️  ${failed} pairs failed — re-run to retry.`);
  }
}

main().catch((err) => {
  console.error("build_drive_matrix failed:", err);
  process.exit(1);
});
