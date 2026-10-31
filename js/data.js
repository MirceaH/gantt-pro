const $ = id => document.getElementById(id);

// ============================================================
// SISTEM MULTI-TAB
// ============================================================
let tabs = [];        // array de proiecte
let activeTabId = 1;  // id-ul tab-ului activ
let nextTabId = 1;    // contor id-uri tab-uri

// Datele proiectului curent (sincronizate cu tab-ul activ)
let T = [], nid = 1, sel = null, coll = new Set(), view = "gantt", zoomLevel = 100, isAutoZoom = true;

// Date la nivel de proiect (se salvează odată cu activitățile): data de status pentru urmărirea progresului.
// sdate = data de status (aaaa-ll-zz) sau null = „azi".
let META = { sdate: null };
function setMeta(m) { META = { sdate: m && /^\d{4}-\d{2}-\d{2}$/.test(m.sdate || "") ? m.sdate : null }; }

// ============================================================
// UNDO / REDO
// ============================================================
let _history = [], _future = [];
const MAX_HISTORY = 50;

function pushHistory() {
  _history.push(JSON.stringify({ T, nid, cal: CAL, res: RES, meta: META }));
  if (_history.length > MAX_HISTORY) _history.shift();
  _future = [];
  updateUndoRedoBtns();
}

function undo() {
  if (!_history.length) { toast('⚠️ Nimic de anulat'); return; }
  _future.push(JSON.stringify({ T, nid, cal: CAL, res: RES, meta: META }));
  const state = JSON.parse(_history.pop());
  T = state.T; nid = state.nid; sel = null; if (state.cal) setCal(state.cal); if (state.res) setRes(state.res); setMeta(state.meta);
  syncTabData();
  updateUndoRedoBtns();
  renderAll();
  toast('↩️ Anulat');
}

function redo() {
  if (!_future.length) { toast('⚠️ Nimic de refăcut'); return; }
  _history.push(JSON.stringify({ T, nid, cal: CAL, res: RES, meta: META }));
  const state = JSON.parse(_future.pop());
  T = state.T; nid = state.nid; sel = null; if (state.cal) setCal(state.cal); if (state.res) setRes(state.res); setMeta(state.meta);
  syncTabData();
  updateUndoRedoBtns();
  renderAll();
  toast('↪️ Refăcut');
}

function updateUndoRedoBtns() {
  const bu = $("btnUndo"), br = $("btnRedo");
  if (bu) bu.style.opacity = _history.length ? "1" : "0.4";
  if (br) br.style.opacity = _future.length  ? "1" : "0.4";
}

// ============================================================
// HELPERS
// ============================================================
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const pD = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
const fD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const aD = (d,n) => { const r = new Date(d); r.setDate(r.getDate()+n); return r; };
const dD = (a,b) => Math.round((b-a)/864e5);
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const isWE = d => d.getDay()===0 || d.getDay()===6;
const MN = d => ["Ian","Feb","Mar","Apr","Mai","Iun","Iul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
const todayStr = fD(new Date());
const fmtDate = d => `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;

function toast(m) { const t=$("toast"); t.textContent=m; t.classList.add("v"); clearTimeout(toast._); toast._=setTimeout(()=>t.classList.remove("v"),2500); }
function kids(p) { return T.filter(t=>t.pid===p); }
function dep(id) { let d=0, t=T.find(x=>x.id===id); while(t&&t.pid){d++; t=T.find(x=>x.id===t.pid)} return d; }
function allD(id) { const r=[]; kids(id).forEach(c=>{r.push(c.id); r.push(...allD(c.id))}); return r; }
function isD(c,a) { let t=T.find(x=>x.id===c); while(t&&t.pid){if(t.pid===a) return true; t=T.find(x=>x.id===t.pid)} return false; }
function hasK(id) { return kids(id).length>0; }

// ============================================================
// DEPENDENȚE — model extins (FS / SS / FF / SF + lag)
// ============================================================
// Fiecare dep este un obiect: { id:Number, type:'FS|SS|FF|SF', lag:Number(zile) }
// Pentru compatibilitate cu fișierele vechi, numerele simple sunt convertite la FS.
const DEP_TYPES = ['FS','SS','FF','SF'];

function _normalizeDep(d) {
  if (d == null) return null;
  if (typeof d === 'number') return { id: d, type: 'FS', lag: 0 };
  const id = +d.id;
  if (!Number.isFinite(id)) return null;
  const type = DEP_TYPES.includes(d.type) ? d.type : 'FS';
  const lag = Number.isFinite(+d.lag) ? +d.lag : 0;
  return { id, type, lag };
}

function _ensureDeps() {
  T.forEach(t => {
    if (!Array.isArray(t.deps)) { t.deps = []; return; }
    t.deps = t.deps.map(_normalizeDep).filter(Boolean);
  });
}

// Format text pt. afișare: "FS", "SS+2d", "FF-1d"
function depLabel(d) {
  const lag = +d.lag || 0;
  if (!lag) return d.type;
  return d.type + (lag > 0 ? '+' : '') + lag + 'd';
}

// Parsare token WBS avansat: "1.1", "1.1FS", "2.3SS+2", "3.4FF-1d"
// Returnează { wbs, type, lag } sau null
function _parseDepToken(tok) {
  const m = String(tok).trim().match(/^([\d.]+)\s*(FS|SS|FF|SF)?\s*([+\-]\s*\d+(?:\.\d+)?)?\s*d?$/i);
  if (!m) return null;
  const wbs = m[1];
  const type = (m[2] || 'FS').toUpperCase();
  const lag = m[3] ? parseFloat(m[3].replace(/\s+/g,'')) : 0;
  return { wbs, type, lag };
}

// ============================================================
// AUTO-SCHEDULING pe baza dependențelor (FS / SS / FF / SF + lag)
// ============================================================
// Pentru fiecare task cu dependențe (non-summary), calculează cea mai
// timpurie dată de start care respectă TOATE legăturile de intrare și
// actualizează t.sd (durata rămâne neschimbată).
//
// Logica anchor-urilor (în zile):
//   FS: succ.start = pred.start + pred.dur + lag
//   SS: succ.start = pred.start + lag
//   FF: succ.start = pred.start + pred.dur + lag - succ.dur
//   SF: succ.start = pred.start + lag - succ.dur
// Dacă există mai multe legături, câștigă cea mai târzie (max).
// Dependențe circulare → detectate și semnalate cu toast; task-urile
// rămase în ciclu nu se recalculează, dar restul proiectului se mișcă.
function _topoDepOrder() {
  const inDeg = new Map(), adj = new Map();
  T.forEach(t => { inDeg.set(t.id, 0); adj.set(t.id, []); });
  T.forEach(t => (t.deps || []).forEach(d => {
    if (!inDeg.has(d.id)) return;
    inDeg.set(t.id, (inDeg.get(t.id) || 0) + 1);
    adj.get(d.id).push(t.id);
  }));
  T.forEach(t => {            // copil -> capitol: datele capitolului se calculează din copii
    if (t.pid != null && inDeg.has(t.pid)) { inDeg.set(t.pid, inDeg.get(t.pid) + 1); adj.get(t.id).push(t.pid); }
  });
  const queue = [], order = [];
  T.forEach(t => { if ((inDeg.get(t.id) || 0) === 0) queue.push(t.id); });
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    adj.get(id).forEach(nxt => {
      inDeg.set(nxt, inDeg.get(nxt) - 1);
      if (inDeg.get(nxt) === 0) queue.push(nxt);
    });
  }
  return { order, hasCycle: order.length !== T.length };
}

// Start și durată ale unui capitol din copiii lui direcți
function _calcSummaryDates(t) {
  let minS = null, maxE = null;
  kids(t.id).forEach(c => { const s = pD(c.sd), e = endDate(c); if (!minS || s < minS) minS = s; if (!maxE || e > maxE) maxE = e; });
  if (minS && maxE) { t.sd = fD(minS); t.dur = workDur(minS, maxE); }
}

// Elimină dependențele dintre o activitate și capitolul ei / subactivitățile ei (ca în MS Project).
// Returnează numărul de legături eliminate.
function _fixHierarchyDeps() {
  let removed = 0;
  T.forEach(t => {
    if (!t.deps || !t.deps.length) return;
    const keep = t.deps.filter(d => !(d.id === t.id || isD(d.id, t.id) || isD(t.id, d.id)));
    removed += t.deps.length - keep.length; t.deps = keep;
  });
  return removed;
}

// Încearcă o schimbare de ierarhie; dacă ar crea o buclă de dependențe, o anulează.
function _tryHierarchyChange(fn) {
  const snap = JSON.stringify(T);
  fn();
  const removed = _fixHierarchyDeps();
  if (_topoDepOrder().hasCycle) { T = JSON.parse(snap); toast('🚫 Mutarea ar crea o buclă între dependențe — anulată'); return false; }
  if (removed) toast('ℹ️ ' + removed + (removed === 1 ? ' legătură' : ' legături') + ' între capitol și activitățile lui ' + (removed === 1 ? 'a fost eliminată' : 'au fost eliminate'));
  return true;
}

// Aplică o listă de dependențe unei activități, ignorând cele care ar crea bucle
function _applyDepsSafely(t, list) {
  t.deps = []; let bad = 0;
  list.forEach(d => {
    if (d.id === t.id || wouldCreateCycle(d.id, t.id)) { bad++; return; }
    if (!t.deps.some(x => x.id === d.id)) t.deps.push(d);
  });
  if (bad) toast('🚫 ' + bad + (bad === 1 ? ' legătură ignorată' : ' legături ignorate') + ' (ar crea o buclă sau ar lega o activitate de capitolul ei)');
}

let _lastCycleWarnAt = 0;
function recalcSchedule() {
  _ensureDeps();
  consWarn = {};
  if (!T.length) return;
  const { order, hasCycle } = _topoDepOrder();
  if (hasCycle) {
    const now = Date.now();
    if (now - _lastCycleWarnAt > 3000) {
      _lastCycleWarnAt = now;
      toast('⚠️ Dependențe circulare detectate');
    }
  }
  for (const tid of order) {
    const t = T.find(x => x.id === tid); if (!t) continue;
    if (hasK(t.id)) { _calcSummaryDates(t); continue; } // capitolele se derivă din copii (deja calculați în ordine)
    const hasDeps = !!(t.deps && t.deps.length);
    const hasCons = !!(t.cons && t.cons.type && t.cons.type !== 'ASAP' && (t.cons.type === 'ALAP' || t.cons.date));
    if (!hasDeps && !hasCons) continue;

    const sucDur = Math.max(1, t.dur);
    let bestStart = null;
    for (const d of (t.deps || [])) {
      const pred = T.find(x => x.id === d.id); if (!pred) continue;
      const lag = +d.lag || 0;
      // Totul în ZILE LUCRĂTOARE (calendarul proiectului): lag-ul se numără în zile lucrătoare.
      //   FS: începe în ziua lucrătoare de după finalul predecesorului (+lag)
      //   SS: începe la start predecesor (+lag)
      //   FF: se termină la finalul predecesorului (+lag)
      //   SF: se termină la startul predecesorului (+lag)
      let newStart;
      switch (d.type) {
        case 'FS': newStart = addWorkDays(endDate(pred), 1 + lag); break;
        case 'SS': newStart = addWorkDays(pD(pred.sd), lag); break;
        case 'FF': newStart = addWorkDays(addWorkDays(endDate(pred), lag), -(sucDur - 1)); break;
        case 'SF': newStart = addWorkDays(addWorkDays(pD(pred.sd), lag), -(sucDur - 1)); break;
        default:   continue;
      }
      if (!bestStart || newStart > bestStart) bestStart = newStart;
    }
    // Constrângeri: pornim de la data dată de legături (sau data curentă, dacă nu are legături)
    let s = bestStart || pD(t.sd);
    // ALAP: împinge activitatea cu rezerva calculată de CPM (doar pt. activități cu legături)
    if (bestStart && t.cons && t.cons.type === 'ALAP') s = addWorkDays(s, t._alap || 0);
    const r = _applyCons(t, s, bestStart);
    s = r.s; if (r.w) consWarn[t.id] = r.w;
    if (bestStart || hasCons) t.sd = fD(s);
  }
}

// ============================================================
// CONSTRÂNGERI (ca în MS Project)
// ============================================================
// t.cons = { type: 'ASAP'|'ALAP'|'SNET'|'SNLT'|'FNET'|'FNLT'|'MSO'|'MFO', date: 'YYYY-MM-DD' }
//  SNET: nu începe înainte de data   •  FNET: nu se termină înainte de data   (mută activitatea)
//  SNLT: nu începe după data         •  FNLT: nu se termină după data         (doar avertizează)
//  MSO / MFO: începe / se termină exact la data (rigid; legăturile care ar cere altfel dau avertisment)
let consWarn = {};
const CONS_LABELS = {
  ASAP: 'Cât mai devreme (implicit)', ALAP: 'Cât mai târziu posibil',
  SNET: 'Nu începe înainte de', SNLT: 'Nu începe după',
  FNET: 'Nu se termină înainte de', FNLT: 'Nu se termină după',
  MSO: 'Trebuie să înceapă pe', MFO: 'Trebuie să se termine pe'
};
const CONS_NEEDS_DATE = ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];

function _applyCons(t, s, depStart) {
  const c = t.cons;
  if (!c || !c.type || !c.date || !CONS_NEEDS_DATE.includes(c.type)) return { s, w: null };
  const dt = pD(c.date), dur = Math.max(1, t.dur);
  const endOf = st => endDate({ sd: fD(st), dur });
  const f = d => fmtDate(d);
  switch (c.type) {
    case 'SNET': if (s < dt) s = dt; break;
    case 'FNET': if (endOf(s) < dt) s = addWorkDays(nextWork(dt), -(dur - 1)); break;
    case 'SNLT': if (s > dt) return { s, w: 'Începe după ' + f(dt) + ' (restricție „nu începe după”)' }; break;
    case 'FNLT': if (endOf(s) > dt) return { s, w: 'Se termină după ' + f(dt) + ' (restricție „nu se termină după”)' }; break;
    case 'MSO': { const ms = nextWork(dt); if (depStart && depStart > ms) return { s: ms, w: 'Legăturile cer start după ' + f(dt) + ', dar e fixată pe ' + f(dt) }; s = ms; break; }
    case 'MFO': { const ms = addWorkDays(nextWork(dt), -(dur - 1)); if (depStart && depStart > ms) return { s: ms, w: 'Legăturile cer final după ' + f(dt) + ', dar e fixată pe ' + f(dt) }; s = ms; break; }
  }
  return { s, w: null };
}

// Verifică dacă adăugarea unui link pred → succ ar introduce un ciclu
function wouldCreateCycle(predId, succId) {
  if (predId === succId) return true;
  // DFS din succ pe graful curent: dacă ajungem la pred, e ciclu
  const stack = [succId], seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === predId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    // Toate task-urile care au cur ca predecesor
    T.forEach(t => {
      if ((t.deps || []).some(d => d.id === cur)) stack.push(t.id);
    });
    const me = T.find(x => x.id === cur);            // capitolul depinde de copiii lui
    if (me && me.pid != null) stack.push(me.pid);
  }
  return false;
}

function recalcSummaries() {
  function calc(id) {
    const ch=kids(id); if(!ch.length) return;
    ch.forEach(c=>calc(c.id)); let minS=null, maxE=null, tp=0;
    ch.forEach(c=>{ const s=pD(c.sd), e=endDate(c); if(!minS||s<minS) minS=s; if(!maxE||e>maxE) maxE=e; tp+=c.prog; });
    const t=T.find(x=>x.id===id); if(t&&minS&&maxE){t.sd=fD(minS); t.dur=workDur(minS,maxE); t.prog=Math.round(tp/ch.length);}
  }
  T.filter(t=>!t.pid).forEach(r=>calc(r.id));
}

function flat() { const roots=T.filter(t=>!t.pid), r=[]; (function w(l){l.forEach(t=>{r.push(t); if(!coll.has(t.id))w(kids(t.id))})})(roots); return r; }
function wbs() { const m={}; (function w(l,p){l.forEach((t,i)=>{const n=p?p+"."+(i+1):String(i+1); m[t.id]=n; w(kids(t.id),n)})})(T.filter(t=>!t.pid),""); return m; }
function wbsReverse() { const w=wbs(), r={}; for(const id in w) r[w[id]]=+id; return r; }
function ps(t) { const s=pD(t.sd), e=endDate(t); return{...t,_s:s,_e:e}; }
function ab() { if(!T.length) return null; let mn=null, mx=null; T.forEach(t=>{const p=ps(t); if(!mn||p._s<mn)mn=p._s; if(!mx||p._e>mx)mx=p._e; if(t.deadline){const dl=pD(t.deadline); if(dl>mx)mx=dl;} const bs=(typeof blSpan==="function"&&showBaseline)?blSpan(t):null; if(bs){if(bs.s<mn)mn=bs.s; if(bs.e>mx)mx=bs.e;} const ac=(typeof actSpan==="function")?actSpan(t):null; if(ac){if(ac.s<mn)mn=ac.s; if(ac.e>mx)mx=ac.e;}}); return{mn,mx}; }

// ============================================================
// SINCRONIZARE TAB ↔ VARIABILE GLOBALE
// ============================================================

// Salvează datele curente în tab-ul activ
function syncTabData() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) { tab.T = JSON.parse(JSON.stringify(T)); tab.nid = nid; tab.cal = JSON.parse(JSON.stringify(CAL)); tab.res = JSON.parse(JSON.stringify(RES)); tab.meta = JSON.parse(JSON.stringify(META)); }
}

// Curăță datele încărcate (fișier importat / localStorage): câmpuri lipsă, date și durate invalide,
// id-uri duplicate, părinți inexistenți sau în buclă, dependențe spre activități inexistente
function _sanitizeTasks() {
  if (!Array.isArray(T)) T = [];
  T = T.filter(t => t && typeof t === 'object');
  const seen = new Set();
  const today = fD(new Date());
  T.forEach(t => {
    let id = Number.isInteger(+t.id) && +t.id > 0 ? +t.id : 0;
    if (!id || seen.has(id)) id = Math.max(0, ...T.map(x => +x.id || 0), ...seen) + 1;
    t.id = id; seen.add(id);
    t.nm = typeof t.nm === 'string' ? t.nm : String(t.nm == null ? 'Activitate' : t.nm);
    const okDate = typeof t.sd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.sd) && !isNaN(new Date(t.sd + 'T00:00:00'));
    if (!okDate) t.sd = today;
    let d = Math.round(+t.dur);
    if (!isFinite(d) || d < 0) d = 1;
    if (d === 0 && !t.isMilestone) d = 1;
    t.dur = d;
    const p = +t.prog; t.prog = isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
    if (!Array.isArray(t.deps)) t.deps = [];
    if (!Array.isArray(t.assign)) delete t.assign;
  });
  const ids = new Set(T.map(t => t.id));
  T.forEach(t => {
    if (t.pid != null && (!ids.has(t.pid) || t.pid === t.id)) t.pid = null;
    if (t.pid === undefined) t.pid = null;
    t.deps = t.deps.filter(d => ids.has(d && typeof d === 'object' ? d.id : d) && (d && typeof d === 'object' ? d.id : d) !== t.id);
  });
  const byId = new Map(T.map(t => [t.id, t]));
  T.forEach(t => {   // părinți în buclă → ridică la rădăcină
    let c = t, n = 0;
    while (c && c.pid != null && n++ < T.length + 1) c = byId.get(c.pid);
    if (n > T.length) t.pid = null;
  });
}

// Încarcă datele din tab-ul activ în variabilele globale
function loadTabData(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  setCal(tab.cal); setRes(tab.res); setMeta(tab.meta);
  if (typeof clearFilter === 'function') clearFilter(true);   // filtrul aparține proiectului pe care îl părăsim
  if (typeof _levelNote !== 'undefined') _levelNote = '';      // la fel și rezumatul ultimei nivelări
  T   = JSON.parse(JSON.stringify(tab.T));
  _sanitizeTasks();
  nid = Math.max(+tab.nid || 1, ...T.map(t => t.id + 1));
  sel = null;
  coll.clear();
  _ensureDeps();
  _fixHierarchyDeps();   // curăță legături vechi între un capitol și activitățile lui
  // Reset summary-only state per tab
  if (typeof _summaryOnly !== 'undefined') _summaryOnly = false;
  if (typeof treeFocus !== 'undefined') { treeFocus = null; treeOpen.clear(); }
  const btn = $('btnSummaryOnly'); if (btn) btn.classList.remove('active');
  _history = [];
  _future  = [];
  updateUndoRedoBtns();
}

// ============================================================
// GESTIONARE TAB-URI
// ============================================================

function addNewTab(name, data, nidVal, cal, res, meta) {
  const tabName = name || ("Proiect " + (tabs.length + 1));
  const tab = {
    id:   nextTabId++,
    name: tabName,
    T:    data  || [],
    nid:  nidVal|| 1,
    cal:  cal || CAL_DEFAULT(),
    res:  res || { list: [], next: 1, cur: "RON" },
    meta: meta || { sdate: null }
  };
  tabs.push(tab);
  switchTab(tab.id);
  saveAllTabs();
  return tab;
}

function switchTab(tabId) {
  // Salvăm datele tab-ului curent înainte de a schimba
  syncTabData();
  activeTabId = tabId;
  loadTabData(tabId);
  renderTabsBar();
  renderAll();
  if (typeof _refreshFileUI === 'function') _refreshFileUI();
}

function closeTab(tabId, e) {
  if (e) e.stopPropagation();
  customConfirm('Închizi acest proiect? Ce nu ai salvat într-un fișier (Ctrl+S) se pierde.', function() {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    tabs.splice(idx, 1);
    delete fileHandles[tabId]; delete fileAuto[tabId]; delete fileNames[tabId]; delete fileSavedAt[tabId];

    if (!tabs.length) {
      // Niciun proiect deschis: ecranul de bun venit
      activeTabId = null;
      T = []; nid = 1; sel = null; coll.clear(); _history = []; _future = [];
      setCal(null); setRes(null); setMeta(null); clearFilter(true);
      updateUndoRedoBtns();
    } else if (activeTabId === tabId) {
      // Dacă am închis tab-ul activ, activăm vecinul
      const newIdx = Math.min(idx, tabs.length - 1);
      activeTabId = tabs[newIdx].id;
      loadTabData(activeTabId);
    }

    saveAllTabs();
    renderTabsBar();
    renderAll();
  });
}

function renameTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  // Găsim span-ul cu numele și îl înlocuim cu un input
  const span = document.querySelector(`.proj-tab[data-tabid="${tabId}"] .proj-tab-name`);
  if (!span) return;

  const input = document.createElement('input');
  input.className = 'proj-tab-name-input';
  input.value = tab.name;
  span.replaceWith(input);
  input.focus();
  input.select();

  function done() {
    tab.name = input.value.trim() || tab.name;
    saveAllTabs();
    renderTabsBar();
  }
  input.addEventListener('blur', done);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = tab.name; input.blur(); }
  });
}

function renderTabsBar() {
  const bar = $("projTabsBar");
  let h = '';
  tabs.forEach(tab => {
    const isActive = tab.id === activeTabId;
    h += `<div class="proj-tab${isActive?' active':''}" data-tabid="${tab.id}"
               onclick="switchTab(${tab.id})"
               ondblclick="renameTab(${tab.id})">
            <span class="proj-tab-name" title="Dublu-click pentru redenumire">${esc(tab.name)}</span>
            <button class="proj-tab-close" onclick="closeTab(${tab.id},event)" title="Închide">✕</button>
          </div>`;
  });
  // Butonul + rămâne la final
  h += `<button class="proj-tab-add" onclick="newProject()" title="Proiect nou">＋</button>`;
  bar.innerHTML = h;
}

// ============================================================
// SALVARE / ÎNCĂRCARE LOCALSTORAGE (toate tab-urile)
// ============================================================
let _saveTimer = null;

function saveAllTabs() {
  syncTabData(); // asigurăm că tab-ul curent e actualizat
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('ganttPRO_tabs',   JSON.stringify(tabs));
      localStorage.setItem('ganttPRO_active', String(activeTabId));
      localStorage.setItem('ganttPRO_nextId', String(nextTabId));
      if (typeof fileAutoWrite === 'function') fileAutoWrite();

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
      const sbar = $("sbar");
      if (sbar) {
        let ind = sbar.querySelector('.save-indicator');
        if (!ind) {
          ind = document.createElement('span');
          ind.className = 'save-indicator';
          ind.style.cssText = 'color:rgba(255,255,255,.6);font-size:10px;margin-left:auto';
          sbar.appendChild(ind);
        }
        ind.textContent = '💾 Salvat automat la ' + timeStr;
      }
    } catch(e) {}
  }, 800);
}

function loadAllTabs() {
  try {
    const savedTabs   = localStorage.getItem('ganttPRO_tabs');
    const savedActive = localStorage.getItem('ganttPRO_active');
    const savedNextId = localStorage.getItem('ganttPRO_nextId');
    if (savedTabs) {
      tabs        = JSON.parse(savedTabs);
      if (!Array.isArray(tabs)) tabs = [];
      nextTabId   = savedNextId ? +savedNextId : tabs.length + 1;
      if (!tabs.length) { activeTabId = null; return true; }   // niciun proiect deschis → bun venit
      activeTabId = savedActive && tabs.some(t => t.id === +savedActive) ? +savedActive : tabs[0].id;
      loadTabData(activeTabId);
      return true;
    }
  } catch(e) {}
  return false;
}

// ============================================================
// EXPORT / IMPORT JSON
// ============================================================
function exportJSON() {
  const tab  = tabs.find(t => t.id === activeTabId);
  const defaultName = tab ? tab.name : 'proiect-gantt';
  showNameModal(defaultName, function(name) {
    const data = JSON.stringify({ T, nid, cal: CAL, res: RES, meta: META, name, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = name.replace(/\s+/g,'-') + '-' + fD(new Date()) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('💾 Proiect exportat!');
  });
}

// Import → creează tab nou, nu suprascrie
function importJSONasTab() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (!d.T || !Array.isArray(d.T)) throw new Error('Format invalid');
        const tabName = d.name || file.name.replace('.json','');
        addNewTab(tabName, d.T, d.nid || (d.T.length ? Math.max(...d.T.map(x=>x.id))+1 : 1), d.cal, d.res, d.meta);
        toast('📂 Proiect încărcat în tab nou: ' + tabName);
      } catch(err) { toast('❌ Fișier invalid!'); }
    };
    reader.readAsText(file);
  };
  document.body.appendChild(input); input.click(); document.body.removeChild(input);
}

// ============================================================
// ZOOM
// ============================================================
function zoom(dir) {
  if (view === "timeline") return;
  if (view === "tree") { setTreeZoom(treeZoom + dir * 0.1); return; }
  isAutoZoom = false;
  $("gBody").classList.add("manual-zoom");
  zoomLevel = clamp(Math.round(zoomLevel * (dir > 0 ? 1.25 : 0.8)), 4, 300);
  document.documentElement.style.setProperty("--day-w", Math.round(30 * zoomLevel / 100) + "px");
  $("zoomLbl").textContent = zoomLevel + "%";
  if(typeof renderGantt === 'function') renderGantt();
}

function fitZoom() {
  if (view === "timeline") return;
  if (view === "tree") { treeFit(); return; }
  isAutoZoom = true;
  $("gBody").classList.remove("manual-zoom");
  renderAll();
  toast("📐 Auto-Încadrare Activată!");
}

// ============================================================
// ACȚIUNI (cu pushHistory și syncTabData)
// ============================================================
// Toggle milestone pe task-ul selectat
function toggleMilestone() {
  if (!sel) { toast('⚠️ Selectează un task'); return; }
  const t = T.find(x => x.id === sel);
  if (!t) return;
  if (hasK(t.id)) { toast('⚠️ Capitolele nu pot fi milestone'); return; }
  pushHistory();
  t.isMilestone = !t.isMilestone;
  if (t.isMilestone) { t.dur = 1; t.prog = 0; }
  syncTabData();
  renderAll();
  toast(t.isMilestone ? '♦ Convertit la milestone' : '📊 Convertit la activitate');
}

function delSel() {
  if(!sel) return;
  if(filterActive() && view==='gantt' && hasK(sel)) { toast('🔎 Oprește filtrul ca să ștergi un capitol (ar șterge și rândurile ascunse)'); return; }
  pushHistory();
  const d=allD(sel), rm=new Set([sel,...d]);
  // Curățăm referințele de dependență către task-urile șterse
  T.forEach(t => { if (t.deps) t.deps = t.deps.filter(x => !rm.has(x.id)); });
  T=T.filter(t=>!rm.has(t.id)); sel=null; d.forEach(x=>coll.delete(x));
  syncTabData(); renderAll();
}

function upd(id, f, v) {
  const t = T.find(x => x.id === id); if (!t) return;
  if (f === "nm") { t.nm = v; syncTabData(); return; }
  pushHistory();
  if (f === "dur") {
    if (v === "" || +v < 1) { toast("⚠️ Durată invalidă!"); return; }
    t.dur = parseInt(v, 10);
  }
  else if (f === "prog") {
    if (v === "") return;
    const oldProg = t.prog;
    t.prog = clamp(parseInt(v, 10) || 0, 0, 100);
    const msg = _syncActuals(t, oldProg); if (msg) toast('📅 ' + msg);   // început / final real completate din data de status
  }
  else if (f === "sd" && v) {
    const oldEnd = endDate(t);
    t.sd = v;
    t.dur = workDur(pD(v), oldEnd);
  }
  else if (f === "ed" && v) { t.dur = workDur(pD(t.sd), pD(v)); }
  else if (f === "pid") { t.pid = v; }
  syncTabData(); renderAll();
}

// Actualizează dependențele unui task din string WBS extins.
// Acceptă: "1.1", "1.1FS", "2.3SS+2", "3.4FF-1d", separate cu ; sau ,
function updDeps(id, wbsStr) {
  const t = T.find(x => x.id === id);
  if (!t) return;
  pushHistory();
  if (!wbsStr || !wbsStr.trim()) { t.deps = []; syncTabData(); renderAll(); return; }
  const rev = wbsReverse();
  const tokens = wbsStr.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const out = [];
  tokens.forEach(tok => {
    const p = _parseDepToken(tok); if (!p) return;
    const predId = rev[p.wbs];
    if (predId === undefined || predId === id) return;
    out.push({ id: predId, type: p.type, lag: p.lag });
  });
  _applyDepsSafely(t, out);
  syncTabData(); renderAll();
}

function indentSel() {
  if(!sel) return;
  if(structLocked()) return;
  const t=T.find(x=>x.id===sel); if(!t) return;
  const sibs=t.pid?kids(t.pid):T.filter(x=>!x.pid);
  const i=sibs.findIndex(s=>s.id===sel); if(i<=0) return;
  pushHistory();
  const newPid=sibs[i-1].id;
  if(!_tryHierarchyChange(()=>{ const x=T.find(y=>y.id===sel); x.pid=newPid; })){ _history.pop(); updateUndoRedoBtns(); renderAll(); return; }
  coll.delete(newPid);
  syncTabData(); renderAll(); toast("Subcapitol");
}

function outdentSel() {
  if(!sel) return;
  if(structLocked()) return;
  const t=T.find(x=>x.id===sel); if(!t||!t.pid) return;
  pushHistory();
  if(!_tryHierarchyChange(()=>{ const x=T.find(y=>y.id===sel), par=T.find(y=>y.id===x.pid); x.pid=par?par.pid:null; })){ _history.pop(); updateUndoRedoBtns(); renderAll(); return; }
  syncTabData(); renderAll(); toast("Scos un nivel");
}

function moveSel(dir) {
  if(!sel) return;
  if(structLocked()) return;
  const t=T.find(x=>x.id===sel); if(!t) return;
  const sibs=t.pid?kids(t.pid):T.filter(x=>!x.pid);
  const si=sibs.findIndex(s=>s.id===sel), ni=si+dir; if(ni<0||ni>=sibs.length) return;
  pushHistory();
  const mi=T.indexOf(t), ti=T.indexOf(sibs[ni]); [T[mi],T[ti]]=[T[ti],T[mi]];
  syncTabData(); renderAll();
}

function toggleC(id) { if(coll.has(id)) coll.delete(id); else coll.add(id); renderAll(); }
function selTask(id) { sel=sel===id?null:id; renderAll(); if(typeof closeCtx==='function') closeCtx(); }

function handleDrop(dragId, targetId, dropType) {
  if(!dragId||dragId===targetId||isD(targetId,dragId)) return;
  const src=T.find(x=>x.id===dragId), tgt=T.find(x=>x.id===targetId); if(!src||!tgt) return;
  if(structLocked()) return;
  pushHistory();
  const msg = dropType==="inside" ? "Subcapitol în: "+tgt.nm : (dropType==="above" ? "Mutat deasupra" : "Mutat dedesubt");
  const ok = _tryHierarchyChange(()=>{
    const s2=T.find(x=>x.id===dragId), g2=T.find(x=>x.id===targetId);
    T.splice(T.indexOf(s2),1); const ti=T.findIndex(x=>x.id===targetId);
    if (dropType==="inside") { s2.pid=targetId; T.splice(ti+1,0,s2); }
    else if (dropType==="above") { s2.pid=g2.pid; T.splice(ti,0,s2); }
    else { s2.pid=g2.pid; T.splice(ti+1,0,s2); }
  });
  if(!ok){ _history.pop(); updateUndoRedoBtns(); renderAll(); return; }
  if (dropType==="inside") coll.delete(targetId);
  toast(msg);
  syncTabData(); renderAll();
}

function loadDemo() {
  pushHistory();
  // Demo „Construcție Hală Industrială" — acoperă tot ce poate aplicația:
  // legături FS/SS/FF/SF cu lag, drum critic, calendar cu zi liberă, restricții, termene limită,
  // linia de bază cu întârzieri, activități întârziate (față de „Azi"), resurse, costuri și supra-alocări.
  const start = fD(addWorkDays(new Date(), -16));          // proiectul a început acum ~3 săptămâni
  const wd = n => fD(addWorkDays(pD(start), n));           // „n zile lucrătoare de la start"
  const F = (id, type, lag) => ({ id, type, lag: lag || 0 });
  T = [
    {id:1,  nm:"Construcție Hală Industrială", sd:start, dur:1, prog:0, pid:null, deps:[]},
    {id:2,  nm:"1. Pregătire", sd:start, dur:1, prog:0, pid:1, deps:[]},
    {id:3,  nm:"Studii și proiectare", sd:start, dur:8, prog:100, pid:2, deps:[], notes:"Geotehnic, topografic, proiect tehnic."},
    {id:4,  nm:"Autorizație de construire", sd:start, dur:5, prog:100, pid:2, deps:[F(3,'FS',2)]},
    {id:5,  nm:"Mobilizare șantier", sd:start, dur:3, prog:60, pid:2, deps:[F(3,'SS',3)], notes:"Rămasă în urmă: utilajele au ajuns târziu."},
    {id:6,  nm:"2. Fundație și structură", sd:start, dur:1, prog:0, pid:1, deps:[]},
    {id:7,  nm:"Săpătură", sd:start, dur:4, prog:40, pid:6, deps:[F(4,'FS'),F(5,'FS')]},
    {id:8,  nm:"Turnare fundație", sd:start, dur:5, prog:0, pid:6, deps:[F(7,'FS')], notes:"Muncă fixă: dacă adaugi betoniști, durata scade."},
    {id:9,  nm:"Întărire beton", sd:start, dur:7, prog:0, pid:6, deps:[F(8,'FS')], notes:"Timp tehnologic fix — nu se poate scurta."},
    {id:10, nm:"Structură metalică", sd:start, dur:10, prog:0, pid:6, deps:[F(9,'FS',-2)]},
    {id:11, nm:"3. Închideri și instalații", sd:start, dur:1, prog:0, pid:1, deps:[]},
    {id:12, nm:"Acoperiș", sd:start, dur:6, prog:0, pid:11, deps:[F(10,'FS')]},
    {id:13, nm:"Pereți exteriori", sd:start, dur:7, prog:0, pid:11, deps:[F(10,'SS',4)]},
    {id:14, nm:"Instalații electrice", sd:start, dur:8, prog:0, pid:11, deps:[F(13,'SS',2),F(12,'FF',1)]},
    {id:15, nm:"Instalații HVAC", sd:start, dur:4, prog:0, pid:11, deps:[F(13,'FS')]},
    {id:16, nm:"4. Finisaje și predare", sd:start, dur:1, prog:0, pid:1, deps:[]},
    {id:17, nm:"Finisaje interioare", sd:start, dur:6, prog:0, pid:16, deps:[F(14,'FS'),F(15,'FS')]},
    {id:18, nm:"Amenajare exterior", sd:start, dur:5, prog:0, pid:16, deps:[F(12,'FS')], notes:"Are rezervă mare — nu e pe drumul critic."},
    {id:19, nm:"Teste și verificări", sd:start, dur:3, prog:0, pid:16, deps:[F(17,'FS')]},
    {id:20, nm:"Recepție și predare", sd:start, dur:1, prog:0, pid:16, deps:[F(19,'FS'),F(18,'FS')], isMilestone:true}
  ];
  nid = 21; coll.clear(); sel = null; setMeta(null);
  const D = id => T.find(x => x.id === id);

  // Calendar: luni–vineri + o zi liberă
  setCal({ days: [0,1,1,1,1,1,0], hol: [wd(10)] });

  // Resurse (oameni, utilaje, materiale, cost fix)
  setRes({ cur: 'RON', next: 8, list: [
    {id:1, name:"Inginer șef",           type:"work",     rate:150, max:100},
    {id:2, name:"Echipă betoniști",      type:"work",     rate:60,  max:500},
    {id:3, name:"Excavator 30 t",        type:"work",     rate:250, max:200},
    {id:4, name:"Echipă instalatori",    type:"work",     rate:70,  max:200},
    {id:5, name:"Beton C30/37",          type:"material", rate:450, unit:"m³"},
    {id:6, name:"Oțel-beton BST500",     type:"material", rate:5,   unit:"kg"},
    {id:7, name:"Taxă autorizare ISC",   type:"cost",     rate:0}
  ]});
  D(3).assign  = [{rid:1, units:100}];
  D(4).assign  = [{rid:7, units:12000}, {rid:1, units:20}];
  D(5).assign  = [{rid:3, units:100}];
  D(7).assign  = [{rid:3, units:200}, {rid:1, units:20}];
  D(8).assign  = [{rid:2, units:400}, {rid:5, units:350}, {rid:6, units:25000}];
  D(8).ttype   = 'fw';                                   // muncă fixă
  D(10).assign = [{rid:2, units:300}];
  D(12).assign = [{rid:2, units:200}];
  D(13).assign = [{rid:2, units:300}];                   // se suprapune cu Structura metalică => 600% > 500% (supra-alocare)
  D(14).assign = [{rid:4, units:150}, {rid:1, units:20}];
  D(15).assign = [{rid:4, units:100}];                   // 150% + 100% = 250% > 200% (supra-alocare)
  D(17).assign = [{rid:4, units:100}];
  D(19).assign = [{rid:1, units:100}];
  _ensureDeps();

  // 1) Planul inițial → linia de bază
  renderAll();
  T.forEach(t => { if (!hasK(t.id)) t.bl = { sd: t.sd, dur: t.dur }; });
  showBaseline = true; try { localStorage.setItem('ganttBase', '1'); } catch (e) {}

  // 2) Ce s-a întâmplat apoi: întârzieri, restricții, termene limită
  D(7).dur = 6;                                          // Săpătura a durat mai mult decât planul
  D(5).cons  = { type: 'SNET', date: wd(6) };            // nu începe înainte de data X (se mută mai târziu)
  D(8).cons  = { type: 'SNLT', date: wd(17) };           // nu începe după X (avertisment: legăturile o împing peste)
  D(18).cons = { type: 'ALAP' };                         // cât mai târziu posibil (își consumă rezerva)
  D(10).deadline = wd(36);                               // termen limită depășit (roșu)
  D(14).deadline = wd(85);                               // termen limită respectat (verde)
  D(20).deadline = wd(85);

  // 3) Progres real: ce s-a întâmplat efectiv (început / final real) — vezi bara subțire de deasupra activităților
  renderAll();
  D(3).as = D(3).sd;  D(3).af = fD(addWorkDays(endDate(D(3)), 1));   // a durat o zi mai mult decât planul (bară roșie)
  D(4).as = D(4).sd;  D(4).af = fD(endDate(D(4)));                   // la timp (bară verde)
  D(5).as = D(5).sd;                                                 // în desfășurare (bară albastră)
  D(7).as = D(7).sd;
  syncTabData(); renderAll(); _refreshPlanUI();
}

function clearAll() {
  if (!T.length) return;
  customConfirm("Ștergi tot proiectul curent?", function() {
    pushHistory();
    T=[]; nid=1; sel=null; coll.clear();
    syncTabData(); saveAllTabs(); renderAll();
    toast("🗑️ Proiect șters");
  });
}
