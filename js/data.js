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

const MAX_HISTORY_CHARS = 30e6;   // plafon de memorie pentru instantaneele de undo (≈ 60 MB de text în JS)

function pushHistory() {
  const snap = JSON.stringify({ T, nid, cal: CAL, res: RES, meta: META });
  if (_history[_history.length - 1] !== snap) {                 // același conținut ca ultimul instantaneu → nu-l dublăm
    _history.push(snap);
    let size = _history.reduce((s, h) => s + h.length, 0);
    while (_history.length > 1 && (_history.length > MAX_HISTORY || size > MAX_HISTORY_CHARS)) size -= _history.shift().length;
  }
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
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
// Text simplu din date venite din fișiere: fără caractere care ar putea închide un atribut / tag, fără caractere de control, lungime limitată
const plainText = (s, max) => String(s == null ? "" : s).replace(/[<>"'`&\u0000-\u001f]/g, "").trim().slice(0, max || 60);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validISO = s => typeof s === "string" && ISO_DATE.test(s) && !isNaN(new Date(s + "T00:00:00"));
const isWE = d => d.getDay()===0 || d.getDay()===6;
const MN = d => ["Ian","Feb","Mar","Apr","Mai","Iun","Iul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
const todayStr = fD(new Date());
const fmtDate = d => `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;

function toast(m) { const t=$("toast"); t.textContent=m; t.classList.add("v"); clearTimeout(toast._); toast._=setTimeout(()=>t.classList.remove("v"),clamp(m.length*55,2500,9000)); }   // mesajele lungi rămân mai mult pe ecran
// Index temporar (id → activitate, părinte → copii) folosit doar cât durează recalcularea (vezi recomputeAll):
// în acest interval structura lui T nu se schimbă, iar căutările devin O(1) în loc de O(n).
let _ix = null;
function withIndex(fn) {
  if (_ix) return fn();
  const byId = new Map(), kidsOf = new Map();
  T.forEach(t => { byId.set(t.id, t); if (!kidsOf.has(t.pid)) kidsOf.set(t.pid, []); kidsOf.get(t.pid).push(t); });
  _ix = { byId, kidsOf };
  try { return fn(); } finally { _ix = null; }
}
const taskById = id => _ix ? _ix.byId.get(id) : T.find(x => x.id === id);
function kids(p) { return _ix ? (_ix.kidsOf.get(p) || []) : T.filter(t=>t.pid===p); }
function dep(id) { let d=0, t=taskById(id); while(t&&t.pid){d++; t=taskById(t.pid)} return d; }
function allD(id) { const r=[]; kids(id).forEach(c=>{r.push(c.id); r.push(...allD(c.id))}); return r; }
function isD(c,a) { let t=taskById(c); while(t&&t.pid){if(t.pid===a) return true; t=taskById(t.pid)} return false; }
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
  const lag = Number.isFinite(+d.lag) ? Math.round(+d.lag) : 0;   // decalaj în zile lucrătoare întregi (fracțiunile nu sunt suportate)
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
// Legăturile moștenite: o legătură pusă PE un capitol (capitolul e succesor) se aplică fiecărei activități din el, ca în MS Project.
// Doar FS și SS (legături de START); FF / SF pe capitole nu sunt permise (MS Project le refuză și el).
function inheritedDeps(t) {
  const out = [];
  for (let p = t.pid, n = 0; p != null && n < 1000; n++) {
    const par = taskById(p); if (!par) break;
    (par.deps || []).forEach(d => { if (d.type === 'FS' || d.type === 'SS') out.push(d); });
    p = par.pid;
  }
  return out;
}
// Legăturile care dictează startul unei activități: ale ei + cele moștenite de la capitolele ei
const schedDeps = t => hasK(t.id) ? [] : (t.deps || []).concat(inheritedDeps(t));

function _topoDepOrder() {
  const inDeg = new Map(), adj = new Map();
  T.forEach(t => { inDeg.set(t.id, 0); adj.set(t.id, []); });
  T.forEach(t => (hasK(t.id) ? (t.deps || []) : schedDeps(t)).forEach(d => {
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
  t.deps = []; let bad = 0, summ = 0;
  list.forEach(d => {
    if (hasK(t.id) && (d.type === 'FF' || d.type === 'SF')) { summ++; return; }   // pe un capitol: doar legături de start (FS / SS)
    if (d.id === t.id || wouldCreateCycle(d.id, t.id)) { bad++; return; }
    if (!t.deps.some(x => x.id === d.id)) t.deps.push(d);
  });
  if (bad) toast('🚫 ' + bad + (bad === 1 ? ' legătură ignorată' : ' legături ignorate') + ' (ar crea o buclă sau ar lega o activitate de capitolul ei)');
  if (summ) toast('🚫 Un capitol poate avea doar legături FS sau SS (ele se aplică tuturor activităților din el)');
}

// Startul pe care îl cere legătura `d` activității `t`, cu lag-ul dat (zile lucrătoare, calendarul proiectului); null dacă predecesorul lipsește.
//   FS: începe în ziua lucrătoare de după finalul predecesorului (+lag)   SS: începe la startul predecesorului (+lag)
//   FF: se termină la finalul predecesorului (+lag)                       SF: se termină la startul predecesorului (+lag)
// Reperul are durată 0 (ca în MS Project): stă la FINALUL zilei lui. Ca succesor FS / FF al lui A, cade în ultima zi a lui A
// (nu în ziua următoare), iar ca predecesor FS, succesorul începe în ziua lucrătoare de după el — deci nu consumă o zi din plan.
//   SF (start → final): succesorul se termină în ziua lucrătoare dinaintea startului predecesorului (+lag), nu în aceeași zi.
function depStart(t, d, lag) {
  const pred = taskById(d.id); if (!pred) return null;
  const ms = !!t.isMilestone && !hasK(t.id), sucDur = ms ? 1 : Math.max(1, t.dur);
  switch (d.type) {
    case 'FS': return ms ? addWorkDays(endDate(pred), lag) : addWorkDays(endDate(pred), 1 + lag);
    case 'SS': return addWorkDays(pD(pred.sd), lag);
    case 'FF': return addWorkDays(addWorkDays(endDate(pred), lag), -(sucDur - 1));
    case 'SF': return addWorkDays(addWorkDays(pD(pred.sd), lag - 1), -(sucDur - 1));
    default:   return null;
  }
}

// Zile lucrătoare de adăugat lui `a` ca să ajungă la `b` (negativ dacă b < a); a și b sunt zile lucrătoare
function workDaysBetween(a, b) {
  let n = 0;
  if (b >= a) { for (let r = a, g = 0; r < b && g < 36600; g++) { r = aD(r, 1); if (isWork(r)) n++; } return n; }
  for (let r = a, g = 0; r > b && g < 36600; g++) { r = aD(r, -1); if (isWork(r)) n--; }
  return n;
}

// O activitate cu legături a fost mutată cu mouse-ul la t.sd: mutarea se păstrează ca LAG pe legătura care îi dictează startul
// (altfel programarea automată o readuce imediat la data legăturii). Nu coboară sub lag 0 (nu creează suprapuneri din greșeală).
// Returnează legătura modificată sau null dacă nu s-a schimbat nimic.
function lagFromMove(t) {
  if (!t || !(t.deps && t.deps.length) || hasK(t.id) || t.isMilestone) return null;
  if (t.cons && t.cons.type && t.cons.type !== 'ASAP') return null;      // restricția dictează startul, nu legătura
  let drv = null, best = null;
  t.deps.forEach(d => { const s = depStart(t, d, +d.lag || 0); if (s && (!best || s > best)) { best = s; drv = d; } });
  if (!drv) return null;
  const start0 = depStart(t, drv, 0), target = nextWork(pD(t.sd));
  const lag = Math.max(workDaysBetween(start0, target), Math.min(0, +drv.lag || 0));
  if (lag === (+drv.lag || 0)) return null;
  drv.lag = lag;
  return drv;
}

// Utilizatorul a scris un start nou (tabel / Detalii): activitatea se MUTĂ, durata rămâne (ca în MS Project).
// Cu legături proprii, mutarea devine decalaj pe legătura care o ține (ca la tragerea barei); cu legături doar moștenite de la capitol,
// devine restricția „Nu începe înainte de". O restricție pusă de utilizator nu se atinge. Întoarce un mesaj (sau '').
function moveStartTo(t, v) {
  t.sd = v;
  if (hasK(t.id)) return '';
  if (t.cons && t.cons.type === 'SNET') {            // „Nu începe înainte de": ca în MS Project, startul scris îi devine noua dată
    if (t.cons.date === v) return '';
    t.cons = { type: 'SNET', date: v }; return '📌 Restricție actualizată: nu începe înainte de ' + fmtDate(pD(v));
  }
  if (t.cons && t.cons.type && t.cons.type !== 'ASAP') return '';
  if (t.deps && t.deps.length) { const d = lagFromMove(t); return d ? '↔ Legătura cu ' + (wbs()[d.id] || '?') + ' are acum ' + depLabel(d) : ''; }
  if (inheritedDeps(t).length) { t.cons = { type: 'SNET', date: v }; return '📌 Restricție pusă: nu începe înainte de ' + fmtDate(pD(v)); }
  return '';
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
    const t = taskById(tid); if (!t) continue;
    if (hasK(t.id)) { _calcSummaryDates(t); continue; } // capitolele se derivă din copii (deja calculați în ordine)
    const deps = schedDeps(t), hasDeps = deps.length > 0;
    const hasCons = !!(t.cons && t.cons.type && t.cons.type !== 'ASAP' && (t.cons.type === 'ALAP' || t.cons.date));
    if (!hasDeps && !hasCons) {               // fără legături / restricții: startul introdus de mână, dar mereu într-o zi lucrătoare
      const nw = fD(nextWork(pD(t.sd))); if (nw !== t.sd) t.sd = nw;
      continue;
    }

    let bestStart = null;
    for (const d of deps) {
      const newStart = depStart(t, d, +d.lag || 0);
      if (newStart && (!bestStart || newStart > bestStart)) bestStart = newStart;
    }
    // Constrângeri: pornim de la data dată de legături (sau data curentă, dacă nu are legături)
    let s = bestStart || pD(t.sd);
    // ALAP: împinge activitatea cu rezerva calculată de CPM (doar pt. activități cu legături)
    if (bestStart && t.cons && t.cons.type === 'ALAP') s = addWorkDays(s, t._alap || 0);
    const r = _applyCons(t, s, bestStart);
    s = r.s; if (r.w) consWarn[t.id] = r.w;
    if (bestStart || hasCons) t.sd = fD(nextWork(s));
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
  const stack = [succId, ...allD(succId)], seen = new Set();   // legătura pe un capitol se aplică și activităților lui
  while (stack.length) {
    const cur = stack.pop();
    if (cur === predId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    // Toate task-urile care au cur ca predecesor (iar dacă succesorul e un capitol, și activitățile lui, care moștenesc legătura)
    T.forEach(t => {
      if ((t.deps || []).some(d => d.id === cur)) { stack.push(t.id); stack.push(...allD(t.id)); }
    });
    const me = T.find(x => x.id === cur);            // capitolul depinde de copiii lui
    if (me && me.pid != null) stack.push(me.pid);
  }
  return false;
}

// Capitolele: date din copii (_calcSummaryDates) + progres ponderat cu durata copiilor (ca în MS Project),
// nu media simplă — o activitate de 1 zi nu cântărește cât una de 30.
function recalcSummaries() {
  function calc(t) {
    const ch = kids(t.id); if (!ch.length) return;
    ch.forEach(calc);
    _calcSummaryDates(t);
    let w = 0, p = 0;
    ch.forEach(c => { const d = Math.max(1, c.dur); w += d; p += d * c.prog; });
    t.prog = Math.round(p / w);
  }
  T.filter(t => !t.pid).forEach(calc);
}

function flat() { const roots=T.filter(t=>!t.pid), r=[]; (function w(l){l.forEach(t=>{r.push(t); if(!coll.has(t.id))w(kids(t.id))})})(roots); return r; }
function wbs() { const m={}; (function w(l,p){l.forEach((t,i)=>{const n=p?p+"."+(i+1):String(i+1); m[t.id]=n; w(kids(t.id),n)})})(T.filter(t=>!t.pid),""); return m; }
// ID = numărul rândului în ordinea schemei (ca în MS Project): rămâne același și când un capitol e restrâns sau când filtrezi
function rowIds() { const m={}; let n=0; (function w(l){ l.forEach(t=>{ m[t.id]=++n; w(kids(t.id)); }); })(T.filter(t=>!t.pid)); return m; }
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
    else {
      t.assign = t.assign.filter(a => a && Number.isInteger(+a.rid)).map(a => ({ ...a, rid: +a.rid, units: Number.isFinite(+a.units) ? Math.max(0, +a.units) : 0 }));
      if (!t.assign.length) delete t.assign;
    }
    // câmpuri opționale: valorile necunoscute sau cu dată invalidă se elimină (altfel pot produce date „NaN" în tot planul)
    if (t.cons != null) {
      const c = t.cons, type = c && typeof c === 'object' ? c.type : null;
      if (!type || !CONS_LABELS[type]) delete t.cons;
      else if (CONS_NEEDS_DATE.includes(type) && !validISO(c.date)) delete t.cons;
      else { const keep = { type }; if (validISO(c.date)) keep.date = c.date; ['ac', 'lv'].forEach(k => { if (c[k]) keep[k] = true; }); if (validISO(c.o)) keep.o = c.o; t.cons = keep; }
    }
    ['deadline', 'as', 'af'].forEach(k => { if (t[k] != null && !validISO(t[k])) delete t[k]; });
    if (t.bl != null) {
      if (t.bl && validISO(t.bl.sd) && Number.isFinite(+t.bl.dur) && +t.bl.dur >= 0) {
        const nb = { sd: t.bl.sd, dur: Math.round(+t.bl.dur) };
        if (t.bl.cost !== undefined && t.bl.cost !== null && Number.isFinite(+t.bl.cost) && +t.bl.cost >= 0) nb.cost = +t.bl.cost;
        t.bl = nb;
      } else delete t.bl;
    }
    if (t.acost !== undefined && !(t.acost !== null && t.acost !== '' && Number.isFinite(+t.acost) && +t.acost >= 0)) delete t.acost; else if (t.acost !== undefined) t.acost = +t.acost;   // cost real (EVM)
    if (t.ttype != null && !['fu', 'fd', 'fw'].includes(t.ttype)) delete t.ttype;
    if (t.sn != null) t.sn = String(t.sn).slice(0, 24);
    if (t.notes != null) t.notes = String(t.notes);
    if (t.isMilestone != null) t.isMilestone = !!t.isMilestone;
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
  const hh = _histByTab[tabId];              // istoricul Ctrl+Z al proiectului (păstrat cât e pagina deschisă, la schimbarea filelor)
  _history = hh ? hh[0] : [];
  _future  = hh ? hh[1] : [];
  updateUndoRedoBtns();
}
const _histByTab = {};

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
  delete _histByTab[tab.id];                 // un proiect nou pornește fără istoric de anulare
  switchTab(tab.id);
  saveAllTabs();
  if (typeof maybeStartTour === 'function') maybeStartTour();   // prima deschidere de proiect → turul ghidat (o singură dată)
  return tab;
}

function switchTab(tabId) {
  // Salvăm datele tab-ului curent (și istoricul lui de anulare) înainte de a schimba
  syncTabData();
  if (activeTabId != null) _histByTab[activeTabId] = [_history, _future];
  activeTabId = tabId;
  loadTabData(tabId);
  renderTabsBar();
  renderAll();
  if (typeof _refreshFileUI === 'function') _refreshFileUI();
}

function closeTab(tabId, e) {
  if (e) e.stopPropagation();
  const fn = typeof fileNames !== 'undefined' && fileNames[tabId];
  customConfirm(fn ? 'Închizi proiectul? E salvat în „' + fn + '"; modificările făcute după ultima salvare (Ctrl+S) se pierd.'
                   : 'Închizi acest proiect? Nu e salvat într-un fișier: dacă nu-l salvezi (Ctrl+S), se pierde.', function() {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    tabs.splice(idx, 1); delete _histByTab[tabId];
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

let _savePending = false, _saveFailed = false;

function _saveIndicator(text, bad) {
  const sbar = $("sbar"); if (!sbar) return;
  let ind = sbar.querySelector('.save-indicator');
  if (!ind) {
    ind = document.createElement('span');
    ind.className = 'save-indicator';
    sbar.appendChild(ind);
  }
  ind.textContent = text;
  ind.classList.toggle('bad', !!bad);
}

// Scrie acum în localStorage. Returnează true dacă a reușit; la eșec (memorie plină, mod privat) avertizează vizibil, o singură dată.
function flushSave() {
  clearTimeout(_saveTimer);
  if (!_savePending) return true;
  _savePending = false;
  try {
    localStorage.setItem('ganttPRO_tabs',   JSON.stringify(tabs));
    localStorage.setItem('ganttPRO_active', String(activeTabId));
    localStorage.setItem('ganttPRO_nextId', String(nextTabId));
  } catch (e) {
    _savePending = true;
    _saveIndicator('⚠ Nu s-a putut salva în browser — salvează proiectul într-un fișier (Ctrl+S)', true);
    if (!_saveFailed) toast('⚠️ Salvarea automată în browser a eșuat (' + (e && e.name === 'QuotaExceededError' ? 'memorie plină' : 'blocată') + ') — salvează într-un fișier cu Ctrl+S');
    _saveFailed = true;
    return false;
  }
  _saveFailed = false;
  try { if (typeof fileAutoWrite === 'function') fileAutoWrite(); } catch (e) {}
  const now = new Date();
  _saveIndicator('💾 Salvat automat la ' + [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, "0")).join(':'), false);
  return true;
}

function saveAllTabs() {
  syncTabData(); // asigurăm că tab-ul curent e actualizat
  _savePending = true;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSave, 800);
}

// Dacă pagina se ascunde sau se închide în cele 800 ms de așteptare, scriem imediat (altfel ultima modificare se pierde)
addEventListener('pagehide', () => { if (_savePending) { syncTabData(); flushSave(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && _savePending) { syncTabData(); flushSave(); } });

function loadAllTabs() {
  try {
    const savedTabs   = localStorage.getItem('ganttPRO_tabs');
    const savedActive = localStorage.getItem('ganttPRO_active');
    const savedNextId = localStorage.getItem('ganttPRO_nextId');
    if (savedTabs) {
      try { tabs = JSON.parse(savedTabs); }
      catch (e) {   // date stricate: păstrăm o copie brută ca să nu le suprascriem la următoarea salvare
        try { localStorage.setItem('ganttPRO_tabs_corrupt', savedTabs); } catch (e2) {}
        tabs = []; toast('⚠️ Datele salvate în browser erau deteriorate — o copie e păstrată (ganttPRO_tabs_corrupt)');
      }
      if (!Array.isArray(tabs)) tabs = [];
      tabs.forEach(tb => { if (tb && typeof tb === 'object') tb.name = String(tb.name == null ? 'Proiect' : tb.name); });
      tabs = tabs.filter(tb => tb && typeof tb === 'object' && Array.isArray(tb.T));
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

// before (opțional): rulează după confirmare, chiar înainte de ștergere (ex. „Taie" copiază abia atunci)
function delSel(before) {
  if(!sel) return;
  const ids=selIds(), roots=ids.filter(id=>!ids.some(o=>o!==id&&isD(id,o)));   // un rând din interiorul unui capitol selectat pleacă oricum cu el
  if(filterActive() && view==='gantt' && roots.some(hasK)) { toast('🔎 Oprește filtrul ca să ștergi un capitol (ar șterge și rândurile ascunse)'); return; }
  if((roots.length>1 || hasK(roots[0])) && !delSel._ok) {     // un capitol sau mai multe rânduri: confirmare
    const inner=roots.reduce((s,id)=>s+allD(id).length,0), t=T.find(x=>x.id===roots[0]);
    const msg = roots.length===1
      ? 'Ștergi capitolul „'+t.nm+'" și '+(inner===1?'activitatea':'cele '+inner+' activități')+' din el? Poți anula cu Ctrl+Z.'
      : 'Ștergi cele '+roots.length+' rânduri selectate'+(inner?' (și '+(inner===1?'o activitate':inner+' activități')+' din capitolele lor)':'')+'? Poți anula cu Ctrl+Z.';
    const keep=[sel,new Set(msel),_selAnchor];
    customConfirm(msg, ()=>{ [sel,msel,_selAnchor]=keep; delSel._ok=true; try { delSel(before); } finally { delSel._ok=false; } });
    return;
  }
  if(typeof before==='function') before();
  pushHistory();
  const rm=new Set();
  roots.forEach(id=>{ rm.add(id); allD(id).forEach(x=>{ rm.add(x); coll.delete(x); }); });
  // Curățăm referințele de dependență către task-urile șterse
  T.forEach(t => { if (t.deps) t.deps = t.deps.filter(x => !rm.has(x.id)); });
  T=T.filter(t=>!rm.has(t.id)); sel=null; clearMulti();
  syncTabData(); renderAll();
  if(rm.size>1 && !before) toast('🗑 Șterse: '+rm.size+' rânduri');
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
    const msg = moveStartTo(t, v);                 // startul nou mută activitatea; durata rămâne
    syncTabData(); renderAll();
    if (t.sd !== fD(nextWork(pD(v)))) toast('ℹ️ Startul rămâne ' + fmtDate(pD(t.sd)) + ': îl dictează legăturile sau o restricție');
    else if (msg) toast(msg);
    return;
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

// Rândurile selectate fără cele aflate în interiorul unui capitol selectat (acelea se mută oricum cu el)
const selRoots = () => { const ids=selIds(); return ids.filter(id=>!ids.some(o=>o!==id&&isD(id,o))); };
// Indent / outdent pe mai multe rânduri: un singur pas de anulare; rândurile se mută pe rând, de sus în jos (ca în MS Project)
function _multiStruct(one, msg) {
  const roots=selRoots(); if(roots.length<2) return false;
  if(structLocked()) return true;
  pushHistory();
  let n=0;
  const ok=_tryHierarchyChange(()=>{ roots.forEach(id=>{ if(one(T.find(x=>x.id===id))) n++; }); });
  if(!ok||!n){ _history.pop(); updateUndoRedoBtns(); renderAll(); if(ok) toast('ℹ️ Rândurile selectate nu se pot muta așa'); return true; }
  syncTabData(); renderAll(); toast(msg+' ('+n+' rânduri)');
  return true;
}
function indentSel() {
  if(!sel) return;
  if(_multiStruct(t=>{ const sibs=t.pid?kids(t.pid):T.filter(x=>!x.pid), i=sibs.findIndex(s=>s.id===t.id); if(i<=0) return false; t.pid=sibs[i-1].id; coll.delete(t.pid); return true; }, 'Subcapitol')) return;
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
  if(_multiStruct(t=>{ if(!t.pid) return false; const par=T.find(y=>y.id===t.pid); t.pid=par?par.pid:null; return true; }, 'Scos un nivel')) return;
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

// Inserează rânduri imediat după blocul unui rând (rândul + tot ce conține); fără ancoră → la final
function insertAfterBlock(rows, anchorId) {
  if (anchorId == null || !T.some(t => t.id === anchorId)) { T.push(...rows); return; }
  const block = [anchorId, ...allD(anchorId)], last = Math.max(...block.map(id => T.findIndex(x => x.id === id)));
  T.splice(last + 1, 0, ...rows);
}

function toggleC(id) { if(coll.has(id)) coll.delete(id); else coll.add(id); renderAll(); }
// ---- Selecție: click = un rând (al doilea click îl deselectează); Ctrl+click = adaugă / scoate; Shift+click = interval (ca în MS Project) ----
// `sel` = rândul activ (Detalii, tastatură, fila Format); `msel` = toate rândurile selectate, valabilă doar cât îl conține pe `sel`
// (orice cod care schimbă doar `sel` revine astfel singur la selecția simplă).
let msel = new Set(), _selAnchor = null;
const _multiOn = () => sel != null && msel.size > 1 && msel.has(sel);
function selIds() {
  if (sel == null) return [];
  if (!_multiOn()) return [sel];
  const ord = rowIds();
  return [...msel].filter(id => ord[id]).sort((a, b) => ord[a] - ord[b]);
}
const isSelId = id => id === sel || (_multiOn() && msel.has(id));
function clearMulti() { msel = new Set(); }
function selTask(id, e) {
  if (e && (e.ctrlKey || e.metaKey)) {
    const cur = new Set(selIds());
    if (cur.has(id)) { cur.delete(id); if (sel === id) sel = cur.size ? [...cur].pop() : null; _selAnchor = sel; }
    else { cur.add(id); sel = id; _selAnchor = id; }
    msel = cur;
  } else if (e && e.shiftKey && (_selAnchor ?? sel) != null) {
    const o = viewRows().map(t => t.id), a = o.indexOf(_selAnchor ?? sel), b = o.indexOf(id);
    if (a < 0 || b < 0) { sel = id; clearMulti(); _selAnchor = id; }
    else { msel = new Set(o.slice(Math.min(a, b), Math.max(a, b) + 1)); sel = id; }
    try { window.getSelection().removeAllRanges(); } catch (x) {}
  } else {
    sel = (sel === id && !_multiOn()) ? null : id; clearMulti(); _selAnchor = sel;
  }
  refreshSelection(); if(typeof closeCtx==='function') closeCtx();
}

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
  T.forEach(t => { if (!hasK(t.id)) t.bl = { sd: t.sd, dur: t.dur, cost: Math.round((costMap[t.id] || 0) * 100) / 100 }; });
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
  D(3).acost = Math.round((costMap[D(3).id] || 0) * 1.12);                         // cost real puțin peste buget (pentru valoarea realizată / EVM)
  D(4).acost = Math.round((costMap[D(4).id] || 0) * 0.97);
  D(7).acost = Math.round((costMap[D(7).id] || 0) * 0.5 * 1.15);
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
