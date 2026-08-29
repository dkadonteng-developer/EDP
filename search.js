/**
 * search.js — site-wide client-side search for the InfoPort app.
 *
 * Include this on every page with a single line, right before </body>:
 *   <script src="https://cdn.jsdelivr.net/npm/fuse.js@7.0.0"></script>
 *   <script src="search.js" defer></script>
 *
 * It injects its own button (into the page's <header> or <nav>, whichever
 * exists), its own overlay markup, and its own CSS — no other markup edits
 * needed on any page.
 *
 * WHAT IT SEARCHES (all pulled from Firestore, public fields only):
 *   - Equipment (name, ID, manufacturer, model, department)
 *   - Equipment groups
 *   - Per-equipment documents (equipment.documents[])
 *   - Exploded-view diagram parts (equipmentParts collection)
 *   - Internal resources (internalResources collection)
 *   - Spare parts inventory (spareParts collection)
 *   - Recent maintenance log entries (equipmentLogs collection, capped)
 *
 * Results are fuzzy-matched with Fuse.js so a generic or partly-misspelled
 * term still surfaces something useful, grouped by type so one category
 * doesn't drown out the rest.
 */
(function () {
  // ---------- Firebase (reuses the page's existing app if present) ----------
  const firebaseConfig = {
    apiKey: "AIzaSyBS3ZZWSUoquqAiPTU0PaUGGh0d8Iwd27U",
    authDomain: "edp-equipment.firebaseapp.com",
    projectId: "edp-equipment",
    storageBucket: "edp-equipment.firebasestorage.app",
    messagingSenderId: "556924119553",
    appId: "1:556924119553:web:55b229fc6c6089b708ee00",
    measurementId: "G-YGXNH7T0T0",
  };
  if (typeof firebase === 'undefined') {
    console.error('search.js: Firebase SDK not loaded on this page — search disabled.');
    return;
  }
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const sdb = firebase.firestore();

  const CACHE_KEY = 'infoport_search_index_v1';
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — balances freshness vs re-fetch cost
  const MAX_LOG_ENTRIES = 500;        // bound the log fetch so it stays cheap
  const RESULTS_PER_GROUP = 6;
  const MAX_TOTAL_RESULTS = 40;

  const FUSE_OPTIONS = {
    keys: [
      { name: 'title', weight: 0.6 },
      { name: 'subtitle', weight: 0.25 },
      { name: 'type', weight: 0.15 },
    ],
    threshold: 0.38,       // fairly forgiving — generic/approximate terms still match
    ignoreLocation: true,
    minMatchCharLength: 2,
  };

  const TYPE_ORDER = ['Equipment', 'Group', 'Document', 'Resource', 'Spare Part', 'Part (diagram)', 'Log entry'];
  const TYPE_ICON = {
    'Equipment': 'fa-toolbox',
    'Group': 'fa-layer-group',
    'Document': 'fa-file-pdf',
    'Resource': 'fa-book-open',
    'Spare Part': 'fa-gears',
    'Part (diagram)': 'fa-diagram-project',
    'Log entry': 'fa-comment-dots',
  };

  let fuse = null;
  let indexPromise = null;

  function buildIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = (async () => {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (cached && Array.isArray(cached.items) && Date.now() - cached.builtAt < CACHE_TTL_MS) {
          fuse = new Fuse(cached.items, FUSE_OPTIONS);
          return;
        }
      } catch (e) { /* corrupt/unavailable cache — rebuild below */ }

      const items = [];
      const equipNameById = {};
      const groupSet = new Set();

      const equipSnap = await sdb.collection('equipment').get();
      equipSnap.forEach((doc) => {
        const e = doc.data();
        if (e.archived) return;
        const id = doc.id;
        const name = e.name || id;
        equipNameById[id] = name;

        items.push({
          type: 'Equipment',
          title: name,
          subtitle: [e.manufacturer, e.model, e.department].filter(Boolean).join(' · '),
          url: `equipment.html?id=${encodeURIComponent(id)}`,
        });

        (Array.isArray(e.documents) ? e.documents : []).forEach((d) => {
          if (!d || !d.name) return;
          items.push({
            type: 'Document',
            title: d.name,
            subtitle: `${name} — Documents`,
            url: `equipment.html?id=${encodeURIComponent(id)}&tab=documents`,
          });
        });

        const groups = Array.isArray(e.groups) && e.groups.length ? e.groups : (e.group ? [e.group] : []);
        groups.forEach((g) => { if (g) groupSet.add(g); });
      });

      groupSet.forEach((g) => {
        items.push({
          type: 'Group',
          title: g,
          subtitle: 'Equipment group',
          url: `group.html?group=${encodeURIComponent(g)}`,
        });
      });

      try {
        const partsSnap = await sdb.collection('equipmentParts').get();
        partsSnap.forEach((doc) => {
          const p = doc.data();
          if (!p.name || !p.equipmentId) return;
          items.push({
            type: 'Part (diagram)',
            title: p.name,
            subtitle: `${equipNameById[p.equipmentId] || p.equipmentId} — Diagrams${p.modelNumber ? ' · ' + p.modelNumber : ''}`,
            url: `equipment.html?id=${encodeURIComponent(p.equipmentId)}&tab=diagrams`,
          });
        });
      } catch (err) { console.warn('search.js: could not index equipmentParts', err); }

      try {
        const resSnap = await sdb.collection('internalResources').get();
        resSnap.forEach((doc) => {
          const r = doc.data();
          if (!r.name || !r.equipmentId) return;
          items.push({
            type: 'Resource',
            title: r.name,
            subtitle: `${equipNameById[r.equipmentId] || r.equipmentId}${r.category ? ' · ' + r.category : ''} — Resources`,
            url: `equipment.html?id=${encodeURIComponent(r.equipmentId)}&tab=documents`,
          });
        });
      } catch (err) { console.warn('search.js: could not index internalResources', err); }

      try {
        const spareSnap = await sdb.collection('spareParts').get();
        spareSnap.forEach((doc) => {
          const sp = doc.data();
          const title = sp.partName || sp.modelNumber;
          if (!title) return;
          items.push({
            type: 'Spare Part',
            title,
            subtitle: [sp.modelNumber, sp.category, sp.binLocation ? `Bin ${sp.binLocation}` : ''].filter(Boolean).join(' · '),
            url: `inventory.html?q=${encodeURIComponent(title)}`,
          });
        });
      } catch (err) { console.warn('search.js: could not index spareParts', err); }

      try {
        const logSnap = await sdb.collection('equipmentLogs').orderBy('timestamp', 'desc').limit(MAX_LOG_ENTRIES).get();
        logSnap.forEach((doc) => {
          const l = doc.data();
          if (!l.comment || !l.equipmentId) return;
          items.push({
            type: 'Log entry',
            title: l.comment.length > 90 ? l.comment.slice(0, 90) + '…' : l.comment,
            subtitle: `${equipNameById[l.equipmentId] || l.equipmentId} — ${l.category || 'Log'}${l.fullName ? ' · ' + l.fullName : ''}`,
            url: `equipment.html?id=${encodeURIComponent(l.equipmentId)}&tab=log`,
          });
        });
      } catch (err) { console.warn('search.js: could not index equipmentLogs (may need a Firestore index on timestamp)', err); }

      fuse = new Fuse(items, FUSE_OPTIONS);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ builtAt: Date.now(), items }));
      } catch (e) { /* storage full/unavailable — fine, just skip caching */ }
    })().catch((err) => {
      console.error('search.js: failed to build search index', err);
      indexPromise = null; // allow a retry next time the overlay opens
    });
    return indexPromise;
  }

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.textContent = `
    #globalSearchBtn{
      display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.14);color:#fff;
      border:none;border-radius:20px;padding:9px 16px;font-family:inherit;font-size:.85rem;
      font-weight:600;cursor:pointer;transition:background .15s ease;flex:0 0 auto;
    }
    #globalSearchBtn:hover{background:rgba(255,255,255,.26)}
    @media(max-width:520px){
      #globalSearchBtn{padding:9px 11px}
      #globalSearchBtn .gs-btn-label{display:none}
    }
    nav > div:last-child{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    #globalSearchOverlay{
      position:fixed;inset:0;z-index:2000;background:rgba(15,20,25,.5);
      display:none;align-items:flex-start;justify-content:center;padding:0;
    }
    #globalSearchOverlay.is-open{display:flex}
    #globalSearchPanel{
      background:#fff;width:100%;max-width:640px;height:100%;max-height:100%;
      display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.25);
    }
    @media(min-width:640px){
      #globalSearchOverlay{padding:60px 20px}
      #globalSearchPanel{height:auto;max-height:78vh;border-radius:14px}
    }
    #globalSearchHead{
      display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e6e9ec;flex:0 0 auto;
    }
    #globalSearchHead i.fa-magnifying-glass{color:#8a919b;font-size:.95rem}
    #globalSearchInput{
      flex:1;border:none;outline:none;font-family:inherit;font-size:1rem;color:#1a1f26;background:transparent;
    }
    #globalSearchClose{
      border:none;background:#f0f2f4;color:#555;width:30px;height:30px;border-radius:50%;
      cursor:pointer;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    }
    #globalSearchClose:hover{background:#e2e5e9}
    #globalSearchBody{flex:1;overflow-y:auto;padding:8px 0}
    .gs-hint{color:#8a919b;font-size:.86rem;text-align:center;padding:36px 20px}
    .gs-group-label{
      font-size:.72rem;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8a919b;
      padding:12px 16px 6px;
    }
    .gs-item{
      display:flex;align-items:flex-start;gap:12px;padding:10px 16px;cursor:pointer;
      border:none;background:none;width:100%;text-align:left;font-family:inherit;
    }
    .gs-item:hover, .gs-item.is-focused{background:#f4f6f7}
    .gs-item-icon{
      width:32px;height:32px;border-radius:8px;background:#e6f7ee;color:#006937;
      display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:.85rem;
    }
    .gs-item-text{min-width:0}
    .gs-item-title{font-size:.92rem;font-weight:600;color:#1a1f26;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gs-item-subtitle{font-size:.78rem;color:#8a919b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
  `;
  document.head.appendChild(style);

  // ---------- Markup ----------
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'globalSearchBtn';
  btn.title = 'Search InfoPort';
  btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><span class="gs-btn-label">Search</span>';

  // Prefer a page's existing right-hand action group (keeps the search
  // button visually grouped with whatever else lives there) — fall back to
  // the outer header/nav bar itself when no such group exists.
  const hostBar = document.querySelector('header .header-right')
    || document.querySelector('nav > div:last-child')
    || document.querySelector('header')
    || document.querySelector('nav');
  if (hostBar) hostBar.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.id = 'globalSearchOverlay';
  overlay.innerHTML = `
    <div id="globalSearchPanel">
      <div id="globalSearchHead">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="globalSearchInput" placeholder="Search equipment, documents, parts, groups…" autocomplete="off">
        <button type="button" id="globalSearchClose" title="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="globalSearchBody">
        <p class="gs-hint">Start typing to search across every equipment, document, spare part, and resource in InfoPort.</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#globalSearchInput');
  const body = overlay.querySelector('#globalSearchBody');
  const closeBtn = overlay.querySelector('#globalSearchClose');

  let focusedIndex = -1;
  let currentResults = [];

  function openOverlay() {
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    input.value = '';
    focusedIndex = -1;
    body.innerHTML = '<p class="gs-hint">Loading the search index…</p>';
    buildIndex().then(() => {
      body.innerHTML = '<p class="gs-hint">Start typing to search across every equipment, document, spare part, and resource in InfoPort.</p>';
    });
    setTimeout(() => input.focus(), 30);
  }

  function closeOverlay() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', openOverlay);
  closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeOverlay(); });

  document.addEventListener('keydown', (ev) => {
    const typingElsewhere = ['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName);
    if (ev.key === '/' && !typingElsewhere && !overlay.classList.contains('is-open')) {
      ev.preventDefault();
      openOverlay();
      return;
    }
    if (!overlay.classList.contains('is-open')) return;
    if (ev.key === 'Escape') { closeOverlay(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moveFocus(1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); moveFocus(-1); return; }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const target = focusedIndex >= 0 ? currentResults[focusedIndex] : currentResults[0];
      if (target) navigateTo(target);
    }
  });

  function moveFocus(delta) {
    if (!currentResults.length) return;
    focusedIndex = Math.max(0, Math.min(currentResults.length - 1, focusedIndex + delta));
    body.querySelectorAll('.gs-item').forEach((el, i) => el.classList.toggle('is-focused', i === focusedIndex));
    const focusedEl = body.querySelectorAll('.gs-item')[focusedIndex];
    if (focusedEl) focusedEl.scrollIntoView({ block: 'nearest' });
  }

  function navigateTo(item) {
    window.location.href = item.url;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderResults(query) {
    if (!fuse) {
      body.innerHTML = '<p class="gs-hint">Still loading — try again in a moment.</p>';
      return;
    }
    const matches = fuse.search(query, { limit: 200 }).map((r) => r.item);
    currentResults = matches.slice(0, MAX_TOTAL_RESULTS);
    focusedIndex = -1;

    if (!matches.length) {
      body.innerHTML = `
        <p class="gs-hint">
          No matches for "${escapeHtml(query)}". Try a shorter or more general word —
          e.g. part of an equipment name, a model number, or a department.
        </p>`;
      return;
    }

    // Group by type, in a fixed sensible order, capped per group so one
    // category never crowds out the rest — this is what keeps a broad,
    // generic query useful instead of a wall of one result type.
    const byType = {};
    matches.forEach((item) => {
      (byType[item.type] = byType[item.type] || []).push(item);
    });

    let html = '';
    TYPE_ORDER.filter((t) => byType[t] && byType[t].length).forEach((type) => {
      const group = byType[type].slice(0, RESULTS_PER_GROUP);
      html += `<div class="gs-group-label">${escapeHtml(type)}${byType[type].length > group.length ? ` (${byType[type].length})` : ''}</div>`;
      group.forEach((item) => {
        html += `
          <button type="button" class="gs-item" data-url="${escapeHtml(item.url)}">
            <span class="gs-item-icon"><i class="fa-solid ${TYPE_ICON[item.type] || 'fa-magnifying-glass'}"></i></span>
            <span class="gs-item-text">
              <div class="gs-item-title">${escapeHtml(item.title)}</div>
              ${item.subtitle ? `<div class="gs-item-subtitle">${escapeHtml(item.subtitle)}</div>` : ''}
            </span>
          </button>`;
      });
    });
    body.innerHTML = html;

    body.querySelectorAll('.gs-item').forEach((el, i) => {
      el.addEventListener('click', () => navigateTo(currentResults[i]));
    });
  }

  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      currentResults = [];
      body.innerHTML = '<p class="gs-hint">Start typing to search across every equipment, document, spare part, and resource in InfoPort.</p>';
      return;
    }
    debounceTimer = setTimeout(() => renderResults(query), 160);
  });

  // Warm the index in the background shortly after page load, so the
  // overlay feels instant the first time someone opens it.
  if (document.readyState === 'complete') {
    setTimeout(buildIndex, 1500);
  } else {
    window.addEventListener('load', () => setTimeout(buildIndex, 1500));
  }
})();
