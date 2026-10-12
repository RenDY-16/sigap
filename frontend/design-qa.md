# Design QA — Front-end SIGAP demo

Source visual truth: `/tmp/codex-clipboard-02f6cec4-d25b-4f3c-b750-f64739a80297.png`  
Implementation URL: `http://localhost:5173/`  
Implementation screenshot: `/home/rendy/SUPER-AGENT/frontend/qa/landing-desktop-1490x1058.png`  
Mobile screenshot: `/home/rendy/SUPER-AGENT/frontend/qa/landing-mobile-390x844.png`

## Viewport and normalization

- Source pixels: 1490 × 1058. The selected image has no separate CSS viewport; it was compared one-to-one at its native size.
- Implementation pixels: 1490 × 1058; CSS viewport: 1490 × 1058; device scale: 1.
- Both desktop images use the same crop, theme, landing route `/`, and initial `Kenali` state. No browser chrome is included.
- Mobile review used a separate 390 × 844 CSS viewport at device scale 1; it is a responsive check, not a same-viewport source comparison.

## Comparison evidence

- Full view: source and implementation were opened together in one comparison input. Source: `/tmp/codex-clipboard-02f6cec4-d25b-4f3c-b750-f64739a80297.png`; implementation: `/home/rendy/SUPER-AGENT/frontend/qa/landing-desktop-1490x1058.png`.
- Focused hero region: matching 1400 × 700 crops from offset `(45, 180)` were compared together. Source crop: `/home/rendy/SUPER-AGENT/frontend/qa/reference-hero-crop.png`; implementation crop: `/home/rendy/SUPER-AGENT/frontend/qa/landing-hero-crop.png`.
- The focused crop was useful for checking headline scale and wrapping, CTA width and position, beacon placement, diorama crop, and the four-step progress rhythm.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- Typography: Manrope Variable is used consistently. The oversized headline, tight leading, bold black hierarchy, and small tracked labels follow the reference. The subtitle and CTA remain readable at desktop and mobile sizes.
- Spacing and layout: header, left hero column, red CTA, bottom journey progress, and scroll cue closely follow the source composition. The mobile layout places its CTA and disclaimer before the city illustration and keeps the scroll cue above the bottom progress row.
- Colors and tokens: warm-white canvas, dark ink, quiet gray text, red primary action, and blue location route match the reference. Status colors remain muted and include text labels.
- Image and asset fidelity: the transparent generated diorama keeps the glass beacon, red shield, ivory city, and blue route visible. A static image remains underneath the animated scene until its texture is ready and when reduced motion is enabled; no CSS map artwork or placeholder image is used.
- Copy and content: landing copy and four journey labels match the selected mock. The demo-only warning stays visible; report, location, unit, and status surfaces keep saying that they are simulated.
- Responsive and accessibility review: the 390 × 844 capture keeps the headline, CTA, demo note, city illustration, and progress readable. Primary controls have labels and keyboard focus styles; GPS and simulation are identified by text and icon; reduced motion disables the Three.js scene and GSAP scroll movement.

## Comparison history

1. Initial desktop capture had no visible city because the WebGL texture had not rendered in the headless capture. Added a static generated-image underlay that remains visible before texture readiness and when WebGL is unavailable. The final 1490 × 1058 screenshot shows the full diorama and beacon.
2. Initial narrow mobile capture put the city under the CTA and crowded the scroll cue against the journey progress. Moved the mobile art below the CTA/disclaimer and lifted the scroll cue. The final 390 × 844 screenshot shows separate, readable regions.
3. Final paired desktop and focused-crop comparisons found only small expected differences in the generated city art's perspective and detailing. These do not change the hierarchy or usable controls.

## Interaction and verification notes

- In the Codex in-app browser, the landing CTA opened `/report/new` without creating an incident.
- The GPS path created an active report with “GPS belum tersedia”; the browser location permission was not requested during review.
- The simulation path accepted a manually selected neutral coordinate (`0, 0`) and displayed the persistent “Lokasi simulasi” source label.
- The local demo login opened the dashboard. The reviewer verified the report, assigned Unit 01 (simulasi), and completed it; the citizen status reflected the updated history in the same browser session.
- The `Pantau` journey link scrolled to its chapter and updated the active progress marker.
- Backend integration walkthrough: Express answered `GET /api/healthz`; the citizen tab created a simulation incident, the staff tab logged in with the local demo account, and the dashboard listed the server-backed incident and map marker. Verifying it, assigning Unit 01 (simulasi), then completing it updated the citizen status and history through Socket.IO in real time.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` passed. `npm run build` passed and generated the client build. Automated test suites were not run. Vite reports that the main minified client chunk is about 1.57 MB (459 kB gzip), above its 500 kB advisory threshold.
- Scope gap: this is a local demo, not emergency dispatch. Incidents and staff sessions exist only in server memory and disappear on restart; no database or persistent session store is configured. The walkthrough used local HTTP, not trusted HTTPS on a LAN device. The hero uses a rendered PNG in a scroll-responsive Three.js scene; Blender source and editable GLB remain future work.

**Follow-up work**

- Added HTTPS LAN guards and `docs/fathul/run-demo.md`; still needs a trusted certificate installed on the demo phone and an on-device Geolocation check.
- Replace or augment the rendered hero plane with an optimized editable GLB when the Blender asset task begins; preserve the PNG fallback and reduced-motion behavior.
- Tune the exact camera path after receiving feedback on the running prototype.

final result: passed
