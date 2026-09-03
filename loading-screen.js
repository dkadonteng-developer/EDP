/**
 * loading-screen.js — controls the #pageLoadingOverlay that every page
 * shows while it loads.
 *
 * The overlay itself (markup + CSS) lives inline at the top of each page's
 * <body>/<head> so it paints immediately, before this script (loaded with
 * `defer`) even runs — that's what actually masks the initial blank/raw
 * flash. This file only handles hiding it once the page is ready, and
 * showing it again briefly when the person taps a link to another page,
 * so multi-page navigation feels continuous instead of a blank gap.
 */
(function () {
  const MIN_VISIBLE_MS = 350; // avoids a jarring flash on very fast loads
  const SAFETY_TIMEOUT_MS = 4000; // never leave it stuck if 'load' is late
  const shownAt = Date.now();
  const overlay = document.getElementById('pageLoadingOverlay');
  if (!overlay) return;

  let hidden = false;
  function hideOverlay() {
    if (hidden) return;
    hidden = true;
    const elapsed = Date.now() - shownAt;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    setTimeout(() => {
      overlay.classList.add('is-hidden');
      setTimeout(() => { overlay.style.display = 'none'; }, 320); // matches the CSS opacity transition
    }, wait);
  }

  // Most pages are considered "ready" once the browser's own 'load' event
  // fires. A page can opt into waiting on its actual data too — set
  // window.pageReadyPromise to a Promise before this script runs (or as
  // early as possible), and the overlay stays up until both the page has
  // loaded AND that promise settles, instead of hiding as soon as static
  // assets are done while a Firestore fetch is still in flight underneath.
  function waitForLoad() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve, { once: true });
    });
  }
  const readySignal = (window.pageReadyPromise && typeof window.pageReadyPromise.then === 'function')
    ? Promise.all([waitForLoad(), window.pageReadyPromise])
    : waitForLoad();
  readySignal.then(hideOverlay, hideOverlay);
  setTimeout(hideOverlay, SAFETY_TIMEOUT_MS);

  // Back/forward navigation often restores the page from the browser's
  // bfcache instead of reloading it — 'load' never fires again in that
  // case, so without this the overlay stays stuck exactly as it was at
  // the moment the person navigated away (which, thanks to the click
  // handler below, was "visible"). Reset and re-hide whenever that happens.
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) {
      hidden = false;
      overlay.style.display = '';
      overlay.classList.remove('is-hidden');
      hideOverlay();
    }
  });

  // Re-show the overlay when navigating to another page on this site, so
  // the gap between pages (a plain browser navigation, not an SPA route
  // change) doesn't read as a blank/broken moment.
  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const link = ev.target.closest('a[href]');
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    let url;
    try { url = new URL(link.href, location.href); } catch (e) { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return; // in-page anchor, no navigation

    overlay.style.display = 'flex';
    overlay.classList.remove('is-hidden');
  });
})();
