/* InfoPort — shared tab bar injector
   Drop-in file, add once near the end of <body> on every page:
   <script src="shared-nav.js" defer></script>
   No other markup needed — this builds and appends the bar itself,
   so there's nothing to keep in sync by hand across the 8 pages. */
(function(){

  var TABS = [
    { href:'index.html',    icon:'fa-toolbox',         label:'Equipment', match:['index.html','equipment.html'] },
    { href:'groups.html',   icon:'fa-layer-group',     label:'Groups',    match:['groups.html','group.html'] },
    { href:'inventory.html',icon:'fa-boxes-stacked',   label:'Inventory', match:['inventory.html','stores-admin.html'] },
    { href:'handover.html', icon:'fa-clipboard-list',  label:'Handover',  match:['handover.html'] },
    { href:'admin.html',    icon:'fa-bars',            label:'More',      match:['admin.html'] }
  ];

  var current = (location.pathname.split('/').pop() || 'index.html');

  var nav = document.createElement('nav');
  nav.className = 'app-tabbar';
  nav.setAttribute('aria-label', 'Primary');

  TABS.forEach(function(t){
    var a = document.createElement('a');
    a.href = t.href;
    var active = t.match.indexOf(current) !== -1;
    if (active) {
      a.className = 'is-active';
      a.setAttribute('aria-current', 'page');
    }
    a.innerHTML = '<i class="fa-solid ' + t.icon + '" aria-hidden="true"></i><span>' + t.label + '</span>';
    nav.appendChild(a);
  });

  document.body.appendChild(nav);
  document.body.classList.add('has-app-tabbar');

})();
