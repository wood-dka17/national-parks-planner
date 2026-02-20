/**
 * config.js — Single source of truth for the runtime Mapbox public token.
 *
 * SECURITY NOTES:
 * - This token is intentionally public (all browser JS is readable).
 * - Restrict this token in your Mapbox account dashboard:
 *     Allowed URLs: https://<your-username>.github.io/<repo-name>/
 *     Optional dev: http://localhost:*
 * - Scope it to the minimum required: Styles Read + Directions
 * - Set usage caps in the Mapbox dashboard.
 * - To rotate: generate a new restricted token in Mapbox, replace below,
 *   delete the old token from Mapbox. The build pipeline uses a SEPARATE
 *   secret (MAPBOX_TOKEN_BUILD) stored in GitHub Actions — never committed.
 *
 * See SECURITY.md for the full key-handling policy.
 */
window.APP_CONFIG = {
  // This is a PUBLIC token (pk.) intentionally included here.
  // It is URL-restricted in the Mapbox dashboard to only work on this site.
  // See SECURITY.md for the full key-handling policy.
  mapboxToken: "pk.eyJ1Ijoid29vZC1ka2ExNyIsImEiOiJjbWpkcHY1c3AwOHloM2twcnFzZG5mN3R5In0.FzN2MnoK3o7K4fZweWOSlw",

  /**
   * Base path for static data assets.
   * On GitHub Pages this resolves to /national-parks-planner/data/...
   * In local dev (file:// or localhost) it resolves to ./data/...
   * Override here if your repo name or Pages path differs.
   */
  dataBase: (() => {
    // Detect GitHub Pages environment vs local dev
    if (location.hostname.endsWith("github.io")) {
      // e.g. https://rosswood.github.io/national-parks-planner/
      const parts = location.pathname.split("/").filter(Boolean);
      const repo  = parts[0] ?? "";
      return repo ? `/${repo}/data` : "/data";
    }
    return "./data";
  })(),
};
