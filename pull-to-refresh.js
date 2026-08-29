/**
 * pull-to-refresh.js — a custom "swipe down to refresh" gesture for the
 * InfoPort PWA.
 *
 * Why this exists: once the app is installed to a home screen (standalone
 * display mode), the browser chrome that normally provides pull-to-refresh
 * is gone, so that familiar gesture stops working entirely unless an app
 * implements it itself. This does that — but only in standalone mode, so
 * it never doubles up with (or fights) the browser's own pull-to-refresh
 * when the site is just open in a regular mobile browser tab.
 *
 * Include on every page, right before </body>:
 *   <script src="pull-to-refresh.js" defer></script>
 */
(function () {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS Safari's own flag

  if (!isStandalone) return;

  const THRESHOLD = 70;   // px pulled down before release triggers a refresh
  const MAX_PULL = 120;   // px — visual cap so the indicator can't be dragged forever

  const style = document.createElement('style');
  style.textContent = `
    #ptrIndicator{
      position:fixed;top:0;left:0;right:0;z-index:2500;
      display:flex;align-items:center;justify-content:center;
      height:60px;margin-top:-60px;pointer-events:none;
      transition:margin-top .2s ease;
    }
    #ptrIndicator.ptr-dragging{transition:none}
    #ptrIndicator-inner{
      width:34px;height:34px;border-radius:50%;background:#fff;
      box-shadow:0 2px 10px rgba(0,0,0,.2);
      display:flex;align-items:center;justify-content:center;color:#006937;
    }
    #ptrIndicator-inner i{transition:transform .15s ease}
    #ptrIndicator.ptr-ready #ptrIndicator-inner i{transform:rotate(180deg)}
    #ptrIndicator.ptr-refreshing #ptrIndicator-inner i{animation:ptrSpin .7s linear infinite}
    @keyframes ptrSpin{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(style);

  const indicator = document.createElement('div');
  indicator.id = 'ptrIndicator';
  indicator.innerHTML = '<div id="ptrIndicator-inner"><i class="fa-solid fa-arrow-down"></i></div>';
  document.body.appendChild(indicator);

  let startY = null;
  let pulling = false;
  let refreshing = false;

  function atPageTop() {
    const scroller = document.scrollingElement || document.documentElement;
    return scroller.scrollTop <= 0;
  }

  // Ignore drags that start inside a scrollable panel/modal (exploded-view
  // diagram, PDF viewer, log history list, etc.) — only the outer page
  // being at the very top should arm the gesture.
  function insideNestedScroller(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 2) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY)) return el !== document.scrollingElement;
      }
      el = el.parentElement;
    }
    return false;
  }

  document.addEventListener('touchstart', (ev) => {
    if (refreshing || ev.touches.length !== 1) return;
    if (!atPageTop() || insideNestedScroller(ev.target)) return;
    startY = ev.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', (ev) => {
    if (!pulling || startY === null) return;
    const dy = ev.touches[0].clientY - startY;
    if (dy <= 0) { pulling = false; return; }
    if (!atPageTop()) { pulling = false; return; }

    const pull = Math.min(MAX_PULL, dy * 0.5); // damped, rubber-band feel
    indicator.classList.add('ptr-dragging');
    indicator.style.marginTop = `${-60 + pull}px`;
    indicator.classList.toggle('ptr-ready', pull >= THRESHOLD);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    indicator.classList.remove('ptr-dragging');

    const wasReady = indicator.classList.contains('ptr-ready');
    if (wasReady && !refreshing) {
      refreshing = true;
      indicator.classList.remove('ptr-ready');
      indicator.classList.add('ptr-refreshing');
      indicator.style.marginTop = '10px';
      // A full reload is the simplest reliable "refresh" for a multi-page
      // app like this one — every page re-fetches its own data on load.
      setTimeout(() => window.location.reload(), 300);
    } else {
      indicator.style.marginTop = '-60px';
    }
    startY = null;
  });

  document.addEventListener('touchcancel', () => {
    pulling = false;
    startY = null;
    indicator.classList.remove('ptr-dragging', 'ptr-ready');
    indicator.style.marginTop = '-60px';
  });
})();
