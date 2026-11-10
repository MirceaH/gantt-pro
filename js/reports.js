// ============================================================
// RAPOARTE (Proiect › Rapoarte) — ca Report › Dashboards / Costs / In Progress / Compare Projects din MS Project
// ============================================================
//   Prezentare      = indicatori + repere următoare + activități întârziate + capitole (Project Overview)
//   Flux de numerar = costul pe luni: planificat (plan curent), bază (linia de bază), real (cost real introdus) + cumulat (Cash Flow)
//   Următoarele săptămâni = ce trebuie făcut de la data de status încolo, pe săptămâni, tipăribil (Upcoming Tasks)
//   Comparare       = proiectul curent față de alt proiect deschis (altă versiune) sau față de linia de bază (Compare Projects)
// Rapoartele nu schimbă datele; tot textul utilizatorului trece prin esc().
let _repTab = 'ov', _repWeeks = 2, _repCmp = 'bl';
const REP_TABS = [['ov', '📋 Prezentare'], ['cash', '💰 Flux de numerar'], ['next', '📅 Următoarele săptămâni'], ['cmp', '⇄ Comparare']];

function openReports(tab) {
  if (!tabs.length || !T.length) { toast('ℹ️ Proiectul nu are activități'); return; }
  if (tab) _repTab = tab;
  renderReports();
  $('repModal').classList.add('open');
}
function closeReports() { $('repModal').classList.remove('open'); }
function repTab(k) { _repTab = k; renderReports(); }
function renderReports() {
  $('repTabs').innerHTML = REP_TABS.map(([k, l]) => `<button type="button" class="${_repTab === k ? 'active' : ''}" onclick="repTab('${k}')">${l}</button>`).join('')
    + '<span class="res-spacer"></span><button type="button" class="modal-btn cancel rep-noprint" onclick="printReport()" title="Tipărește sau salvează ca PDF raportul afișat">🖨 Tipărește</button>';
  const f = { ov: _repOverview, cash: _repCash, next: _repNext, cmp: _repCompare }[_repTab] || _repOverview;
  $('repBody').innerHTML = withIndex(f);
}

// ----- ajutoare -----
const _repLeaves = () => T.filter(t => !hasK(t.id));
const _repDays = n => n + ' ' + (Math.abs(n) === 1 ? 'zi' : 'zile');
const _repName = t => { const w = wbs(); return '<span class="rep-wbs">' + esc(w[t.id] || '') + '</span> ' + esc(t.nm); };
const _repResNames = t => (t.assign || []).map(a => resById(a.rid)).filter(Boolean).map(r => esc(r.name)).join(', ');
// Progresul proiectului ponderat cu durata (ca la capitole)
function _repProgress() {
  const L = _repLeaves().filter(t => !t.isMilestone), d = L.reduce((s, t) => s + Math.max(1, t.dur), 0);
  return d ? Math.round(L.reduce((s, t) => s + Math.max(1, t.dur) * (t.prog || 0), 0) / d) : 0;
}
const _repCard = (lbl, val, sub, cls) => `<div class="rep-card ${cls || ''}"><div class="rep-card-l">${lbl}</div><div class="rep-card-v">${val}</div>${sub ? `<div class="rep-card-s">${sub}</div>` : ''}</div>`;

// ----- Prezentare -----
function _repOverview() {
  const L = _repLeaves(), S = pD(statusDay());
  const start = new Date(Math.min(...L.map(t => pD(t.sd)))), finish = new Date(Math.max(...L.map(t => endDate(t))));
  const prog = _repProgress(), work = L.filter(t => !t.isMilestone);
  const done = work.filter(t => t.prog >= 100).length, wip = work.filter(t => t.prog > 0 && t.prog < 100).length, late = L.filter(isBehind);
  const left = S < finish ? workDaysBetween(nextWork(S), nextWork(finish)) : 0;
  let blTxt = '', blCls = '';
  const bls = L.filter(t => t.bl);
  if (bls.length) {
    const blEnd = new Date(Math.max(...bls.map(t => endDate({ sd: t.bl.sd, dur: t.bl.dur, cal: t.cal, assign: t.assign }))));
    const dv = dD(blEnd, finish);
    blTxt = dv === 0 ? 'la termen față de bază' : (dv > 0 ? '+' + _repDays(dv) + ' față de bază' : _repDays(-dv) + ' mai devreme decât baza');
    blCls = dv > 0 ? 'bad' : 'ok';
  }
  const cost = costMap.total || 0, acost = L.reduce((s, t) => s + (Number.isFinite(+t.acost) && t.acost !== null && t.acost !== '' ? +t.acost : 0), 0);
  const blCost = L.reduce((s, t) => s + (t.bl && Number.isFinite(+t.bl.cost) ? +t.bl.cost : 0), 0);
  let h = '<div class="rep-cards">'
    + _repCard('Progres', prog + '%', `<div class="rep-bar"><i style="width:${prog}%"></i></div>`)
    + _repCard('Start', fmtDate(start), '')
    + _repCard('Final', fmtDate(finish), blTxt, blCls)
    + _repCard('Mai sunt', S >= finish ? '—' : _repDays(left), 'lucrătoare de la ' + fmtDate(S))
    + _repCard('Activități', work.length, `${done} gata · ${wip} în lucru · ${work.length - done - wip} nepornite`)
    + _repCard('Întârziate', late.length, late.length ? 'la data de status' : 'niciuna', late.length ? 'bad' : 'ok')
    + _repCard('Drum critic', cpmInfo.count || 0, 'activități fără rezervă')
    + (cost || blCost ? _repCard('Cost', fmtMoney(cost), (blCost ? 'bază ' + fmtMoney(blCost) : '') + (acost ? (blCost ? ' · ' : '') + 'real ' + fmtMoney(acost) : ''), blCost && cost > blCost + 0.5 ? 'bad' : '') : '')
    + '</div>';
  // repere următoare
  const ms = L.filter(t => t.isMilestone && t.prog < 100).sort((a, b) => a.sd < b.sd ? -1 : 1).slice(0, 8);
  h += '<h4 class="rep-h">♦ Repere următoare</h4>' + (ms.length ? '<table class="res-table rep-table"><thead><tr><th>Reper</th><th>Data</th><th>Peste</th></tr></thead><tbody>'
    + ms.map(t => { const d = dD(S, pD(t.sd)); return `<tr class="${d < 0 ? 'rep-late' : ''}"><td>${_repName(t)}</td><td>${fmtDate(pD(t.sd))}</td><td>${d < 0 ? 'întârziat ' + _repDays(-d) : d === 0 ? 'azi' : _repDays(d)}</td></tr>`; }).join('') + '</tbody></table>'
    : '<div class="res-empty">Niciun reper rămas.</div>');
  // întârziate
  h += '<h4 class="rep-h">⚠ Activități întârziate</h4>' + (late.length ? '<table class="res-table rep-table"><thead><tr><th>Activitate</th><th>Trebuia gata</th><th>Progres</th><th>Resurse</th></tr></thead><tbody>'
    + late.sort((a, b) => endDate(a) - endDate(b)).slice(0, 15).map(t => `<tr class="rep-late"><td>${_repName(t)}</td><td>${fmtDate(endDate(t))} <small>(${_repDays(dD(endDate(t), S))})</small></td><td>${t.prog || 0}%</td><td>${_repResNames(t) || '—'}</td></tr>`).join('') + '</tbody></table>'
    : '<div class="res-empty">Nicio activitate întârziată la ' + fmtDate(S) + '.</div>');
  // capitole
  const ch = T.filter(t => !t.pid && hasK(t.id));
  if (ch.length) h += '<h4 class="rep-h">🗂 Capitole</h4><table class="res-table rep-table"><thead><tr><th>Capitol</th><th>Start</th><th>Final</th><th style="width:34%">Progres</th></tr></thead><tbody>'
    + ch.map(t => `<tr><td>${_repName(t)}</td><td>${fmtDate(pD(t.sd))}</td><td>${fmtDate(endDate(t))}</td><td><div class="rep-bar"><i style="width:${t.prog || 0}%"></i></div> <small>${t.prog || 0}%</small></td></tr>`).join('') + '</tbody></table>';
  return h;
}

// ----- Flux de numerar (cost pe luni) -----
// Costul unei activități se împarte egal pe zilele ei lucrătoare (în calendarul ei); costul de bază pe intervalul liniei de bază,
// costul real pe intervalul real (început real → final real sau data de status).
function cashFlow() {
  const L = _repLeaves().filter(t => !t.isMilestone), S = pD(statusDay()), m = new Map();
  const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const spread = (t, sd, dur, total, field) => {
    if (!(total > 0)) return;
    withCal(calOf(t), () => {
      const days = []; let d = nextWork(pD(sd));
      for (let i = 0; i < Math.max(1, dur) && i < 36600; i++) { days.push(d); d = addWorkDays(d, 1); }
      days.forEach(x => { const k = key(x); const r = m.get(k) || { plan: 0, base: 0, real: 0 }; r[field] += total / days.length; m.set(k, r); });
    });
  };
  let anyBase = false, anyReal = false;
  L.forEach(t => {
    spread(t, t.sd, t.dur, costMap[t.id] || 0, 'plan');
    if (t.bl && +t.bl.cost > 0) { anyBase = true; spread(t, t.bl.sd, t.bl.dur, +t.bl.cost, 'base'); }
    if (t.acost !== undefined && t.acost !== null && t.acost !== '' && +t.acost > 0) {
      anyReal = true;
      const a = t.as ? pD(t.as) : pD(t.sd), b = t.af ? pD(t.af) : (S > a ? S : a);
      spread(t, fD(a), withCal(calOf(t), () => workDur(a, b)), +t.acost, 'real');
    }
  });
  const keys = [...m.keys()].sort();
  if (!keys.length) return { rows: [], anyBase, anyReal };
  // toate lunile dintre prima și ultima (și cele fără cost)
  const rows = [];
  for (let d = pD(keys[0] + '-01'), end = pD(keys[keys.length - 1] + '-01'), n = 0; d <= end && n < 3600; d = new Date(d.getFullYear(), d.getMonth() + 1, 1), n++) {   // până la 300 de ani (zilele sunt oricum plafonate)
    const k = key(d), r = m.get(k) || { plan: 0, base: 0, real: 0 };
    rows.push({ k, label: _MONTHS[d.getMonth()] + ' ' + d.getFullYear(), plan: r.plan, base: r.base, real: r.real });
  }
  let cp = 0, cb = 0, cr = 0;
  rows.forEach(r => { cp += r.plan; cb += r.base; cr += r.real; r.cPlan = cp; r.cBase = cb; r.cReal = cr; });
  return { rows, anyBase, anyReal };
}
function _repCash() {
  const { rows, anyBase, anyReal } = cashFlow();
  if (!rows.length) return '<div class="res-empty">Proiectul nu are costuri. Adaugă resurse cu tarif (Proiect › Resurse) și atribuie-le activităților ca să vezi fluxul de numerar pe luni.</div>';
  const max = Math.max(...rows.map(r => Math.max(r.plan, r.base, r.real)), 1), cmax = Math.max(...rows.map(r => Math.max(r.cPlan, r.cBase, r.cReal)), 1);
  // grafic: bare lunare (planificat / bază) + linia cumulată a planului
  const W = 820, H = 220, L0 = 10, B = 26, bw = (W - L0 * 2) / rows.length, y = v => H - B - v / max * (H - B - 14), yc = v => H - B - v / cmax * (H - B - 14);
  let svg = `<svg class="rep-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fluxul de numerar pe luni">`;
  rows.forEach((r, i) => {
    const w = Math.max(2, Math.min(64, bw * (anyBase ? 0.38 : 0.7))), x = L0 + i * bw + (bw - (anyBase ? 2 * w + 2 : w)) / 2 - bw * 0.12;   // bare de cel mult 64 px, centrate în lună
    svg += `<rect class="rc-plan" x="${x + bw * 0.12}" y="${y(r.plan)}" width="${w}" height="${H - B - y(r.plan)}"><title>${esc(r.label)}: ${esc(fmtMoney(r.plan))}</title></rect>`;
    if (anyBase) svg += `<rect class="rc-base" x="${x + bw * 0.12 + w + 2}" y="${y(r.base)}" width="${w}" height="${H - B - y(r.base)}"><title>${esc(r.label)} (bază): ${esc(fmtMoney(r.base))}</title></rect>`;
    if (rows.length <= 24 || i % Math.ceil(rows.length / 24) === 0) svg += `<text class="rc-lbl" x="${x + bw / 2}" y="${H - 8}">${esc(r.label.slice(0, 3))} ${String(r.k).slice(2, 4)}</text>`;
  });
  svg += `<polyline class="rc-cum" points="${rows.map((r, i) => (L0 + i * bw + bw / 2) + ',' + yc(r.cPlan)).join(' ')}"/>`;
  if (anyReal) svg += `<polyline class="rc-cum-real" points="${rows.map((r, i) => (L0 + i * bw + bw / 2) + ',' + yc(r.cReal)).join(' ')}"/>`;
  svg += '</svg>';
  const leg = '<div class="rep-legend"><span><i class="rc-plan"></i>Planificat pe lună</span>' + (anyBase ? '<span><i class="rc-base"></i>Bază pe lună</span>' : '') + '<span><i class="rc-cum"></i>Cumulat planificat</span>' + (anyReal ? '<span><i class="rc-cum-real"></i>Cumulat real</span>' : '') + '</div>';
  const M = v => v ? fmtMoney(v) : '—';
  const tbl = '<table class="res-table rep-table rep-num"><thead><tr><th>Luna</th><th>Planificat</th><th>Cumulat</th>' + (anyBase ? '<th>Bază</th><th>Cumulat bază</th>' : '') + (anyReal ? '<th>Real</th><th>Cumulat real</th>' : '') + '</tr></thead><tbody>'
    + rows.map(r => `<tr><td>${esc(r.label)}</td><td>${M(r.plan)}</td><td>${M(r.cPlan)}</td>${anyBase ? `<td>${M(r.base)}</td><td>${M(r.cBase)}</td>` : ''}${anyReal ? `<td>${M(r.real)}</td><td>${M(r.cReal)}</td>` : ''}</tr>`).join('')
    + `</tbody><tfoot><tr><th>Total</th><th>${M(rows[rows.length - 1].cPlan)}</th><th></th>${anyBase ? `<th>${M(rows[rows.length - 1].cBase)}</th><th></th>` : ''}${anyReal ? `<th>${M(rows[rows.length - 1].cReal)}</th><th></th>` : ''}</tr></tfoot></table>`;
  return svg + leg + '<div class="rep-tools rep-noprint"><button type="button" class="modal-btn cancel" onclick="exportCashCSV()" title="Tabelul lunar ca fișier CSV, pentru Excel">⬇ Exportă în Excel (CSV)</button></div>' + tbl
    + '<div class="res-help">Costul fiecărei activități e împărțit egal pe zilele ei lucrătoare. „Bază” = costurile din linia de bază, pe datele ei; „Real” = costul real introdus la activități (Detalii › Resurse și cost), pe intervalul real.</div>';
}
function exportCashCSV() {
  const { rows, anyBase, anyReal } = cashFlow(); if (!rows.length) return;
  const n = v => Math.round(v * 100) / 100;
  const head = ['Luna', 'Planificat', 'Cumulat planificat'].concat(anyBase ? ['Bază', 'Cumulat bază'] : [], anyReal ? ['Real', 'Cumulat real'] : []);
  const data = rows.map(r => [r.label, n(r.plan), n(r.cPlan)].concat(anyBase ? [n(r.base), n(r.cBase)] : [], anyReal ? [n(r.real), n(r.cReal)] : []));
  _downloadBytes(csvBuild([head].concat(data), csvDelimiter()), _safeFile(_projName()) + '-flux-numerar.csv', 'text/csv;charset=utf-8');
  toast('📄 Fluxul de numerar exportat (CSV)');
}

// ----- Următoarele săptămâni (de la data de status) -----
function repSetWeeks(v) { _repWeeks = clamp(+v || 2, 1, 8); renderReports(); const s = $('repWeeksSel'); if (s) s.focus(); }   // focusul rămâne pe listă
function upcomingTasks(weeks) {
  const S = pD(statusDay()), mon = aD(S, -((S.getDay() + 6) % 7)), until = aD(mon, 7 * weeks - 1);
  const L = _repLeaves().filter(t => t.prog < 100);
  const overdue = L.filter(t => endDate(t) < S).sort((a, b) => endDate(a) - endDate(b));
  const weeksOut = [];
  for (let w = 0; w < weeks; w++) {
    const a = aD(mon, 7 * w), b = aD(a, 6);
    weeksOut.push({ a, b, tasks: L.filter(t => endDate(t) >= S && pD(t.sd) <= b && endDate(t) >= a && (w === 0 || pD(t.sd) >= a)).sort((x, y) => x.sd < y.sd ? -1 : x.sd > y.sd ? 1 : x.id - y.id) });
  }
  return { S, until, overdue, weeks: weeksOut };
}
function _repNext() {
  const U = upcomingTasks(_repWeeks), w = wbs();
  const row = t => { const st = _statusOf(t); return `<tr class="${isBehind(t) ? 'rep-late' : ''}"><td>${_repName(t)}</td><td>${fmtDate(pD(t.sd))}</td><td>${fmtDate(endDate(t))}</td><td>${t.isMilestone ? '♦' : Math.max(1, t.dur)}</td><td>${t.prog || 0}%</td><td>${_repResNames(t) || '—'}</td><td><span class="status-badge ${st.k}">${st.lbl}</span></td></tr>`; };
  const tbl = list => '<table class="res-table rep-table"><thead><tr><th>Activitate</th><th>Start</th><th>Final</th><th>Zile</th><th>%</th><th>Resurse</th><th>Stare</th></tr></thead><tbody>' + list.map(row).join('') + '</tbody></table>';
  let h = `<div class="rep-tools rep-noprint">De la data de status <b>${fmtDate(U.S)}</b>, pentru <select id="repWeeksSel" onchange="repSetWeeks(this.value)">${[1, 2, 3, 4, 6, 8].map(n => `<option value="${n}" ${n === _repWeeks ? 'selected' : ''}>${n} ${n === 1 ? 'săptămână' : 'săptămâni'}</option>`).join('')}</select></div>`;
  h += `<div class="rep-print-only">De la ${fmtDate(U.S)} până la ${fmtDate(U.until)}</div>`;
  if (U.overdue.length) h += `<h4 class="rep-h">⚠ Restante (${U.overdue.length})</h4>` + tbl(U.overdue);
  U.weeks.forEach((wk, i) => {
    h += `<h4 class="rep-h">${i === 0 ? 'Săptămâna aceasta' : 'Săptămâna ' + (i + 1)} · ${fmtDate(wk.a)} – ${fmtDate(wk.b)} <small>(${wk.tasks.length})</small></h4>`
      + (wk.tasks.length ? tbl(wk.tasks) : '<div class="res-empty">Nimic programat.</div>');
  });
  return h;
}

// ----- Comparare cu altă versiune -----
function repSetCmp(v) { _repCmp = v; renderReports(); const s = $('repCmpSel'); if (s) s.focus(); }
// Proiectul de comparat: linia de bază a proiectului curent sau alt proiect deschis (altă versiune a planului)
// Întoarce [{nm, wbs, kind, a, b}] (a = înainte / în versiunea veche, b = acum)
function compareProjects(src) {
  const cur = _repLeaves(), w = wbs(), out = [];
  const end = t => fD(endDate(t));
  if (src === 'bl') {
    cur.forEach(t => {
      if (!t.bl) { out.push({ t, kind: 'add', a: '—', b: fmtDate(pD(t.sd)) + ' – ' + fmtDate(endDate(t)) }); return; }
      const be = fD(endDate({ sd: t.bl.sd, dur: t.bl.dur, cal: t.cal, assign: t.assign }));
      if (t.bl.sd !== t.sd) out.push({ t, kind: 'start', a: t.bl.sd, b: t.sd });
      if (be !== end(t)) out.push({ t, kind: 'fin', a: be, b: end(t) });
      if (t.bl.dur !== t.dur && !t.isMilestone) out.push({ t, kind: 'dur', a: t.bl.dur, b: t.dur });
    });
    return out;
  }
  const tab = tabs.find(x => String(x.id) === String(src)); if (!tab) return null;
  // datele celuilalt proiect, cu calendarul LUI (fără calendarele pe activitate ale lui: aproximare)
  const oc = { days: (tab.cal && tab.cal.days) || CAL.days, hs: new Set((tab.cal && tab.cal.hol) || []) };
  const oT = (tab.T || []).filter(x => x && !(tab.T || []).some(y => y && y.pid === x.id));
  const oEnd = x => fD(withCal(oc, () => addWorkDays(pD(x.sd), Math.max(1, x.dur) - 1)));
  const byId = new Map(oT.map(x => [x.id, x])), byName = new Map(oT.map(x => [String(x.nm).trim().toLowerCase(), x])), used = new Set();
  cur.forEach(t => {
    let o = byId.get(t.id); if (o && String(o.nm).trim().toLowerCase() !== String(t.nm).trim().toLowerCase()) { const n = byName.get(String(t.nm).trim().toLowerCase()); if (n && !used.has(n.id)) o = n; }
    if (!o || used.has(o.id)) { o = byName.get(String(t.nm).trim().toLowerCase()); if (o && used.has(o.id)) o = null; }
    if (!o) { out.push({ t, kind: 'add', a: '—', b: fmtDate(pD(t.sd)) + ' – ' + fmtDate(endDate(t)) }); return; }
    used.add(o.id);
    if (o.sd !== t.sd) out.push({ t, kind: 'start', a: o.sd, b: t.sd });
    if (oEnd(o) !== end(t)) out.push({ t, kind: 'fin', a: oEnd(o), b: end(t) });
    if (o.dur !== t.dur && !t.isMilestone) out.push({ t, kind: 'dur', a: o.dur, b: t.dur });
    if ((o.prog || 0) !== (t.prog || 0)) out.push({ t, kind: 'prog', a: (o.prog || 0) + '%', b: (t.prog || 0) + '%' });
    if (o.nm !== t.nm) out.push({ t, kind: 'nm', a: o.nm, b: t.nm });
  });
  oT.filter(o => !used.has(o.id)).forEach(o => out.push({ t: null, nm: o.nm, kind: 'del', a: fmtDate(pD(o.sd)) + ' – ' + fmtDate(pD(oEnd(o))), b: '—' }));
  return out;
}
function _repCompare() {
  const others = tabs.filter(x => x.id !== activeTabId);
  if (_repCmp !== 'bl' && !others.some(x => String(x.id) === String(_repCmp))) _repCmp = 'bl';   // proiectul ales s-a închis
  const opts = '<option value="bl"' + (_repCmp === 'bl' ? ' selected' : '') + '>Linia de bază a proiectului</option>'
    + others.map(x => `<option value="${x.id}" ${String(_repCmp) === String(x.id) ? 'selected' : ''}>Proiectul deschis „${esc(x.name)}”</option>`).join('');
  let h = `<div class="rep-tools rep-noprint">Compar planul de acum cu <select id="repCmpSel" onchange="repSetCmp(this.value)">${opts}</select></div>`
    + '<div class="res-help rep-noprint">Pentru o versiune mai veche salvată într-un fișier: deschide-o (Fișier › Deschide) și alege-o aici. Activitățile se potrivesc după număr, apoi după nume.</div>';
  if (_repCmp === 'bl' && !hasBaseline()) return h + '<div class="res-empty">Proiectul nu are linie de bază. Salvează una (Proiect › Linia de bază) sau deschide altă versiune a planului ca să compari.</div>';
  const res = compareProjects(_repCmp);
  if (!res) return h + '<div class="res-empty">Proiectul ales nu mai e deschis.</div>';
  if (!res.length) return h + '<div class="res-empty">✓ Nicio diferență de date, durată sau progres.</div>';
  const KIND = { add: '＋ Nouă', del: '✕ Ștearsă', start: 'Start mutat', fin: 'Final mutat', dur: 'Durată', prog: 'Progres', nm: 'Redenumită' };
  const fd = (k, v) => (k === 'start' || k === 'fin') && validISO(v) ? fmtDate(pD(v)) : esc(String(v));
  const delta = r => (r.kind === 'start' || r.kind === 'fin') && validISO(r.a) && validISO(r.b) ? (dD(pD(r.a), pD(r.b)) > 0 ? '+' : '') + _repDays(dD(pD(r.a), pD(r.b))) : (r.kind === 'dur' ? (r.b - r.a > 0 ? '+' : '') + _repDays(r.b - r.a) : '');
  const cnt = k => res.filter(r => r.kind === k).length;
  h += `<div class="rep-cards">${_repCard('Diferențe', res.length, '')}${_repCard('Finaluri mutate', cnt('fin'), '', cnt('fin') ? 'bad' : 'ok')}${_repCard('Noi', cnt('add'), '')}${_repCard('Șterse', cnt('del'), '')}</div>`;
  h += '<table class="res-table rep-table"><thead><tr><th>Activitate</th><th>Schimbare</th><th>Înainte</th><th>Acum</th><th>Δ</th></tr></thead><tbody>'
    + res.map(r => `<tr class="rep-k-${r.kind}"><td>${r.t ? _repName(r.t) : esc(r.nm)}</td><td>${KIND[r.kind]}</td><td>${fd(r.kind, r.a)}</td><td>${fd(r.kind, r.b)}</td><td>${delta(r)}</td></tr>`).join('') + '</tbody></table>';
  return h;
}

// ----- Tipărirea raportului afișat (tema luminoasă pe hârtie) -----
function printReport() {
  const dark = document.body.classList.contains('dark');
  document.body.classList.add('rep-print'); if (dark) document.body.classList.remove('dark');
  const done = () => { document.body.classList.remove('rep-print'); if (dark) document.body.classList.add('dark'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  $('repPrintTitle').textContent = (_projName() + ' — ' + ((REP_TABS.find(x => x[0] === _repTab) || [, ''])[1]).replace(/^\S+\s/, '') + ' · ' + fmtDate(new Date()));
  setTimeout(() => { try { window.print(); } finally { setTimeout(done, 500); } }, 50);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('repModal') && $('repModal').classList.contains('open')) closeReports(); });
