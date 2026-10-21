// ============================================================
// RESURSE, COSTURI și SUPRA-ALOCARE
// ============================================================
// RES.list = [{ id, name, type:'work'|'material'|'cost', rate, max, unit }]
//   work     = oameni / utilaje; rate = cost pe oră; max = capacitate în % (100 = 1 persoană, 500 = echipă de 5)
//   material = consumabile;     rate = preț pe unitate; unit = unitatea (m³, kg…)
//   cost     = sumă fixă (taxe, avize); nu are tarif
// t.assign = [{ rid, units }]   units: % (work), cantitate (material), sumă (cost)
// t.ttype  = 'fd' (durată fixă) | 'fw' (muncă fixă) | lipsă = unități fixe (implicit)
let RES = { list: [], next: 1, cur: 'RON' };

function setRes(r) {
  const list = r && Array.isArray(r.list) ? r.list.map(x => ({ ...x })) : [];
  RES = { list, next: Math.max((r && r.next) || 1, ...list.map(x => x.id + 1), 1), cur: (r && r.cur) || 'RON' };
}

const RES_TYPES = { work: 'Muncă', material: 'Material', cost: 'Cost fix' };
const TASK_TYPES = { fu: 'Unități fixe (implicit)', fd: 'Durată fixă', fw: 'Muncă fixă' };
const resById = id => RES.list.find(r => r.id === id);

function resUnitLabel(r) { return !r ? '' : r.type === 'work' ? '%' : r.type === 'material' ? (r.unit || 'buc') : RES.cur; }
function fmtMoney(v) { return Math.round(v).toLocaleString('ro-RO') + ' ' + RES.cur; }

// ----- calcule -----
const assignHours = (t, a) => Math.max(1, t.dur) * 8 * (a.units || 0) / 100;

function assignCost(t, a) {
  const r = resById(a.rid); if (!r || t.isMilestone) return 0;
  if (r.type === 'work') return assignHours(t, a) * (r.rate || 0);
  if (r.type === 'material') return (a.units || 0) * (r.rate || 0);
  return +a.units || 0;
}

let costMap = {};   // id -> cost total (la capitole: suma copiilor); costMap.total = costul proiectului
let loadMap = {};   // rid -> { days:{'YYYY-MM-DD':%}, max, peak, over:[ 'YYYY-MM-DD'… ] }
let resWarn = {};   // taskId -> [ 'Nume (pic 250% > 200%)' ]
const byResCost = {}; // rid -> cost total

function computeResources() {
  costMap = {}; loadMap = {}; resWarn = {};
  Object.keys(byResCost).forEach(k => delete byResCost[k]);
  let total = 0;
  T.forEach(t => {
    if (hasK(t.id)) return;
    const c = (t.assign || []).reduce((s, a) => {
      const v = assignCost(t, a);
      if (v) byResCost[a.rid] = (byResCost[a.rid] || 0) + v;
      return s + v;
    }, 0);
    costMap[t.id] = c; total += c;
    let p = t.pid; while (p) { costMap[p] = (costMap[p] || 0) + c; const par = T.find(x => x.id === p); p = par ? par.pid : null; }
  });
  costMap.total = total;

  // încărcarea pe zile a resurselor de tip „muncă"
  RES.list.filter(r => r.type === 'work').forEach(r => { loadMap[r.id] = { days: {}, max: r.max || 100, peak: 0, over: [] }; });
  T.forEach(t => {
    if (hasK(t.id) || t.isMilestone) return;
    (t.assign || []).forEach(a => {
      const L = loadMap[a.rid]; if (!L) return;
      const end = endDate(t);
      for (let d = pD(t.sd); d <= end; d = aD(d, 1)) {
        if (!isWork(d)) continue;
        const k = fD(d); L.days[k] = (L.days[k] || 0) + (a.units || 0);
      }
    });
  });
  Object.keys(loadMap).forEach(rid => {
    const L = loadMap[rid], r = resById(+rid);
    Object.entries(L.days).forEach(([k, v]) => { if (v > L.peak) L.peak = v; if (v > L.max + 0.01) L.over.push(k); });
    if (!L.over.length) return;
    const over = new Set(L.over);
    T.forEach(t => {
      if (hasK(t.id) || t.isMilestone || !(t.assign || []).some(a => a.rid === +rid)) return;
      const end = endDate(t);
      for (let d = pD(t.sd); d <= end; d = aD(d, 1)) {
        if (over.has(fD(d))) { (resWarn[t.id] = resWarn[t.id] || []).push(`${r.name} (pic ${Math.round(L.peak)}% > ${L.max}%)`); break; }
      }
    });
  });
}

const taskCostOf = id => costMap[id] || 0;

// Text pentru bara de informații: cost + resurse
function resText(t) {
  const a = (t.assign || []).filter(x => resById(x.rid));
  const c = costMap[t.id] || 0;
  if (!a.length && !c) return '';
  const names = a.map(x => { const r = resById(x.rid); return `${esc(r.name)} <b>${r.type === 'cost' ? fmtMoney(x.units) : x.units + (r.type === 'work' ? '%' : ' ' + (r.unit || ''))}</b>`; }).join(', ');
  return ` · <span class="gi-lbl">Cost:</span> <b>${fmtMoney(c)}</b>${names ? ' · <span class="gi-lbl">Resurse:</span> ' + names : ''}`;
}

// Tip activitate (unități fixe / durată fixă / muncă fixă) aplicat după editarea duratei sau a resurselor
function applyTaskType(t, oldDur, oldAssign) {
  if (t.ttype !== 'fw') return;
  const isWork = a => { const r = resById(a.rid); return r && r.type === 'work'; };
  const oldWork = (oldAssign || []).filter(isWork).reduce((s, a) => s + Math.max(1, oldDur) * 8 * (a.units || 0) / 100, 0);
  if (oldWork <= 0) return;
  const cur = (t.assign || []).filter(isWork);
  const newUnits = cur.reduce((s, a) => s + (a.units || 0), 0);
  const oldUnits = (oldAssign || []).filter(isWork).reduce((s, a) => s + (a.units || 0), 0);
  if (newUnits !== oldUnits && newUnits > 0) t.dur = Math.max(1, Math.ceil(oldWork / (8 * newUnits / 100)));          // alte unități → altă durată
  else if (t.dur !== oldDur && t.dur > 0) cur.forEach(a => { a.units = Math.max(1, Math.round(a.units * oldDur / t.dur)); }); // altă durată → alte unități
}

// ============================================================
// Editorul de resurse atribuite din „Task Info"
// ============================================================
let _tiAssign = [], _tiOld = { dur: 1, assign: [] }, _tiTaskId = null;

function tiRenderAssign() {
  const box = $('tiAssign'); if (!box) return;
  if (!RES.list.length) {
    box.innerHTML = '<div class="ti-res-empty">Nu ai resurse definite. Apasă „Gestionează resursele" ca să adaugi oameni, utilaje sau materiale.</div>';
    tiRenderCost(); return;
  }
  box.innerHTML = _tiAssign.map((a, i) => {
    const r = resById(a.rid);
    const opts = RES.list.map(x => `<option value="${x.id}" ${x.id === a.rid ? 'selected' : ''}>${esc(x.name)} (${RES_TYPES[x.type]})</option>`).join('');
    return `<div class="ti-res-row">
      <select onchange="tiSetRes(${i},this.value)">${opts}</select>
      <input type="number" min="0" step="${r && r.type === 'work' ? 25 : 1}" value="${a.units}" onchange="tiSetUnits(${i},this.value)">
      <span class="ti-res-unit">${esc(resUnitLabel(r))}</span>
      <button type="button" class="ti-res-del" onclick="tiDelAssign(${i})" title="Scoate resursa">✕</button></div>`;
  }).join('') || '<div class="ti-res-empty">Nicio resursă atribuită.</div>';
  tiRenderCost();
}

function tiAddAssign() {
  if (!RES.list.length) { openResources('res'); return; }
  const used = new Set(_tiAssign.map(a => a.rid));
  const r = RES.list.find(x => !used.has(x.id)) || RES.list[0];
  _tiAssign.push({ rid: r.id, units: r.type === 'work' ? 100 : (r.type === 'material' ? 1 : 0) });
  tiRenderAssign();
}
function tiSetRes(i, v) { _tiAssign[i].rid = +v; const r = resById(+v); if (r && r.type === 'work' && !_tiAssign[i].units) _tiAssign[i].units = 100; tiRenderAssign(); }
function tiSetUnits(i, v) { _tiAssign[i].units = Math.max(0, +v || 0); tiRenderCost(); }
function tiDelAssign(i) { _tiAssign.splice(i, 1); tiRenderAssign(); }

function tiRenderCost() {
  const el = $('tiCost'); if (!el) return;
  const t = T.find(x => x.id === _tiTaskId); if (!t) return;
  const durEl = $('tiDur'), dur = durEl && +durEl.value >= 1 ? +durEl.value : t.dur;
  const tmp = { dur, isMilestone: t.isMilestone };
  const c = _tiAssign.reduce((s, a) => s + assignCost(tmp, a), 0);
  const h = _tiAssign.reduce((s, a) => { const r = resById(a.rid); return s + (r && r.type === 'work' ? assignHours(tmp, a) : 0); }, 0);
  el.innerHTML = c || h ? `Cost: <b>${fmtMoney(c)}</b>${h ? ` · Muncă: <b>${Math.round(h)} ore</b>` : ''}` : '';
}

// ============================================================
// Fereastra „Resurse și buget": foaie de resurse • încărcare • buget
// ============================================================
let _resTab = 'res';

function openResources(tab) {
  _resTab = tab || 'res';
  $('resModal').classList.add('open');
  renderResModal();
}
function closeResources() {
  $('resModal').classList.remove('open');
  if ($('taskInfoModal') && $('taskInfoModal').classList.contains('open')) tiRenderAssign();
}
function resTab(t) { _resTab = t; renderResModal(); }

function _resCommit() { syncTabData(); renderAll(); renderResModal(); }

function resAdd(type) {
  const names = { work: 'Resursă nouă', material: 'Material nou', cost: 'Cost nou' };
  RES.list.push({ id: RES.next++, name: names[type], type, rate: 0, max: type === 'work' ? 100 : null, unit: type === 'material' ? 'buc' : '' });
  _resCommit();
}
function resEdit(id, field, val) {
  const r = resById(id); if (!r) return;
  if (field === 'rate' || field === 'max') r[field] = Math.max(0, +val || 0);
  else if (field === 'type') { r.type = val; r.max = val === 'work' ? (r.max || 100) : null; }
  else r[field] = String(val).trim() || r[field];
  _resCommit();
}
function resDel(id) {
  const r = resById(id); if (!r) return;
  customConfirm('Ștergi resursa „' + r.name + '”? Va fi scoasă din toate activitățile.', () => {
    pushHistory();
    RES.list = RES.list.filter(x => x.id !== id);
    T.forEach(t => { if (t.assign) { t.assign = t.assign.filter(a => a.rid !== id); if (!t.assign.length) delete t.assign; } });
    _resCommit();
  });
}
function resSetCur(v) { RES.cur = String(v).trim() || 'RON'; _resCommit(); }

function renderResModal() {
  const tabs = [['res', '👥 Resurse'], ['load', '📊 Încărcare'], ['budget', '💰 Buget']];
  $('resTabs').innerHTML = tabs.map(([k, l]) => `<button class="${_resTab === k ? 'active' : ''}" onclick="resTab('${k}')">${l}</button>`).join('');
  $('resBody').innerHTML = _resTab === 'res' ? _resSheetHtml() : _resTab === 'load' ? _resLoadHtml() : _resBudgetHtml();
}

function _resSheetHtml() {
  const rows = RES.list.map(r => {
    const rateLbl = r.type === 'work' ? RES.cur + '/oră' : r.type === 'material' ? RES.cur + '/' + (r.unit || 'unit.') : '—';
    return `<tr>
      <td><input value="${esc(r.name)}" onchange="resEdit(${r.id},'name',this.value)"></td>
      <td><select onchange="resEdit(${r.id},'type',this.value)">${Object.keys(RES_TYPES).map(k => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${RES_TYPES[k]}</option>`).join('')}</select></td>
      <td>${r.type === 'cost' ? '<span class="res-na">—</span>' : `<input type="number" min="0" step="any" value="${r.rate || 0}" onchange="resEdit(${r.id},'rate',this.value)"> <small>${esc(rateLbl)}</small>`}</td>
      <td>${r.type === 'work' ? `<input type="number" min="25" step="25" value="${r.max || 100}" onchange="resEdit(${r.id},'max',this.value)"> <small>%</small>` : '<span class="res-na">—</span>'}</td>
      <td>${r.type === 'material' ? `<input style="width:70px" value="${esc(r.unit || '')}" onchange="resEdit(${r.id},'unit',this.value)">` : '<span class="res-na">—</span>'}</td>
      <td class="res-num">${byResCost[r.id] ? fmtMoney(byResCost[r.id]) : '—'}</td>
      <td><button class="ti-res-del" onclick="resDel(${r.id})" title="Șterge resursa">✕</button></td></tr>`;
  }).join('');
  return `<div class="res-top">
      <span>Monedă: <input class="res-cur" value="${esc(RES.cur)}" onchange="resSetCur(this.value)"></span>
      <span class="res-spacer"></span>
      <button class="modal-btn primary" onclick="resAdd('work')">＋ Muncă</button>
      <button class="modal-btn primary" onclick="resAdd('material')">＋ Material</button>
      <button class="modal-btn primary" onclick="resAdd('cost')">＋ Cost fix</button></div>
    ${RES.list.length ? `<table class="res-table"><thead><tr><th>Nume</th><th>Tip</th><th>Tarif</th><th>Capacitate max</th><th>Unitate</th><th>Cost total</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="res-empty">Nu ai nicio resursă. Adaugă oameni sau utilaje („Muncă"), materiale sau costuri fixe (taxe, avize).</div>'}
    <div class="res-help"><b>Muncă</b>: oameni/utilaje, cost pe oră; capacitatea 100% = o persoană, 500% = o echipă de 5. Se atribuie în „Task Info" cu un procent din timp (Muncă = Durată × Unități × 8 h/zi).<br>
    <b>Material</b>: cantitate × preț pe unitate. <b>Cost fix</b>: o sumă (taxă, aviz).</div>`;
}

function _resLoadHtml() {
  const work = RES.list.filter(r => r.type === 'work');
  if (!work.length) return '<div class="res-empty">Adaugă resurse de tip „Muncă" și atribuie-le activităților ca să vezi încărcarea lor în timp.</div>';
  const b = ab(); if (!b) return '<div class="res-empty">Proiect gol.</div>';
  const start = b.mn, total = dD(b.mn, b.mx) + 1, bw = total > 160 ? 3 : total > 90 ? 5 : 8, H = 64;
  const charts = work.map(r => {
    const L = loadMap[r.id] || { days: {}, max: r.max || 100, peak: 0, over: [] };
    const ymax = Math.max(L.peak, L.max) * 1.15 || 100;
    let bars = '', ticks = '';
    for (let i = 0; i < total; i++) {
      const d = aD(start, i), k = fD(d), v = L.days[k] || 0;
      if (d.getDate() === 1 || i === 0) ticks += `<text x="${i * bw + 1}" y="${H + 12}" font-size="9" fill="var(--muted)">${MN(d)}</text>`;
      if (!v) continue;
      const h = Math.max(2, v / ymax * (H - 4));
      bars += `<rect x="${i * bw}" y="${H - h}" width="${Math.max(1, bw - 1)}" height="${h}" fill="${v > L.max + 0.01 ? '#e03a3a' : '#4a8fd4'}"><title>${fmtDate(d)} — ${Math.round(v)}%${v > L.max + 0.01 ? ' (peste capacitate)' : ''}</title></rect>`;
    }
    const my = H - L.max / ymax * (H - 4);
    const over = L.over.length;
    return `<div class="res-chart">
      <div class="res-chart-h"><b>${esc(r.name)}</b> <span>capacitate ${L.max}% · vârf ${Math.round(L.peak)}%</span>
        ${over ? `<span class="res-bad">⚠ supraalocat ${over} ${over === 1 ? 'zi' : 'zile'}</span>` : '<span class="res-ok">✓ în capacitate</span>'}</div>
      <div class="res-chart-w"><svg width="${total * bw}" height="${H + 16}">
        ${bars}<line x1="0" x2="${total * bw}" y1="${my}" y2="${my}" stroke="#e0a030" stroke-width="1.5" stroke-dasharray="4 3"/>${ticks}</svg></div></div>`;
  }).join('');
  return `<div class="res-help" style="margin-top:0">Fiecare coloană = o zi lucrătoare. Linia galbenă = capacitatea; coloanele roșii depășesc capacitatea (supraalocare).</div>${charts}`;
}

function _resBudgetHtml() {
  const total = costMap.total || 0;
  if (!total) return '<div class="res-empty">Niciun cost încă. Atribuie resurse activităților (în „Task Info") și bugetul se calculează singur.</div>';
  const roots = T.filter(t => !t.pid);
  const top = roots.length === 1 && hasK(roots[0].id) ? kids(roots[0].id) : roots;
  const w = wbs();
  const rows = top.filter(t => costMap[t.id]).map(t => {
    const c = costMap[t.id], pct = c / total * 100;
    return `<tr><td>${w[t.id] || ''} ${esc(t.nm)}</td><td class="res-num">${fmtMoney(c)}</td><td style="width:42%"><div class="res-bar"><i style="width:${pct}%"></i></div></td><td class="res-num">${pct.toFixed(1)}%</td></tr>`;
  }).join('');
  const byRes = RES.list.filter(r => byResCost[r.id]).sort((a, b) => byResCost[b.id] - byResCost[a.id]).map(r => {
    const c = byResCost[r.id], pct = c / total * 100;
    return `<tr><td>${esc(r.name)} <small>(${RES_TYPES[r.type]})</small></td><td class="res-num">${fmtMoney(c)}</td><td style="width:42%"><div class="res-bar alt"><i style="width:${pct}%"></i></div></td><td class="res-num">${pct.toFixed(1)}%</td></tr>`;
  }).join('');
  return `<div class="res-total">Buget total <b>${fmtMoney(total)}</b></div>
    <h4>Pe capitole</h4><table class="res-table">${rows}</table>
    <h4>Pe resurse</h4><table class="res-table">${byRes}</table>`;
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('resModal') && $('resModal').classList.contains('open')) closeResources(); });
