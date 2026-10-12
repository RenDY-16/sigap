# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Project-specific visual decisions

- The user selected the warm-white editorial SIGAP demo reference saved at `/tmp/codex-clipboard-02f6cec4-d25b-4f3c-b750-f64739a80297.png` as the landing-page source of truth.
- Keep the black oversized headline, compact top navigation, red “Mulai simulasi SOS” CTA, 3D city-and-beacon hero, and four-step “Kenali — Laporkan — Pantau — Selesai” journey.
- User prefers visible scroll and 3D motion. Keep the motion tied to scroll and interaction, but preserve normal browser scrolling, keep form/status controls steady, and honor `prefers-reduced-motion`.
- SIGAP is a placeholder label, not a finalized brand. Copy must keep stating that this is a demo and does not send real emergency assistance.

## Dashboard visual alignment (2026-10-05)

- Rendy requested the admin queue dashboard to match the selected landing page: warm-white canvas, oversized black Manrope headings, red accents, pill buttons, airy spacing, and the existing city illustration.
- Keep dashboard-specific presentation in `src/dashboard.css`, scoped to `.dashboard-landing-style`; preserve the operational data and authorization flows.
- An empty location queue should show a designed empty state without requesting map tiles. Tile requests send only the origin as Referer, preserving report-token path privacy; failed tile layers stop loading and leave coordinates available.

## Realtime operator review (2026-10-12)

- /dashboard/realtime keeps warm-white, black/red editorial styling aligned with the admin dashboard. Metadata-only queue cards, explicit pending/dead-letter states, pagination and required review reason; never imply a retry is confirmed delivery.
- Auditor reads only; operator_admin schedules retries. Exact permissions and region scope remain server-enforced. Browser rendering of this new page is not yet verified.

## Operational monitoring (2026-10-12)

- /dashboard/monitoring follows warm editorial dashboard styling. Use precise counts, explicit snapshot timestamps and stale-data labels. Manual refresh and staging thresholds are not live on-call alerting or public SLA. Keep metrics region-scoped, exclude citizen content/location, distinguish server emit acceptance from browser/human receipt. UI browser rendering remains unverified.
