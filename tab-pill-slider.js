/* InfoPort — draggable, animated sliding tab-pill indicator.
   Drop-in file, add once near the end of <body>:
   <script src="tab-pill-slider.js" defer></script>

   Then, once a tab bar's buttons exist in the DOM, initialize it:
     initTabPillSlider(document.getElementById('myTabs'), {
       activeClass: 'active',     // whatever class the app already toggles
       pillClass: 'pill-fill',    // 'pill-fill' (resizes to match each button)
                                   // or 'pill-circle' (fixed-size circle, for
                                   // icon-above-label bars like the global nav)
       fixedSize: { width: 32, height: 32 }, // only for pill-circle
     });

   This does NOT replace any existing click-to-switch-tab logic — the app's
   own click handlers keep deciding which tab becomes active. This only adds
   an animated highlight that follows the active button, and lets the person
   drag that highlight sideways to switch tabs as an alternative to tapping.
*/
function initTabPillSlider(container, options) {
  if (!container) return null;
  options = options || {};
  var activeClass = options.activeClass || 'active';
  var pillClass = options.pillClass || 'pill-fill';
  var fixedSize = options.fixedSize || null;
  var iconTarget = options.iconTarget || false; // true: center the fixed-size pill on the button's <i>, not the button itself

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  var pill = document.createElement('div');
  pill.className = 'tab-pill-slider ' + pillClass;
  container.insertBefore(pill, container.firstChild);

  function getButtons() {
    return Array.prototype.slice.call(container.children).filter(function (el) {
      return el !== pill && (el.tagName === 'A' || el.tagName === 'BUTTON');
    });
  }

  function getActive() {
    var buttons = getButtons();
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].classList.contains(activeClass)) return buttons[i];
    }
    return null;
  }

  function rectFor(btn) {
    var cRect = container.getBoundingClientRect();
    var target = btn;
    if (iconTarget) {
      var icon = btn.querySelector('i');
      if (icon) target = icon;
    }
    var tRect = target.getBoundingClientRect();
    if (fixedSize) {
      var cx = tRect.left - cRect.left + tRect.width / 2;
      var cy = tRect.top - cRect.top + tRect.height / 2;
      return { x: cx - fixedSize.width / 2, y: cy - fixedSize.height / 2, width: fixedSize.width, height: fixedSize.height };
    }
    var bRect = btn.getBoundingClientRect();
    return { x: bRect.left - cRect.left, y: bRect.top - cRect.top, width: bRect.width, height: bRect.height };
  }

  function applyRect(rect, animate) {
    pill.style.transition = animate === false ? 'none' : '';
    pill.style.width = rect.width + 'px';
    pill.style.height = rect.height + 'px';
    pill.style.transform = 'translate(' + rect.x + 'px,' + rect.y + 'px)';
  }

  function refresh(animate) {
    var active = getActive();
    if (!active) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '1';
    applyRect(rectFor(active), animate);
  }

  getButtons().forEach(function (btn) {
    btn.addEventListener('click', function () {
      requestAnimationFrame(function () { refresh(true); });
    });
  });

  // ---------- Drag: press on the CURRENTLY ACTIVE button and drag sideways
  // to hand the selection to a neighbor, snapping on release. A small
  // movement threshold keeps an ordinary tap on the already-active button
  // from being mistaken for a drag. ----------
  var potential = false;
  var dragging = false;
  var startX = 0;
  var suppressNextClick = null;

  function pointerX(e) { return (e.touches ? e.touches[0].clientX : e.clientX); }

  function onDown(e) {
    var active = getActive();
    if (!active || !(active === e.target || active.contains(e.target))) return;
    potential = true;
    dragging = false;
    startX = pointerX(e);
  }

  function onMove(e) {
    if (!potential) return;
    var x = pointerX(e);
    if (!dragging && Math.abs(x - startX) > 6) {
      dragging = true;
      pill.classList.add('is-dragging');
    }
    if (!dragging) return;
    var cRect = container.getBoundingClientRect();
    var pRect = pill.getBoundingClientRect();
    var currentY = pRect.top - cRect.top;
    var newX = pRect.left - cRect.left + (x - startX);
    var maxX = container.clientWidth - pRect.width;
    newX = Math.max(0, Math.min(maxX, newX));
    pill.style.transition = 'none';
    pill.style.transform = 'translate(' + newX + 'px,' + currentY + 'px)';
    startX = x;
  }

  function onUp(e) {
    if (!potential) return;
    potential = false;
    if (!dragging) return; // ordinary tap — let the button's own click behave normally
    dragging = false;
    pill.classList.remove('is-dragging');

    var cRect = container.getBoundingClientRect();
    var pRect = pill.getBoundingClientRect();
    var pillCenter = pRect.left - cRect.left + pRect.width / 2;
    var buttons = getButtons();
    var nearest = null, nearestDist = Infinity;
    buttons.forEach(function (b) {
      var r = b.getBoundingClientRect();
      var c = r.left - cRect.left + r.width / 2;
      var d = Math.abs(c - pillCenter);
      if (d < nearestDist) { nearestDist = d; nearest = b; }
    });

    var active = getActive();
    if (nearest && nearest !== active) {
      // The drag ended over a different tab — suppress the click that
      // would otherwise still fire on the ORIGINAL (active) button under
      // the pointer, then trigger the tab the pill was dropped on.
      suppressNextClick = active;
      nearest.click();
    } else {
      refresh(true);
    }
  }

  function onClickCapture(e) {
    if (suppressNextClick && (e.target === suppressNextClick || suppressNextClick.contains(e.target))) {
      e.stopPropagation();
      e.preventDefault();
      suppressNextClick = null;
    }
  }

  container.addEventListener('mousedown', onDown);
  container.addEventListener('touchstart', onDown, { passive: true });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);
  container.addEventListener('click', onClickCapture, true);
  window.addEventListener('resize', function () { refresh(false); });

  // Re-measure whenever the container's own size changes — critically,
  // this also fires the moment it goes from not-rendered (display:none,
  // e.g. behind a sign-in gate awaiting an async auth check) to rendered,
  // which a one-time init on page load would otherwise miss entirely if
  // auth resolves after `load` has already fired.
  if (typeof ResizeObserver === 'function') {
    var ro = new ResizeObserver(function () { refresh(false); });
    ro.observe(container);
  }

  requestAnimationFrame(function () { refresh(false); });

  return { refresh: refresh };
}