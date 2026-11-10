// ============================================================
// FILTRE — arată doar activitățile care te interesează (același set de rânduri în tabel și în Gantt)
// ============================================================
// FILTER.type: all | crit | late | open | wip | todo | done | ms | warn | res | range
// FILTER.text: „numele conține" (fără diacritice, fără majuscule). Se combină cu tipul (ȘI).
// Un capitol apare dacă are cel puțin o activitate care se potrivește; dacă numele LUI se potrivește textului, apare cu tot ce conține.
// Filtrul nu schimbă datele și nu se salvează; se oprește la schimbarea proiectului.
const FILTER = { type: 'all', rid: null, from: '', to: '', text: '' };
const FILTER_LABELS = {
  all: 'Toate activitățile', crit: 'Drum critic', late: 'Întârziate', open: 'Nefinalizate', wip: 'În lucru',
  todo: 'Nepornite', done: 'Finalizate', ms: 'Repere', warn: 'Cu avertismente', res: 'După resursă', range: 'Interval de date'
};

const filterActive = () => FILTER.type !== 'all' || !!FILTER.text.trim();
const _normTxt = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function describeFilter() {
  const parts = [];
  if (FILTER.type !== 'all') {
    let l = FILTER_LABELS[FILTER.type] || FILTER.type;
    if (FILTER.type === 'res') { const r = resById(FILTER.rid); l = 'Resursa „' + (r ? r.name : '?') + '”'; }
    if (FILTER.type === 'range') l = 'Între ' + (FILTER.from ? fmtDate(pD(FILTER.from)) : '…') + ' și ' + (FILTER.to ? fmtDate(pD(FILTER.to)) : '…');
    parts.push(l);
  }
  if (FILTER.text.trim()) parts.push('numele conține „' + FILTER.text.trim() + '”');
  return parts.join(' · ');
}

// Se potrivește tipul de filtru? (doar pentru activități și repere, nu pentru capitole)
function _typeOk(t) {
  switch (FILTER.type) {
    case 'all': return true;
    case 'crit': return !!(cpm[t.id] && cpm[t.id].crit);
    case 'late': return isBehind(t);
    case 'open': return t.prog < 100;
    case 'wip': return t.prog > 0 && t.prog < 100;
    case 'todo': return t.prog <= 0;
    case 'done': return t.prog >= 100;
    case 'ms': return !!t.isMilestone;
    case 'warn': return !!taskWarn[t.id];
    case 'res': return (t.assign || []).some(a => a.rid === FILTER.rid);
    case 'range': {
      const s = pD(t.sd), e = endDate(t);
      return (!FILTER.from || e >= pD(FILTER.from)) && (!FILTER.to || s <= pD(FILTER.to));
    }
  }
  return true;
}

// ============================================================
// GRUPARE (ca View › Group by din MS Project): activitățile (fără capitole) apar sub titluri de grup cu subtotaluri.
// Se combină cu filtrul; nu schimbă datele; structura (mutări / indentări) e blocată cât e pornită, ca la filtru.
// ============================================================
const GROUP = { by: null, coll: new Set() };
const GROUP_LABELS = { crit: 'Critic / cu rezervă', status: 'Stare', res: 'Resurse', chap: 'Capitol', month: 'Luna de start', ms: 'Repere / activități' };
const _MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const groupActive = () => !!GROUP.by && !!GROUP_LABELS[GROUP.by];
// Cheia, eticheta și ordinea grupului unei activități
function _groupOf(t, ids) {
  switch (GROUP.by) {
    case 'crit': return cpm[t.id] && cpm[t.id].crit ? { k: 'c', l: 'Pe drumul critic', o: 0 } : { k: 'n', l: 'Cu rezervă', o: 1 };
    case 'status': {
      const s = _statusOf(t), ord = { late: 0, wip: 1, todo: 2, done: 3 };
      const l = s.k === 'todo' ? 'Nepornite' : s.k === 'late' ? 'Întârziate' : s.k === 'wip' ? 'În lucru' : 'Finalizate';
      return { k: s.k, l, o: ord[s.k] ?? 9 };
    }
    case 'res': {
      const n = [...new Set((t.assign || []).map(a => resById(a.rid)).filter(Boolean).map(r => r.name))].sort((a, b) => a.localeCompare(b, 'ro'));
      return n.length ? { k: 'r:' + JSON.stringify(n), l: n.join(', '), o: 1, s: n.join(', ') } : { k: 'r:', l: 'Fără resurse', o: 2 };
    }
    case 'chap': {
      let top = t; for (let n = 0; top.pid != null && n < 1000; n++) { const p = taskById(top.pid); if (!p) break; top = p; }
      return top === t ? { k: 'c:', l: 'Fără capitol', o: 1e9 } : { k: 'c:' + top.id, l: top.nm, o: ids[top.id] || 0 };
    }
    case 'month': { const d = pD(t.sd); return { k: 'm:' + t.sd.slice(0, 7), l: _MONTHS[d.getMonth()] + ' ' + d.getFullYear(), o: +t.sd.slice(0, 7).replace('-', '') }; }
    case 'ms': return t.isMilestone ? { k: 'ms', l: 'Repere', o: 0 } : { k: 'ta', l: 'Activități', o: 1 };
  }
  return { k: '', l: '', o: 0 };
}
// Grupurile, în ordine, cu activitățile lor (după filtru) și subtotalurile
function _groups() {
  const ids = rowIds(), base = filterActive() ? _filteredRows() : _allRows();
  const m = new Map();
  base.filter(t => !hasK(t.id)).forEach(t => {
    const g = _groupOf(t, ids);
    if (!m.has(g.k)) m.set(g.k, { ...g, tasks: [] });
    m.get(g.k).tasks.push(t);
  });
  const list = [...m.values()].sort((a, b) => a.o - b.o || String(a.s || a.l).localeCompare(String(b.s || b.l), 'ro'));
  list.forEach((g, i) => {
    const L = g.tasks, s = L.map(t => pD(t.sd)), e = L.map(endDate);
    const mn = new Date(Math.min(...s)), mx = new Date(Math.max(...e)), dsum = L.reduce((a, t) => a + (t.isMilestone ? 0 : Math.max(1, t.dur)), 0);
    Object.assign(g, {
      _grp: true, id: -(i + 1), nm: g.l, n: L.length, sd: fD(mn), dur: workDur(mn, mx), deps: [],
      prog: dsum ? Math.round(L.reduce((a, t) => a + (t.isMilestone ? 0 : Math.max(1, t.dur)) * (t.prog || 0), 0) / dsum) : (L.every(t => t.prog >= 100) ? 100 : 0),
      cost: L.reduce((a, t) => a + ((typeof costMap !== 'undefined' && costMap[t.id]) || 0), 0),
      crit: L.some(t => cpm[t.id] && cpm[t.id].crit), closed: GROUP.coll.has(g.k)
    });
  });
  return list;
}
// Rândurile din tabel și din Gantt: titlurile grupurilor + activitățile din grupurile deschise
function viewList() {
  if (!groupActive()) return viewRows();
  const out = [];
  _groups().forEach(g => { out.push(g); if (!g.closed) out.push(...g.tasks); });
  return out;
}
function setGroup(by) {
  if (!tabs.length) return;
  GROUP.by = GROUP_LABELS[by] ? by : null; GROUP.coll.clear();
  sel = null; renderAll();
  toast(GROUP.by ? '🗂 Grupat după: ' + GROUP_LABELS[GROUP.by] + ' — ' + _groups().length + ' grupuri · structura e blocată cât e pornită gruparea' : 'Grupare oprită');
}
function toggleGroupRow(k) {
  if (GROUP.coll.has(k)) GROUP.coll.delete(k);
  else {                                            // grupul se închide: rândurile lui ascunse ies din selecție (Delete / Leagă să nu lucreze pe nevăzute)
    GROUP.coll.add(k);
    const g = _groups().find(x => x.k === k), hid = new Set(g ? g.tasks.map(t => t.id) : []);
    if (sel != null && hid.has(sel)) sel = null;
    hid.forEach(id => msel.delete(id));
  }
  renderAll();
}

// Toate activitățile, în ordinea schemei (ignoră capitolele închise: în grupare, capitolele nu se văd)
function _allRows() { const out = []; (function w(l) { l.forEach(t => { out.push(t); w(kids(t.id)); }); })(T.filter(t => !t.pid)); return out; }

// Rândurile afișate (în ordinea ierarhiei). Fără filtru = exact flat() (respectă capitolele închise).
// Cu grupare: doar activitățile din grupurile deschise, în ordinea grupurilor (ce poți selecta / parcurge cu săgețile).
function viewRows() {
  if (groupActive()) { const out = []; _groups().forEach(g => { if (!g.closed) out.push(...g.tasks); }); return out; }
  if (!filterActive()) return flat();
  return _filteredRows();
}
function _filteredRows() {
  const byId = new Map(T.map(t => [t.id, t])), q = _normTxt(FILTER.text.trim()), keep = new Set();
  const textOk = t => {
    if (!q) return true;
    for (let c = t, n = 0; c && n < 1000; n++, c = c.pid == null ? null : byId.get(c.pid)) if (_normTxt(c.nm).includes(q)) return true;
    return false;
  };
  T.forEach(t => {
    if (hasK(t.id) || !_typeOk(t) || !textOk(t)) return;
    for (let c = t, n = 0; c && !keep.has(c.id) && n < 1000; n++, c = c.pid == null ? null : byId.get(c.pid)) keep.add(c.id);
    keep.add(t.id);
  });
  const out = [];
  (function w(list) { list.forEach(t => { if (!keep.has(t.id)) return; out.push(t); w(kids(t.id)); }); })(T.filter(t => !t.pid));
  return out;
}

// ----- acțiuni -----
function setFilter(type, rid) {
  if (!tabs.length) return;
  FILTER.type = FILTER_LABELS[type] ? type : 'all';
  if (type === 'res') FILTER.rid = +rid;
  if (type !== 'range') { FILTER.from = ''; FILTER.to = ''; }
  sel = null;
  renderAll();
  if (filterActive()) toast('🔎 Filtru: ' + describeFilter() + ' — ' + viewRows().length + ' rânduri');
}

let _flTimer = null;
function setFilterTextDebounced(v) { clearTimeout(_flTimer); _flTimer = setTimeout(() => { FILTER.text = v; renderAll(); }, 150); }

function clearFilter(silent) {
  const was = filterActive();
  FILTER.type = 'all'; FILTER.rid = null; FILTER.from = ''; FILTER.to = ''; FILTER.text = '';
  const el = $('flText'); if (el) el.value = '';
  if (silent) { GROUP.by = null; GROUP.coll.clear(); return was; }   // la schimbarea proiectului se opresc și filtrul, și gruparea
  renderAll();
  if (was) toast('Filtru oprit');
  return was;
}

// Când schimbi structura (mută / indentează / trage rânduri) cu un filtru pornit, rândurile ascunse ar fi mutate „pe nevăzute"
function structLocked() {
  if (view === 'tree' || view === 'timeline' || !(filterActive() || groupActive())) return false;   // și în Calendar / Rețea / Echipe (folosesc filtrul)
  toast(groupActive() ? '🗂 Oprește gruparea ca să muți rânduri sau să schimbi structura' : '🔎 Oprește filtrul ca să muți rânduri sau să schimbi structura');
  return true;
}

// Dacă adaugi / lipești ceva cu filtru (sau grupare) pornit, îl oprim ca să vezi rezultatul
function stopFilterForEdit() {
  if (groupActive()) { GROUP.by = null; GROUP.coll.clear(); toast('🗂 Grupare oprită ca să vezi ce adaugi'); }
  if (filterActive()) { clearFilter(); toast('🔎 Filtru oprit ca să vezi ce adaugi'); }
}

// ----- fereastra „Filtre" -----
function openFilterModal() {
  if (!tabs.length) return;
  $('flType').innerHTML = Object.keys(FILTER_LABELS).map(k => '<option value="' + k + '"' + (FILTER.type === k ? ' selected' : '') + '>' + FILTER_LABELS[k] + '</option>').join('');
  const work = RES.list.filter(r => r.type !== 'cost');
  $('flRes').innerHTML = work.length ? work.map(r => '<option value="' + r.id + '"' + (FILTER.rid === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') : '<option value="">(nu ai resurse)</option>';
  dtSet('flFrom', FILTER.from); dtSet('flTo', FILTER.to);
  $('flName').value = FILTER.text;
  _flToggle();
  $('filterModal').classList.add('open');
  setTimeout(() => $('flName').focus(), 50);
}
function _flToggle() {
  const t = $('flType').value;
  $('flResRow').style.display = t === 'res' ? '' : 'none';
  $('flRangeRow').style.display = t === 'range' ? '' : 'none';
}
function closeFilterModal() { $('filterModal').classList.remove('open'); }
function applyFilterModal() {
  const type = $('flType').value;
  if (type === 'res' && !$('flRes').value) { toast('⚠️ Nu ai nicio resursă de filtrat'); return; }
  const from = $('flFrom').value, to = $('flTo').value;
  if (type === 'range' && from && to && from > to) { toast('⚠️ „De la” e după „Până la”'); return; }
  FILTER.type = type; FILTER.rid = type === 'res' ? +$('flRes').value : null;
  FILTER.from = type === 'range' ? from : ''; FILTER.to = type === 'range' ? to : '';
  FILTER.text = $('flName').value.trim();
  const el = $('flText'); if (el) el.value = FILTER.text;
  closeFilterModal(); sel = null; renderAll();
  toast(filterActive() ? '🔎 Filtru: ' + describeFilter() + ' — ' + viewRows().length + ' rânduri' : 'Filtru oprit');
}

// ----- indicatorii din interfață (apelat la finalul lui renderAll) -----
function updateFilterUI() {
  const on = filterActive(), bar = $('filterBar');
  const b = $('btnFilter'); if (b) b.classList.toggle('active', on || groupActive());
  const lb = $('btnFilterLbl'); if (lb) lb.textContent = FILTER.type !== 'all' ? FILTER_LABELS[FILTER.type] : 'Filtru';
  const el = $('flText'); if (el && document.activeElement !== el && el.value !== FILTER.text) el.value = FILTER.text;
  document.querySelectorAll('#filterMenu button[data-f]').forEach(x => x.classList.toggle('on', x.dataset.f === FILTER.type));
  const g = groupActive(), gb = $('btnGroup'); if (gb) gb.classList.toggle('active', g);
  document.querySelectorAll('#groupMenu button[data-g]').forEach(x => x.classList.toggle('on', (x.dataset.g || null) === (GROUP.by || null) || (!x.dataset.g && !g)));
  if (!bar) return;
  if (!(on || g) || !(view === 'gantt' || (typeof XVIEWS !== 'undefined' && XVIEWS[view])) || !tabs.length) { bar.style.display = 'none'; return; }   // bara se vede și în vederile care folosesc filtrul
  const parts = [];
  if (on) parts.push('🔎 Filtru activ: <b>' + esc(describeFilter()) + '</b> — se arată ' + viewRows().length + ' din ' + T.length + ' rânduri');
  if (g) parts.push('🗂 Grupat după: <b>' + esc(GROUP_LABELS[GROUP.by]) + '</b>');
  $('filterBarTxt').innerHTML = parts.join(' &nbsp;·&nbsp; ');
  const fb = $('filterBarFilterBtns'), gbb = $('filterBarGroupBtn');
  if (fb) fb.style.display = on ? '' : 'none'; if (gbb) gbb.style.display = g ? '' : 'none';
  bar.style.display = 'flex';
}

document.addEventListener('keydown', e => {
  const m = $('filterModal'); if (!m || !m.classList.contains('open')) return;
  if (e.key === 'Escape') closeFilterModal();
  else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); applyFilterModal(); }
});
