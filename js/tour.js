// ============================================================
// TUR GHIDAT — se pornește singur la prima deschidere a unui proiect (flag localStorage „ganttTourDone"),
// poate fi sărit oricând (buton „Sari peste", Esc) și repornit din Vizualizare › Ghid.
// ============================================================
// Poziții: cadrul luminat și caseta sunt elemente din <body> (nescalate de ZF sau --ui-zoom), iar rect-urile elementelor țintă
// vin din getBoundingClientRect (pixeli de ecran, deja cu zoom-ul aplicat), deci se potrivesc fără nicio împărțire; casetei i se
// măsoară mărimea cu offsetWidth / offsetHeight (tot pixeli de ecran). Dacă muți cadrul în interiorul unui element scalat, împarte la ZF / uiScale().
const TOUR_STEPS = [
  { title: 'Panglica și filele',
    text: 'Aici sunt toate comenzile, grupate pe file: Fișier (salvare, export, tipărire), Acasă (adaugă și mută activități), Vizualizare (vederi, filtre, zoom) și Proiect (calendar, resurse, buget, urmărire). Treci cu mouse-ul peste un buton ca să vezi ce face.',
    target: () => [document.querySelector('.ribbon')] },
  { title: 'Tabelul de activități',
    text: 'Fiecare rând e o activitate: scrii direct numele, durata și datele. Dublu-click pe un rând deschide toate detaliile. Capitolele (cu săgeată) grupează activitățile, iar rândurile se pot trage ca să schimbi ordinea sau nivelul.',
    target: () => [document.getElementById('paneL')] },
  { title: 'Graficul Gantt',
    text: 'Fiecare activitate e o bară pe axa timpului. Trage bara ca s-o muți în timp, trage de margini ca să-i schimbi durata, trage mânerul alb din mijloc ca să marchezi progresul. Ctrl + / − mărește sau micșorează tabelul și graficul.',
    target: () => [document.getElementById('paneR')] },
  { title: 'Cum legi două activități', dots: true,
    text: 'Treci cu mouse-ul pe o bară: apar două puncte pe colțuri (albastru = începutul, portocaliu = sfârșitul). Trage de pe unul pe altă bară ca să creezi o legătură; tipul (FS, SS, FF, SF) depinde de colțurile alese. Activitățile legate se mută singure.',
    target: () => { const b = document.querySelector('.gb.task:not(.summ)'); return b ? [b] : [document.getElementById('paneR')]; }, pad: 22 },
  { title: 'Drumul critic și linia de bază', tab: 'view',
    text: 'Drum critic colorează în roșu activitățile fără rezervă: orice întârziere a lor mută finalul proiectului. Linia de bază păstrează planul inițial (se salvează din fila Proiect) și arată sub fiecare bară cât ai întârziat față de el.',
    target: () => [document.getElementById('btnCrit'), document.getElementById('btnBase')] },
  { title: 'Proiecte și salvare',
    text: 'Fiecare proiect are o filă aici; + deschide altul. Proiectele se păstrează singure în browser, dar pentru siguranță salvează-le într-un fișier: Fișier › Salvează sau Ctrl+S. Butonul Ghid din fila Vizualizare repornește acest tur.',
    target: () => [document.getElementById('tabsRow')] }
];

let _tour = null;
const tourIsDone = () => { try { return localStorage.getItem('ganttTourDone') === '1'; } catch (e) { return false; } };
function tourSetDone(done) { try { if (done) localStorage.setItem('ganttTourDone', '1'); else localStorage.removeItem('ganttTourDone'); } catch (e) {} }

// Pornire automată: o singură dată, la prima deschidere a unui proiect. `?notour` în adresă o oprește (folosit de testele automate).
let _tourScheduled = false;
function maybeStartTour(tries) {
  if (_tourScheduled || _tour || tourIsDone() || !tabs.length || /[?&]notour/.test(location.search)) return;
  _tourScheduled = true;
  setTimeout(() => {
    _tourScheduled = false;
    if (_tour || tourIsDone() || !tabs.length) return;
    if (document.querySelector('.modal-overlay.open')) { if ((tries || 0) < 3) maybeStartTour((tries || 0) + 1); return; }   // o fereastră e deschisă: mai încercăm de câteva ori, fără să o întrerupem
    startTour();
  }, tries ? 3000 : 700);
}

function startTour() {
  if (_tour || !tabs.length) return;
  const active = document.querySelector('.rb-tab.active');
  _tour = { i: 0, prevFocus: document.activeElement, prevTab: active ? active.dataset.rt : 'home', prevView: view, wasFull: document.body.classList.contains('gantt-full'), ribbonWasCollapsed: document.body.classList.contains('ribbon-collapsed') };
  if (_tour.wasFull) toggleGanttFull();
  if (view !== 'gantt') setViewMode('gantt');
  closeDD();
  if (_tour.ribbonWasCollapsed) toggleRibbon(false);
  const mk = (tag, id, cls) => { const e = document.createElement(tag); e.id = id; if (cls) e.className = cls; document.body.appendChild(e); return e; };
  mk('div', 'tourShield'); mk('div', 'tourSpot');
  const box = mk('div', 'tourBox'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'tourTitle'); box.setAttribute('aria-describedby', 'tourText');
  box.innerHTML = '<div class="tour-no" id="tourNo"></div><h3 id="tourTitle"></h3><p id="tourText"></p><div class="tour-prog" id="tourProg"></div>' +
    '<div class="tour-actions"><button type="button" class="tour-skip" id="tourSkip">Sari peste</button><span class="tour-sp"></span>' +
    '<button type="button" class="tour-btn" id="tourBack">Înapoi</button><button type="button" class="tour-btn primary" id="tourNext">Următorul</button></div>';
  $('tourSkip').onclick = () => tourClose();
  $('tourBack').onclick = () => tourGo(_tour.i - 1);
  $('tourNext').onclick = () => { if (_tour.i >= TOUR_STEPS.length - 1) tourClose(); else tourGo(_tour.i + 1); };
  document.addEventListener('keydown', _tourKey, true);
  window.addEventListener('resize', _tourPlace);
  tourGo(0);
}

function tourGo(i) {
  if (!_tour) return;
  _tour.i = clamp(i, 0, TOUR_STEPS.length - 1);
  const s = TOUR_STEPS[_tour.i], want = s.tab || _tour.prevTab, cur = document.querySelector('.rb-tab.active');
  if (!cur || cur.dataset.rt !== want) { const tb = document.querySelector('.rb-tab[data-rt="' + want + '"]'); if (tb && tb.offsetParent !== null) tb.click(); }
  document.body.classList.toggle('tour-dots', !!s.dots);
  $('tourNo').textContent = 'Pasul ' + (_tour.i + 1) + ' din ' + TOUR_STEPS.length;
  $('tourTitle').textContent = s.title; $('tourText').textContent = s.text;
  $('tourProg').innerHTML = TOUR_STEPS.map((_, k) => '<i class="' + (k === _tour.i ? 'on' : (k < _tour.i ? 'done' : '')) + '"></i>').join('');
  $('tourBack').disabled = _tour.i === 0;
  $('tourNext').textContent = _tour.i === TOUR_STEPS.length - 1 ? 'Gata' : 'Următorul';
  _tourPlace();
  $('tourNext').focus({ preventScroll: true });
  requestAnimationFrame(_tourPlace);   // după ce fila de panglică / dimensiunile s-au așezat
}

// Dreptunghiul țintei = reuniunea elementelor vizibile (pixeli de ecran), mărit cu `pad`
function _tourRect(s) {
  let r = null;
  (s.target() || []).forEach(el => {
    if (!el) return; const b = el.getBoundingClientRect(); if (!b.width && !b.height) return;
    r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
  });
  const p = s.pad || 6;
  return r ? { l: Math.max(2, r.l - p), t: Math.max(2, r.t - p), r: Math.min(innerWidth - 2, r.r + p), b: Math.min(innerHeight - 2, r.b + p) } : null;
}

function _tourPlace() {
  if (!_tour) return;
  const spot = $('tourSpot'), box = $('tourBox'); if (!spot || !box) return;
  const s = TOUR_STEPS[_tour.i], R = _tourRect(s) || { l: innerWidth / 2 - 100, t: innerHeight / 2 - 40, r: innerWidth / 2 + 100, b: innerHeight / 2 + 40 };
  spot.style.left = R.l + 'px'; spot.style.top = R.t + 'px'; spot.style.width = (R.r - R.l) + 'px'; spot.style.height = (R.b - R.t) + 'px';
  const w = box.offsetWidth, h = box.offsetHeight, G = 14, M = 10, W = innerWidth, H = innerHeight;
  const fit = (x, y) => x >= M && y >= M && x + w <= W - M && y + h <= H - M;
  const cx = clamp((R.l + R.r) / 2 - w / 2, M, W - w - M), cy = clamp((R.t + R.b) / 2 - h / 2, M, H - h - M);
  const tries = [[cx, R.b + G], [cx, R.t - h - G], [R.r + G, cy], [R.l - w - G, cy]];       // dedesubt, deasupra, în dreapta, în stânga
  let pos = tries.find(p => fit(p[0], p[1]));
  if (!pos) pos = [clamp(R.r - w - 16, M, W - w - M), clamp(R.b - h - 16, M, H - h - M)];   // ținta e uriașă: caseta stă în colțul ei din dreapta-jos
  box.style.left = Math.round(pos[0]) + 'px'; box.style.top = Math.round(pos[1]) + 'px'; box.style.visibility = 'visible';
}

function _tourKey(e) {
  if (!_tour) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tourClose(); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); $('tourNext').click(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (_tour.i > 0) tourGo(_tour.i - 1); return; }
  if (e.key === 'Tab') {                                   // focusul rămâne în casetă
    const bs = [...document.querySelectorAll('#tourBox button:not(:disabled)')];
    if (bs.length) { const i = bs.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? bs.length - 1 : i - 1) : (i === bs.length - 1 ? 0 : i + 1); bs[n].focus(); }
    e.preventDefault(); e.stopPropagation(); return;
  }
  if (e.key === 'Enter' || e.key === ' ') return;          // activează butonul din casetă
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || /^F\d+$/.test(e.key)) return;   // modificatori și F5 / F12: rămân ale browserului
  // Orice altă tastă (Del, Ctrl+Z, Ctrl+S, Ctrl+N, Alt+↑…) NU ajunge la aplicație: altfel ar modifica proiectul din spatele turului
  if ((e.ctrlKey || e.metaKey) && ['s', 'o', 'n', 'p', 'z', 'y', 'x', 'c', 'v', 'f', 'a', '+', '=', '-', '_', '0'].includes(e.key.toLowerCase())) e.preventDefault();
  e.stopPropagation();
}

function tourClose() {
  if (!_tour) return;
  const t = _tour; _tour = null;
  document.removeEventListener('keydown', _tourKey, true); window.removeEventListener('resize', _tourPlace);
  ['tourShield', 'tourSpot', 'tourBox'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
  document.body.classList.remove('tour-dots');
  const cur = document.querySelector('.rb-tab.active');
  if (cur && cur.dataset.rt !== t.prevTab) { const tb = document.querySelector('.rb-tab[data-rt="' + t.prevTab + '"]'); if (tb) tb.click(); }
  if (t.ribbonWasCollapsed) toggleRibbon(true);
  if (t.prevView !== 'gantt' && view === 'gantt') setViewMode(t.prevView);          // vederea (Arbore / Cronologie) în care eras înainte de tur
  if (t.wasFull && !document.body.classList.contains('gantt-full') && view === 'gantt') toggleGanttFull();
  tourSetDone(true);                                       // terminat sau sărit: nu se mai pornește singur
  if (t.prevFocus && t.prevFocus !== document.body && document.contains(t.prevFocus) && t.prevFocus.focus) t.prevFocus.focus({ preventScroll: true });
}
