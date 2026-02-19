# Security Policy

## Key-Handling Policy

### Runtime Mapbox Token (Public by Design)

The Mapbox token in `docs/js/config.js` is intentionally public — all browser
JavaScript is readable by anyone who opens DevTools. This is unavoidable for
client-rendered mapping apps.

**Required mitigations (you must configure these in the Mapbox dashboard):**

1. **Restrict allowed URLs** — In the Mapbox token settings, under
   *Allowed URLs*, add only:
   - `https://<your-github-username>.github.io/<repo-name>/`
   - `http://localhost:*` (for local development only)

   Requests from any other origin will be rejected by Mapbox's servers.

2. **Restrict token scopes** — Enable only:
   - Styles (for map rendering)
   - Directions (for route preview)
   Disable all other endpoint scopes.

3. **Set usage caps** — In Mapbox Account → Billing, set a monthly usage
   alert and cap at a comfortable limit. Free tier includes 100,000 map
   loads/month.

**How to rotate the runtime token:**
1. Go to Mapbox dashboard → Tokens
2. Create a new token with the same URL restrictions and scopes
3. Replace the `mapboxToken` value in `docs/js/config.js`
4. Commit and push (GitHub Pages redeploys automatically)
5. Delete the old token from Mapbox

---

### Build-Time Secrets (Never Committed)

Two secrets are used **only** in GitHub Actions and are never present in
any file in `docs/`:

| Secret name         | What it's for                                  |
|---------------------|------------------------------------------------|
| `NPS_API_KEY`       | Fetching park data from developer.nps.gov      |
| `MAPBOX_TOKEN_BUILD`| Computing the pairwise drive-time matrix       |

**These secrets are stored in GitHub → Settings → Secrets and variables →
Actions.** They are injected into build scripts via environment variables
and never written to any output file.

**Verifying no secrets leaked into docs/:**
```bash
# Should print nothing:
grep -r "NPS_API_KEY\|MAPBOX_TOKEN_BUILD\|sk\." docs/
```

---

### NPS API Key

The NPS API key is treated as a non-secret but still kept out of the
browser. All NPS data is fetched at build time and committed as static JSON.
The runtime app reads `docs/data/parks.json` and `docs/data/units.json`
directly — no NPS API calls occur in the browser.

---

### No PII in Shared Links

The share-link feature (`#it=...` URL hash) encodes only:
- Park codes (e.g., `acad`, `yell`)
- UI preferences

No user identity, location, or personal information is ever encoded in links.

---

### Reporting a Vulnerability

If you discover a security issue, please open a GitHub Issue marked
**[Security]** or contact the maintainer directly. Do not include
sensitive tokens or credentials in issue reports.
