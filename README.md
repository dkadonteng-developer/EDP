# InfoPort

**Equipment & Maintenance Information Management System**
Built for Ghacem (HeidelbergCement / Heidelberg Materials Group, Ghana) as an Engineering in Training (EiT) project.

**Live app:** https://edp-omega.vercel.app/
No login required to browse equipment, documents, and diagrams — sign-in is only needed for the admin dashboards.

---

## What this is

InfoPort puts every piece of equipment knowledge a technician needs — manuals, exploded-view diagrams, spare-parts specs, shift handover history — on their phone, works fully offline, and installs like a native app. It replaces paper binders, informal spare-parts requests, and verbal shift handovers with a single searchable, auditable record.

See `EiT_Presentation` (or ask for the slide deck) for the full problem/solution narrative, cost estimate, and roadmap presented to the review panel.

---

## Tech stack

No build tooling — plain HTML/CSS/JS served directly, so any static host (Vercel, GitHub Pages, etc.) works with zero config.

| Layer | Technology |
|---|---|
| Hosting | Vercel (auto-deploys from this repo's `main` branch) |
| Database | Firebase Firestore |
| Auth | Firebase Authentication (email/password for admins; anonymous for technician actions that need an audit trail without a login) |
| Offline / installable | Service worker (`service-worker.js`) + Web App Manifest (`manifest.json`) — full PWA |
| Search | [Fuse.js](https://www.fusejs.io/) — fuzzy client-side search across equipment, documents, parts, resources, and recent logs |
| PDF viewing | [PDF.js](https://mozilla.github.io/pdf.js/) — custom in-app viewer with continuous scroll, search, and fullscreen |
| PDF export | [jsPDF](https://github.com/parallax/jsPDF) + `jspdf-autotable` |
| Excel export | [SheetJS (xlsx)](https://sheetjs.com/) |
| Email notifications | [EmailJS](https://www.emailjs.com/) |
| SMS notifications | Hubtel SMS API, proxied through a Cloudflare Worker (`hubtel-sms-worker.js`) so the Hubtel credentials never reach the browser |

---

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home dashboard — equipment list, groups, "Download Everything for Offline Use" |
| `equipment.html` | Equipment detail — documents (universal preview: PDF/image/video/YouTube/Vimeo/link, with fullscreen), interactive exploded-view diagrams, spare-parts-in-assembly, internal resources, safety checklists, PM checklists |
| `group.html` | Equipment group view |
| `inventory.html` | Spare parts catalogue + technician ordering flow (auto-notifies Stores and MCC by email/SMS) |
| `handover.html` | Shift handover reports — technician entry (stoppages, photos) + admin Overview (search/filter/group/sort) and Log Entries (bulk and per-report PDF/Excel export) |
| `admin.html` | Main admin dashboard — equipment CRUD, groups, exploded-view diagram management (drag-to-reorder, per-part components), internal resources, PM/safety checklist config, history |
| `stores-admin.html` | Stores admin — spare parts inventory management + Orders panel (filter/sort/search/group, Excel/PDF export, fulfil/cancel per item) |
| `offline.html` | Offline fallback page shown when a page isn't cached and there's no connection |

## Supporting scripts

| File | Purpose |
|---|---|
| `service-worker.js` | Caches the app shell for offline use; also handles the explicit "download for offline" flow with classified failure reporting (storage quota vs. network vs. missing file) |
| `search.js` | Site-wide fuzzy search — self-injecting button/overlay, include with one `<script>` tag on any page |
| `pull-to-refresh.js` | Custom pull-to-refresh gesture for mobile |
| `loading-screen.js` | App loading splash |
| `hubtel-sms-worker.js` | Cloudflare Worker source — deploy separately (see comments in the file for step-by-step instructions); keeps Hubtel credentials server-side |
| `manifest.json` | PWA manifest (name, icons, theme color) |
| `equipment.json` | Local seed/reference data (Firestore is the actual source of truth in production) |

---

## Data model (Firestore collections)

| Collection | Holds |
|---|---|
| `equipment` | Core equipment records (name, department, manufacturer, lightweight document/diagram metadata) |
| `groups` | Equipment group tiles shown on the dashboard |
| `equipmentParts` | Parts pinned to an exploded-view diagram |
| `explodedViewDiagrams` | Diagram images — one doc per diagram (kept separate from `equipment` so multiple large images never risk Firestore's 1 MiB document cap) |
| `partComponents` | Spare parts that make up an assembly part (name, spec, function, photo) — same one-doc-per-item reasoning as above |
| `internalResources` | Manuals/procedures/drawings/videos scoped to equipment or a specific part |
| `spareParts` | Stores inventory |
| `partOrders` | Spare-part order line items (a multi-item order shares one `orderGroupId` across several docs) |
| `handoverLogs` | Shift handover report entries |
| `handoverLogPhotos` | Photos attached to a handover report — own collection, same 1 MiB reasoning |
| `equipmentLogs` | Maintenance log / comment entries |
| `safetyChecklists` / `safetyChecklistCompletions` | Per-equipment safety checklist config and sign-offs |
| `pmChecklists` / `pmChecklistCompletions` | Preventive maintenance checklist config and sign-offs |
| `takeFiveAssessments` | Pre-task safety assessments |
| `emailSubscribers` | Email notification opt-ins |
| `admins` | Who has admin access — managed by hand in the Firebase Console, never writable from the app |
| `settings` | Misc app configuration |

Security rules live in `firestore.rules` at the repo root — paste the full file into **Firebase Console → Firestore Database → Rules** whenever it changes. The general pattern throughout: public read for anything technicians need without logging in, writes gated to signed-in admins via an `isAdmin()` check against the `admins` collection.

---

## Key features

- **Universal document preview** — PDFs get a full custom viewer (continuous scroll, in-document search, fullscreen); images, video, YouTube/Vimeo links, and generic URLs all render correctly through the same fullscreen-capable preview instead of failing.
- **Interactive exploded-view diagrams** — multiple diagrams per equipment, drag-to-reorder by their name box, tap a pinned part for its spec/function/tools and the individual spare parts that make it up.
- **Spare parts ordering** — a technician orders straight from the parts catalogue; Stores and the Maintenance Control Centre get auto-notified by email (EmailJS) and SMS (Hubtel), with the order already logged for Stores to track, fulfil, or cancel.
- **Shift handover reporting** — technician name, supervisor, shift (including Straight Day), timed stoppages, and photos; admins get a searchable/filterable/groupable overview plus Excel and per-report PDF export.
- **Offline-first PWA** — installable to a home screen, works with no signal via the service worker's cache-first strategy, and has an explicit "download everything" flow that checks available device storage upfront and reports *why* an item failed (out of storage vs. bad connection vs. missing file) instead of one generic error.
- **Admin auth** — Firebase email/password, with a 5-minute inactivity timeout (not a refresh-triggered one) and retry-based verification so a transient network blip doesn't force a sign-out.
- **External document links** — admins can paste a link from Dropbox/Drive/OneDrive instead of uploading, with a built-in "Test Link" check and an "Anyone with the link" reminder so technicians never hit a login wall.

---

## Local development

No build step — just serve the folder statically and open `index.html`.

```bash
npx serve .
# or
python3 -m http.server 8000
```

You'll need your own Firebase project (Firestore + Authentication enabled) and to update the `firebaseConfig` object near the top of each HTML file's `<script>` block to point at it, then publish `firestore.rules` to that project.

## Deployment

Push to `main` — Vercel auto-deploys from this repo. No environment variables are needed on the Vercel side; Firebase config is public-safe client config embedded in the HTML (access is enforced by Firestore Security Rules, not by hiding the config).

The Cloudflare Worker (`hubtel-sms-worker.js`) deploys separately — see the setup steps in that file's header comment — and its URL + your Hubtel credentials get plugged into `inventory.html` and the Cloudflare dashboard respectively.

---

## Known gaps / next steps

- **SMS to MCC is not fully wired up** — `SMS_PROXY_URL` and `MCC_PHONE_NUMBER` in `inventory.html` are still placeholders pending the Cloudflare Worker deployment and a confirmed MCC phone number.
- **PDF/image uploads currently go through a GitHub-hosted flow** using a personal access token entered by the admin and kept in browser `localStorage`. This works but is not the most secure option long-term (a broadly-scoped token sitting in browser storage). The recommended fix (moving to Firebase Cloud Storage) requires linking a Google Cloud billing account, which wasn't approved at time of writing — the interim recommendation is pasting links from an external host (Dropbox/Drive/OneDrive) instead of using the built-in uploader, which is what the "Test Link" tool in the admin forms is for.
- See the EiT presentation's Roadmap slide for the fuller near-term/long-term plan (equipment onboarding, wider technician rollout, Infor EAM integration, exploratory AI-assisted troubleshooting).
