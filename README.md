# InfoPort

Equipment & Maintenance Information Management System, built for Ghacem (Heidelberg Materials Group, Ghana).

**Live app:** https://edp-omega.vercel.app/ and https://edp.derrickadonteng18.workers.dev/ ; no login needed to browse equipment/documents; sign-in is only for the admin dashboards.

---

## Handoff summary

Everything here currently runs on free-tier services (Vercel, cloudfare, Firebase's free tier, EmailJS, a Cloudflare Worker) because it was built without a company budget or IT involvement, to get a working system in front of the review panel. It's static HTML/CSS/JS with no build step, so nothing below requires a rewrite to move ; but since Ghacem runs on Microsoft 365/Azure, staying on Vercel/Cloudflare/EmailJS long-term would mean IT maintaining infrastructure on top of platforms you don't already have accounts, billing, or admin practices for. The recommendations below put everything on Azure instead, so it sits next to whatever else IT already manages there.

**Recommended target stack:**

| Piece | Currently | Recommended |
|---|---|---|
| Source control | Personal GitHub repo | **Azure DevOps Repos** (Git) |
| Hosting | Vercel | **Azure Static Web Apps** |
| Backend (for the items below that need one) | Cloudflare Worker (SMS only) | **Azure Functions** |
| File storage | GitHub repo / pasted links | **SharePoint or OneDrive document library** (via pasted link ; needs no new code) or **Azure Blob Storage** (via Microsoft Graph/SDK ; needs an Azure Function) |
| Email | EmailJS | **Microsoft Graph API** (`sendMail`), from an Azure Function, sending as your existing Stores/MCC mailboxes |
| SMS | Hubtel via Cloudflare Worker | **Keep Hubtel** ; see note below ; just move the Worker to an Azure Function |
| Admin login (if you go this far) | Firebase Authentication | **Microsoft Entra ID** ; Static Web Apps has this built in |
| Database (if you go this far) | Firebase Firestore | **Azure Cosmos DB** (NoSQL API ; closest match to how Firestore is used here) |

The rest of this document goes through each one in the detail IT will actually need: exactly which file, which function or constant name to search for, and what changes.

---

## 1. Source control & hosting

**Move to:** Azure DevOps Repos + Azure Static Web Apps.

Nothing in the code changes for this ; it's a build-less static site, so "deploying" is just serving the files. Azure Static Web Apps is the right target specifically because:
- Free tier includes custom domains with automatic SSL (so this can sit on `infoport.ghacem.com` or similar instead of a `.vercel.app` domain)
- Deploys straight from Azure DevOps Repos or GitHub Actions on every push, same as Vercel does now
- Has Entra ID as a built-in auth provider, which matters later if you replace Firebase Auth (§6)
- Has a "linked backend" slot for Azure Functions ; relevant for §3 and §4 below, since those need server-side code and Static Web Apps is built to pair with Functions directly, no separate hosting to set up

**Steps:** push this repo into a new Azure DevOps project, create a Static Web App pointed at it, set the custom domain, done. No code changes.

---

## 2. File storage

Right now "the files" is three different things depending on type ; worth understanding before consolidating.

| File type | Currently stored | Where in the code |
|---|---|---|
| Small images (equipment photos, part photos, component photos, exploded-view diagrams, handover photos) | Base64 inside Firestore documents, split into their own collections (`explodedViewDiagrams`, `partComponents`, `handoverLogPhotos`) so a batch of images can't blow past Firestore's 1 MiB document limit | `admin.html` ; every upload path calls `compressImageToDataUrl` |
| PDFs uploaded via the in-app "Upload PDF" button | Pushed to the GitHub repo via the GitHub API, using a personal access token the admin enters once, stored in the browser's `localStorage` | `admin.html` ; `uploadFileToGithub`, `GITHUB_TOKEN_KEY` (localStorage key `infoport_github_pat`) |
| PDFs added by pasting a link | Wherever the admin already uploaded it (Dropbox/Drive/OneDrive), referenced by URL only | `admin.html` ; `addDocumentRow`, `resFileInput`; a "Test Link" button (`testDocumentLink`) checks it resolves to a real file before saving |

**The GitHub-token method is the one actual security problem in this codebase.** That token has write access to the entire repo and sits in browser storage indefinitely ; if that browser is ever compromised (shared device, a malicious extension, any future XSS bug elsewhere in the app), whoever gets it can push arbitrary code to the live site, not just steal a document. This should be the first thing IT fixes, regardless of what else gets migrated.

**Two ways to fix it, in order of effort:**

**Option A ; zero new code.** Since your admins already have OneDrive/SharePoint through Microsoft 365, just stop using the "Upload PDF" button and use the existing "paste a link" field instead, pointed at a SharePoint document library or OneDrive folder set to "anyone in the organization with the link" (or "anyone with the link," if technicians shouldn't need to sign in ; see the note already in the admin form about this). This works today with zero code changes. Delete the GitHub-upload button and the token prompt once nobody's using it.

**Option B ; proper integrated upload.** Build one Azure Function that:
1. Accepts a file from the admin panel (the admin's request is authenticated ; see §6 if you've also moved auth to Entra ID; otherwise keep using the existing Firebase-admin check)
2. Uploads it to Azure Blob Storage (or a SharePoint library via the Microsoft Graph API, if you'd rather it live alongside other company documents)
3. Returns the resulting URL

Then in `admin.html`, replace the `uploadFileToGithub` call (and every `compressImageToDataUrl` call site, if you want images off Firestore too) with a call to that Function instead of embedding a data URI or pushing to GitHub. This is more work than Option A but gives you a real managed storage backend with proper access logs, versioning, and retention policy instead of relying on individual admins' personal cloud storage.

---

## 3. Email

**Move to:** Microsoft Graph API, called from an Azure Function.

**Currently:** [EmailJS](https://www.emailjs.com/), which sends mail straight from the browser ; that only works because EmailJS is specifically designed for that. Config is in `inventory.html`:
- `EMAILJS_SERVICE_ID` (`service_07ex199`)
- `EMAILJS_TEMPLATE_ORDER_STORES` / `EMAILJS_TEMPLATE_ORDER_MCC`
- the `emailjs.send(...)` calls themselves

**Why it has to move to a backend either way:** you can't call Microsoft Graph directly from browser JavaScript with a real credential ; it needs an Entra ID App Registration with `Mail.Send` application permission, authenticated with a client secret or certificate that has to stay server-side.

**Concrete setup:**
1. Register an app in Entra ID, grant it `Mail.Send` (application permission, admin-consented)
2. Write one Azure Function that accepts `{ to, subject, body }`-style input and calls `POST https://graph.microsoft.com/v1.0/users/{stores-mailbox}/sendMail`
3. Point it at your real Stores and MCC mailboxes (so the email actually comes from `stores@ghacem.com` / `mcc@ghacem.com`, not a third-party EmailJS sender address ; a real improvement over the current setup, not just a like-for-like swap)
4. Replace the two `emailjs.send(...)` calls in `inventory.html` with a call to that Function

---

## 4. SMS

**Recommendation: keep Hubtel.** I checked Azure Communication Services' own SMS coverage, and Ghana isn't on its directly-supported country list ; Microsoft extends coverage to more countries through a partner network ("Messaging Connect"), but whether that covers Ghana needs a direct check with Microsoft/your account team before betting the MCC alert flow on it. Hubtel already works for Ghana specifically, which is the more important property here than which cloud it happens to run on.

**What's actually worth changing:** just where the proxy lives. `hubtel-sms-worker.js` is currently a Cloudflare Worker ; move that same logic into an Azure Function instead, purely so all your server-side secrets live in one place (Azure) rather than split across Cloudflare and Azure. The code inside barely changes: same Hubtel API call, same `{ to, message }` request shape from the frontend.

Config in `inventory.html` to update once the new Function is deployed:
- `SMS_PROXY_URL` (currently a placeholder)
- `MCC_PHONE_NUMBER` (currently a placeholder)

If you do want to formally evaluate Azure Communication Services later, ask your Microsoft account rep specifically about Ghana SMS coverage before committing ; don't take my word for it either way.

---

## 5. Database & auth ; only if you're going further

Not required to fix the security/vendor issues above, but flagged since "move almost everything" was the brief. **This is a genuinely bigger job than everything above combined** ; be clear-eyed about that before committing to it.

**Auth → Microsoft Entra ID.** This one's a natural fit: Azure Static Web Apps has Entra ID built in as an auth provider, and your admins already have corporate Microsoft accounts. Admin login could become "sign in with your Ghacem Microsoft 365 account, restricted to an Entra ID security group" ; arguably simpler than what exists now (Firebase email/password + a separate `admins` Firestore collection to manage by hand).

**Database → Azure Cosmos DB (NoSQL API).** The closest match to how Firestore is actually used here ; collections of JSON-ish documents, per-document security rules. That said:

- Every page's `<script>` block calls Firestore directly (`db.collection(...).doc(...).get()/.set()/.update()`, etc.), dozens of times, across all 7 HTML files
- `firebaseConfig` is duplicated in each file separately ; search any `.html` file for `const firebaseConfig = {` to find each one
- Moving this means replacing every one of those calls with the Cosmos DB SDK (or a thin API in front of it) and rebuilding `firestore.rules`'s access logic ; the `isAdmin()` pattern that gates every collection ; as Cosmos DB's own permission model or as checks inside your new API layer

Treat this as its own project, planned separately from §1–4, not a step in the same migration.

---

## Background

### What this is
InfoPort puts equipment manuals, exploded-view diagrams, spare-parts ordering, and shift handover reporting on every technician's phone, works fully offline, and installs like a native app.

### Pages
| File | Purpose |
|---|---|
| `index.html` | Home ; equipment list, groups, offline download |
| `equipment.html` | Equipment detail ; documents, exploded views, parts, checklists |
| `group.html` | Equipment group view |
| `inventory.html` | Spare parts + ordering (§3, §4) |
| `handover.html` | Shift handover reports, admin overview & export |
| `admin.html` | Main admin dashboard (§2's upload logic lives here) |
| `stores-admin.html` | Stores inventory + order tracking |
| `offline.html` | Offline fallback page |

### Supporting scripts
| File | Purpose |
|---|---|
| `service-worker.js` | Offline caching + "download for offline" |
| `search.js` | Site-wide fuzzy search (Fuse.js) |
| `pull-to-refresh.js` | Mobile pull-to-refresh |
| `loading-screen.js` | Load splash |
| `hubtel-sms-worker.js` | SMS proxy ; see §4 |
| `manifest.json` | PWA manifest |
| `equipment.json` | Local seed data (Firestore is the real source of truth) |

### Data model (Firestore collections)
`equipment`, `groups`, `equipmentParts`, `explodedViewDiagrams`, `partComponents`, `internalResources`, `spareParts`, `partOrders`, `handoverLogs`, `handoverLogPhotos`, `equipmentLogs`, `safetyChecklists` / `safetyChecklistCompletions`, `pmChecklists` / `pmChecklistCompletions`, `takeFiveAssessments`, `emailSubscribers`, `admins`, `settings`.

Security rules: `firestore.rules` at the repo root ; paste into Firebase Console → Firestore Database → Rules whenever it changes.

### Local development
No build step:
```bash
npx serve .
```
Needs your own Firebase project (Firestore + Auth), with `firebaseConfig` updated in all 7 HTML files, and `firestore.rules` published to it.
