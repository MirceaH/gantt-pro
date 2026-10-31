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

// Rândurile afișate (în ordinea ierarhiei). Fără filtru = exact flat() (respectă capitolele închise).
function viewRows() {
  if (!filterActive()) return flat();
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
  if (silent) return was;
  renderAll();
  if (was) toast('Filtru oprit');
  return was;
}

// Când schimbi structura (mută / indentează / trage rânduri) cu un filtru pornit, rândurile ascunse ar fi mutate „pe nevăzute"
function structLocked() {
  if (view !== 'gantt' || !filterActive()) return false;
  toast('🔎 Oprește filtrul ca să muți rânduri sau să schimbi structura');
  return true;
}

// Dacă adaugi / lipești ceva cu filtru pornit, îl oprim ca să vezi rezultatul
function stopFilterForEdit() {
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
  const b = $('btnFilter'); if (b) b.classList.toggle('active', on);
  const lb = $('btnFilterLbl'); if (lb) lb.textContent = FILTER.type !== 'all' ? FILTER_LABELS[FILTER.type] : 'Filtru';
  const el = $('flText'); if (el && document.activeElement !== el && el.value !== FILTER.text) el.value = FILTER.text;
  document.querySelectorAll('#filterMenu button[data-f]').forEach(x => x.classList.toggle('on', x.dataset.f === FILTER.type));
  if (!bar) return;
  if (!on || view !== 'gantt' || !tabs.length) { bar.style.display = 'none'; return; }
  const shown = viewRows().length;
  $('filterBarTxt').innerHTML = '🔎 Filtru activ: <b>' + esc(describeFilter()) + '</b> — se arată ' + shown + ' din ' + T.length + ' rânduri';
  bar.style.display = 'flex';
}

document.addEventListener('keydown', e => {
  const m = $('filterModal'); if (!m || !m.classList.contains('open')) return;
  if (e.key === 'Escape') closeFilterModal();
  else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); applyFilterModal(); }
});
