# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Project-specific visual decisions

- The user selected the warm-white editorial SIGAP reference saved at `/tmp/codex-clipboard-02f6cec4-d25b-4f3c-b750-f64739a80297.png` as the landing-page source of truth.
- Keep the black oversized headline, compact top navigation, red “Buat laporan” CTA, 3D city-and-beacon hero, and four-step “Kenali — Laporkan — Pantau — Selesai” journey.
- User prefers visible scroll and 3D motion. Keep the motion tied to scroll and interaction, but preserve normal browser scrolling, keep form/status controls steady, and honor `prefers-reduced-motion`.
- SIGAP is a placeholder label, not a finalized brand. On 2026-10-12 Rendy requested removing the visible word “demo”. Keep truthful copy stating that reports are stored locally and official emergency services are not connected. Internal mock dispatch and manual test locations must remain clearly marked as simulation.

## Dashboard visual alignment (2026-10-05)

- Rendy requested the admin queue dashboard to match the selected landing page: warm-white canvas, oversized black Manrope headings, red accents, pill buttons, airy spacing, and the existing city illustration.
- Keep dashboard-specific presentation in `src/dashboard.css`. Shared staff shell styling uses `.dashboard-page`; queue-specific presentation uses `.dashboard-landing-style`. Preserve the operational data and authorization flows.
- An empty location queue should show a designed empty state without requesting map tiles. Tile requests send only the origin as Referer, preserving report-token path privacy; failed tile layers stop loading and leave coordinates available.

## Realtime operator review (2026-10-12)

- /dashboard/realtime keeps warm-white, black/red editorial styling aligned with the admin dashboard. Metadata-only queue cards, explicit pending/dead-letter states, pagination and required review reason; never imply a retry is confirmed delivery.
- Auditor reads only; operator_admin schedules retries. Exact permissions and region scope remain server-enforced. Browser rendering of this new page is not yet verified.

## Operational monitoring (2026-10-12)

- /dashboard/monitoring follows warm editorial dashboard styling. Use precise counts, explicit snapshot timestamps and stale-data labels. Manual refresh and staging thresholds are not live on-call alerting or public SLA. Keep metrics region-scoped, exclude citizen content/location, distinguish server emit acceptance from browser/human receipt. UI browser rendering remains unverified.

## Local phone presentation (2026-10-12)

- Rendy wants reporting with device GPS and phone access without deployment. Use the existing HTTPS LAN mode; laptop and phone must share a network, and browser certificate trust plus location permission need device verification. Never equate a successful build or laptop HTTP check with verified phone GPS.

## Bright white correction (2026-10-13)

- Rendy explicitly wants bright white backgrounds, not warm or yellowish white. Use shared --canvas: #ffffff on landing and all dashboard pages, with neutral gray borders and gradients. This supersedes earlier warm-white canvas instructions.
- Match landing typography and red pill actions throughout staff pages; keep operational controls readable and avoid a dark first metric card that introduces a different visual direction.

## Magazine and minimalism across all pages

- Rendy requests the same magazine/minimalism direction on every page, not only dashboard: bright white, black editorial headings, thin section rules, restrained red pill actions, neutral minimal form controls, and fewer rounded card containers. Use compact literal titles on task pages. Dashboard illustration is a real PNG asset, separate from live operational map data.

- Use distinct thematic PNG assets: dashboard city for overview, report sheet/pencil for intake, pin/route for tracking, shield/access for login. Never reuse city illustration on every page. Illustrations are decorative and must not be mistaken for live data. Keep intake artwork small on mobile.

## XAMPP portability

- Rendy wants minimal manual environment setup when moving laptops. Use npm run xampp / npm run xampp:lan with automatic private config, random session secret, fresh MariaDB schema and interactive first admin. Preserve existing .env unless explicitly reconfiguring. Never claim XAMPP runtime verified until MariaDB actually runs. PostgreSQL remains supported.

## Admin handling (2026-10-13)

- Rendy requests functional admin handling. operator_admin can work incidents and manage escalations within assigned regions, alongside staff/config/audit administration. Auditor remains read only; ownership, valid transitions, reason requirements, session validation and region boundaries remain enforced.
- Queue items explicitly open detail and scroll to the detail section. Choosing an item must not reload the entire queue or clear the selection on a failed detail fetch. Keep retry/error feedback visible and explain required reasons next to disabled actions.
