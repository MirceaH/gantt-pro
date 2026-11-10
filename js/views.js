// ============================================================
// VEDERI SUPLIMENTARE (Vizualizare › Alte vederi) — ca în MS Project:
//   Calendar   (view === 'calendar') = luna, cu barele activităților pe săptămâni
//   Rețea      (view === 'network')  = diagrama de rețea (PERT): casete legate, pe coloane după ordinea legăturilor
//   Echipe     (view === 'team')     = Team Planner: un rând pe resursă (+ „Nealocate"), barele activităților ei;
//                                      tragi o bară pe alt rând = o dai altei resurse
// Toate respectă filtrul (viewRows) și arată doar activitățile (capitolele nu). Textul utilizatorului trece prin esc().
// ============================================================
const XVIEWS = { calendar: '📅 Calendar', network: '🕸 Rețea (PERT)', team: '👥 Echipe (resurse)' };
let _xvMonth = null, _xvNetZoom = 1, _xvTeamDw = 22;

const _xvLeaves = () => viewRows().filter(t => !hasK(t.id) && !t._grp);
const _xvBarCls = t => {
  if (t.isMilestone) return 'xv-ms';
  if (showCritical && cpm[t.id] && cpm[t.id].crit) return 'xv-crit';
  if (BAR_COLORS[t.color]) return 'gb-x bc-' + t.color;
  return t.prog >= 100 ? 'xv-done' : t.prog > 0 ? 'xv-wip' : 'xv-todo';
};
function renderXView() {
  const box = $('xvBox'); if (!box) return;
  $('xvTitle').textContent = XVIEWS[view] || '';
  if (!T.length) { box.innerHTML = '<div class="res-empty">Proiect gol.</div>'; $('xvTools').innerHTML = ''; return; }
  if (view === 'calendar') _xvCalendar(box);
  else if (view === 'network') _xvNetwork(box);
  else if (view === 'team') _xvTeam(box);
}
function xvOpen(id, e) { if (e) e.stopPropagation(); setSel(id); }   // ancora, fila Format și redesenarea, ca în Gantt
function xvInfo(id, e) { if (e) e.stopPropagation(); openTaskInfo(id); }

// ---------------- Calendar (luna) ----------------
function xvMonth(dir) {
  if (dir === 0) { const s = pD(statusDay()); _xvMonth = new Date(s.getFullYear(), s.getMonth(), 1); }
  else _xvMonth = new Date(_xvMonth.getFullYear(), _xvMonth.getMonth() + dir, 1);
  renderXView();
}
function _xvCalendar(box) {
  const L = _xvLeaves();
  if (!_xvMonth) { const s = pD(statusDay()), b = ab(); const ref = b && (s < b.mn || s > b.mx) ? b.mn : s; _xvMonth = new Date(ref.getFullYear(), ref.getMonth(), 1); }
  const m0 = _xvMonth, first = aD(m0, -((m0.getDay() + 6) % 7)), last = new Date(m0.getFullYear(), m0.getMonth() + 1, 0);
  $('xvTools').innerHTML = `<button type="button" class="modal-btn cancel" onclick="xvMonth(-1)" title="Luna trecută">◀</button>`
    + `<b class="xv-month">${_MONTHS[m0.getMonth()]} ${m0.getFullYear()}</b>`
    + `<button type="button" class="modal-btn cancel" onclick="xvMonth(1)" title="Luna următoare">▶</button>`
    + `<button type="button" class="modal-btn cancel" onclick="xvMonth(0)" title="Luna datei de status">Azi</button>`
    + `<span>Click = selectezi · dublu-click = Detalii · ${L.length} activități (după filtru)</span>`;
  const today = fD(new Date()), st = statusDay();
  let h = '<div class="xv-cal"><div class="xv-cal-head">' + ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm', 'Dum'].map(d => `<div>${d}</div>`).join('') + '</div>';
  for (let ws = first, n = 0; ws <= last && n < 7; ws = aD(ws, 7), n++) {
    const we = aD(ws, 6);
    // activitățile care se suprapun cu săptămâna → benzi (fără suprapuneri pe aceeași bandă)
    const segs = L.map(t => ({ t, s: pD(t.sd), e: t.isMilestone ? pD(t.sd) : endDate(t) })).filter(x => x.e >= ws && x.s <= we)
      .map(x => ({ ...x, c0: Math.max(0, dD(ws, x.s)), c1: Math.min(6, dD(ws, x.e)) })).sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0));
    const lanes = [];
    segs.forEach(sg => { let i = lanes.findIndex(l => l < sg.c0); if (i < 0) { i = lanes.length; lanes.push(-1); } lanes[i] = sg.c1; sg.lane = i; });
    const MAXL = 6, shown = segs.filter(s => s.lane < MAXL), hidden = segs.length - shown.length;
    h += `<div class="xv-week" style="--lanes:${Math.min(MAXL, Math.max(1, lanes.length))}"><div class="xv-days">`;
    for (let i = 0; i < 7; i++) {
      const d = aD(ws, i), k = fD(d);
      h += `<div class="xv-day${d.getMonth() !== m0.getMonth() ? ' out' : ''}${isOff(d) ? ' off' : ''}${k === today ? ' today' : ''}${k === st && st !== today ? ' status' : ''}"><span>${d.getDate()}</span></div>`;
    }
    h += '</div><div class="xv-segs">';
    shown.forEach(sg => {
      const t = sg.t, cut0 = sg.s < ws, cut1 = sg.e > we;
      h += `<div class="xv-seg ${_xvBarCls(t)}${sel === t.id ? ' sel' : ''}${cut0 ? ' cut0' : ''}${cut1 ? ' cut1' : ''}" style="left:calc(${sg.c0} * 100% / 7 + 2px);width:calc(${sg.c1 - sg.c0 + 1} * 100% / 7 - 4px);top:calc(24px + ${sg.lane} * 20px)" title="${esc(t.nm)} · ${fmtDate(sg.s)}${t.isMilestone ? '' : ' – ' + fmtDate(sg.e)} · ${t.prog || 0}%" onclick="xvOpen(${t.id},event)" ondblclick="xvInfo(${t.id},event)">${t.isMilestone ? '♦ ' : ''}${esc(t.nm)}</div>`;
    });
    if (hidden) h += `<div class="xv-more">+${hidden} în săptămâna asta (vezi Gantt)</div>`;
    h += '</div></div>';
  }
  box.innerHTML = h + '</div>';
}

// ---------------- Rețea (PERT) ----------------
function xvNetZoom(d) { _xvNetZoom = d === 0 ? 1 : clamp(Math.round((_xvNetZoom + d) * 10) / 10, 0.4, 1.6); renderXView(); }
// Legăturile dintre activități (nu capitole): o legătură cu un capitol se leagă de activitățile lui de la capăt
function networkGraph() {
  const L = _xvLeaves(), ids = new Set(L.map(t => t.id)), edges = [], seen = new Set();
  const leavesOf = cid => allD(cid).map(taskById).filter(x => x && !hasK(x.id) && ids.has(x.id));
  const add = (a, b, type) => { const k = a + '>' + b; if (a === b || seen.has(k) || !ids.has(a) || !ids.has(b)) return; seen.add(k); edges.push({ a, b, type }); };
  L.forEach(t => {
    (t.deps || []).forEach(d => {
      const p = taskById(d.id); if (!p) return;
      if (!hasK(p.id)) add(p.id, t.id, d.type);
      else { const lv = leavesOf(p.id); const last = lv.length ? Math.max(...lv.map(x => +endDate(x))) : 0; lv.filter(x => +endDate(x) === last).forEach(x => add(x.id, t.id, d.type)); }
    });
    // legătura de pe capitolul activității: doar activitățile cu care începe capitolul (fără predecesor în el) o primesc, ca să nu se încarce desenul
    const inh = inheritedDeps(t);
    if (inh.length && !(t.deps || []).some(d => { const p = taskById(d.id); return p && p.pid === t.pid; }))
      inh.forEach(d => { const p = taskById(d.id); if (!p) return; if (!hasK(p.id)) add(p.id, t.id, d.type); else { const lv = leavesOf(p.id); const last = lv.length ? Math.max(...lv.map(x => +endDate(x))) : 0; lv.filter(x => +endDate(x) === last).forEach(x => add(x.id, t.id, d.type)); } });
  });
  // coloana = cea mai lungă cale de la început (în ordinea legăturilor); pe coloană, după media rândurilor predecesorilor
  const pred = new Map(L.map(t => [t.id, []]));
  edges.forEach(e => pred.get(e.b).push(e.a));
  const col = new Map(), byStart = L.slice().sort((x, y) => x.sd < y.sd ? -1 : x.sd > y.sd ? 1 : x.id - y.id);
  // (o buclă din fișier nu blochează desenul: un nod în curs de calcul contează 0)
  const busy = new Set();
  const rank = id => { if (col.has(id)) return col.get(id); if (busy.has(id)) return 0; busy.add(id); const r = Math.max(-1, ...pred.get(id).map(p => rank(p))) + 1; busy.delete(id); col.set(id, r); return r; };
  byStart.forEach(t => rank(t.id));
  const cols = [];
  byStart.forEach(t => { const c = col.get(t.id); (cols[c] = cols[c] || []).push(t); });
  const row = new Map();
  cols.forEach((list, c) => {
    if (c > 0) list.sort((x, y) => { const m = t => { const p = pred.get(t.id).filter(q => row.has(q)); return p.length ? p.reduce((s, q) => s + row.get(q), 0) / p.length : 1e9; }; return m(x) - m(y) || (x.sd < y.sd ? -1 : 1); });
    list.forEach((t, i) => row.set(t.id, i));
  });
  return { nodes: L.map(t => ({ t, c: col.get(t.id), r: row.get(t.id) })), edges, cols: cols.length };
}
function _xvNetwork(box) {
  const g = networkGraph(), ids = rowIds(), NW = 178, NH = 70, GX = 56, GY = 22, P = 20;
  $('xvTools').innerHTML = `<button type="button" class="modal-btn cancel" onclick="xvNetZoom(-0.2)" title="Micșorează">−</button><b>${Math.round(_xvNetZoom * 100)}%</b>`
    + `<button type="button" class="modal-btn cancel" onclick="xvNetZoom(0.2)" title="Mărește">＋</button><button type="button" class="modal-btn cancel" onclick="xvNetZoom(0)" title="Mărime normală">100%</button>`
    + `<span>Casetele roșii = drumul critic · coloanele urmează legăturile · dublu-click = Detalii</span>`;
  if (!g.nodes.length) { box.innerHTML = '<div class="res-empty">Nicio activitate de arătat (verifică filtrul).</div>'; return; }
  const maxR = Math.max(...g.nodes.map(n => n.r)) + 1, W = P * 2 + g.cols * NW + (g.cols - 1) * GX, H = P * 2 + maxR * NH + (maxR - 1) * GY;
  const pos = new Map(g.nodes.map(n => [n.t.id, { x: P + n.c * (NW + GX), y: P + n.r * (NH + GY) }]));
  const TC = { FS: 'var(--dep-fs,#8da0b5)', SS: '#4ea378', FF: '#e58b35', SF: '#9870c7' };
  let svg = `<svg class="xv-net" width="${W * _xvNetZoom}" height="${H * _xvNetZoom}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagrama de rețea"><defs><marker id="xvArr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L8,4L0,8z" fill="context-stroke"/></marker></defs>`;
  g.edges.forEach(e => {
    const a = pos.get(e.a), b = pos.get(e.b); if (!a || !b) return;
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = x1 + Math.max(14, (x2 - x1) / 2);
    const crit = cpm[e.a] && cpm[e.a].crit && cpm[e.b] && cpm[e.b].crit;
    svg += `<path class="xv-edge${crit ? ' crit' : ''}" d="M${x1},${y1} H${mx} V${y2} H${x2 - 2}" stroke="${crit ? '#d94040' : TC[e.type] || TC.FS}" marker-end="url(#xvArr)"/>`;
    if (e.type !== 'FS') svg += `<text class="xv-elbl" x="${mx + 3}" y="${(y1 + y2) / 2 - 3}">${e.type}</text>`;
  });
  g.nodes.forEach(n => {
    const t = n.t, p = pos.get(t.id), c = cpm[t.id], crit = c && c.crit, nm = t.nm.length > 24 ? t.nm.slice(0, 23) + '…' : t.nm;
    svg += `<g class="xv-node${crit ? ' crit' : ''}${t.prog >= 100 ? ' done' : ''}${sel === t.id ? ' sel' : ''}${t.isMilestone ? ' ms' : ''}" transform="translate(${p.x},${p.y})" onclick="xvOpen(${t.id},event)" ondblclick="xvInfo(${t.id},event)"><title>${esc(t.nm)}</title>`
      + `<rect width="${NW}" height="${NH}" rx="${t.isMilestone ? 18 : 6}"/>`
      + (t.prog > 0 ? `<rect class="xv-np" x="0" y="${NH - 4}" width="${NW * Math.min(100, t.prog) / 100}" height="4" rx="2"/>` : '')
      + `<text class="xv-n1" x="8" y="17">${ids[t.id] || ''} · ${esc(nm)}</text>`
      + `<text class="xv-n2" x="8" y="36">${t.isMilestone ? '♦ ' + fmtDate(pD(t.sd)) : fmtDate(pD(t.sd)) + ' – ' + fmtDate(endDate(t))}</text>`
      + `<text class="xv-n3" x="8" y="54">${t.isMilestone ? 'reper' : _zile(Math.max(1, t.dur))}${c ? ' · rezervă ' + c.float : ''} · ${t.prog || 0}%</text></g>`;
  });
  box.innerHTML = '<div class="xv-net-wrap">' + svg + '</svg></div>';
}

// ---------------- Echipe (Team Planner) ----------------
function xvTeamZoom(d) { _xvTeamDw = clamp(_xvTeamDw + d, 6, 44); renderXView(); }
function _xvTeam(box) {
  const L = _xvLeaves().filter(t => !t.isMilestone), work = RES.list.filter(r => r.type === 'work');
  $('xvTools').innerHTML = `<button type="button" class="modal-btn cancel" onclick="xvTeamZoom(-4)" title="Micșorează">−</button><button type="button" class="modal-btn cancel" onclick="xvTeamZoom(4)" title="Mărește">＋</button>`
    + `<span>Trage o bară pe alt rând = o dai altei resurse (sau „Nealocate” = fără resursă) · roșu = supraalocare · dublu-click = Detalii</span>`;
  if (!work.length) { box.innerHTML = '<div class="res-empty">Nu ai resurse de tip „Muncă”. Adaugă oameni sau echipe în Proiect › Resurse și atribuie-le activităților.</div>'; return; }
  if (!L.length) { box.innerHTML = '<div class="res-empty">Nicio activitate de arătat (verifică filtrul).</div>'; return; }
  const b0 = new Date(Math.min(...L.map(t => +pD(t.sd)))), b1 = new Date(Math.max(...L.map(t => +endDate(t)))), cs = aD(b0, -2), days = dD(cs, b1) + 4, dw = _xvTeamDw;
  const rows = work.map(r => ({ id: r.id, name: r.name, cap: r.max || 100, tasks: L.filter(t => (t.assign || []).some(a => a.rid === r.id)) }));
  rows.push({ id: 0, name: 'Nealocate', cap: 0, tasks: L.filter(t => !(t.assign || []).some(a => { const r = resById(a.rid); return r && r.type === 'work'; })) });
  // antetul cu lunile / zilele
  let head = '<div class="xv-tp-head" style="width:' + days * dw + 'px">';
  for (let i = 0; i < days; i++) { const d = aD(cs, i); if (d.getDate() === 1 || i === 0) head += `<span class="xv-tp-m" style="left:${i * dw}px">${MN(d)} ${d.getFullYear()}</span>`; if (dw >= 14) head += `<span class="xv-tp-d${isOff(d) ? ' off' : ''}" style="left:${i * dw}px;width:${dw}px">${d.getDate()}</span>`; }
  head += '</div>';
  let grid = '';
  for (let i = 0; i < days; i++) { const d = aD(cs, i); if (isOff(d)) grid += `<div class="xv-tp-off" style="left:${i * dw}px;width:${dw}px"></div>`; }
  let names = '<div class="xv-tp-corner"></div>', lanesHtml = '';
  rows.forEach(r => {
    const segs = r.tasks.map(t => ({ t, s: dD(cs, pD(t.sd)), e: dD(cs, endDate(t)) })).sort((a, b) => a.s - b.s), lanes = [];
    segs.forEach(sg => { let i = lanes.findIndex(l => l < sg.s); if (i < 0) { i = lanes.length; lanes.push(-1); } lanes[i] = sg.e; sg.lane = i; });
    const nl = Math.max(1, lanes.length), hgt = 10 + nl * 24;
    // supraalocare: zilele în care resursa are mai mult decât capacitatea (din loadMap)
    const over = r.id && loadMap[r.id] ? loadMap[r.id].over : [];
    names += `<div class="xv-tp-name${r.id ? '' : ' none'}" style="height:${hgt}px" title="${esc(r.name)}${r.id ? ' · capacitate ' + r.cap + '%' : ''}"><b>${esc(r.name)}</b><small>${r.tasks.length} ${r.tasks.length === 1 ? 'activitate' : 'activități'}${over.length ? ' · <span class="xv-over-t">supraalocat ' + over.length + ' z</span>' : ''}</small></div>`;
    lanesHtml += `<div class="xv-tp-row" data-rid="${r.id}" style="height:${hgt}px">`
      + over.map(k => `<div class="xv-tp-over" style="left:${dD(cs, pD(k)) * dw}px;width:${dw}px"></div>`).join('')
      + segs.map(sg => `<div class="xv-tp-bar ${_xvBarCls(sg.t)}${sel === sg.t.id ? ' sel' : ''}" data-tid="${sg.t.id}" data-rid="${r.id}" style="left:${sg.s * dw + 1}px;width:${(sg.e - sg.s + 1) * dw - 2}px;top:${5 + sg.lane * 24}px" title="${esc(sg.t.nm)} · ${fmtDate(pD(sg.t.sd))} – ${fmtDate(endDate(sg.t))}" ondblclick="xvInfo(${sg.t.id},event)">${esc(sg.t.nm)}</div>`).join('')
      + '</div>';
  });
  const old = box.querySelector('.xv-tp-scroll'), sx = old ? old.scrollLeft : 0, sy = box.scrollTop;   // derularea rămâne după selecție / mutare
  box.innerHTML = `<div class="xv-tp"><div class="xv-tp-names">${names}</div><div class="xv-tp-scroll"><div class="xv-tp-inner" style="width:${days * dw}px">${head}<div class="xv-tp-body">${grid}${lanesHtml}</div></div></div></div>`;
  const nw = box.querySelector('.xv-tp-scroll'); if (nw) nw.scrollLeft = sx; box.scrollTop = sy;
  box.querySelectorAll('.xv-tp-bar').forEach(_xvTeamDrag);
}
// Tragerea unei bare pe alt rând: atribuirea trece de la o resursă la alta (cu aceleași unități)
function _xvTeamDrag(bar) {
  bar.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const tid = +bar.dataset.tid, from = +bar.dataset.rid, y0 = e.clientY, x0 = e.clientX;
    let moved = false, ghost = null;
    const mv = ev => {
      if (!moved && Math.abs(ev.clientY - y0) + Math.abs(ev.clientX - x0) < 5) return;
      if (!moved) { moved = true; ghost = bar.cloneNode(true); ghost.classList.add('ghost'); document.body.appendChild(ghost); bar.classList.add('dragging'); }
      ghost.style.left = (ev.clientX + 8) + 'px'; ghost.style.top = (ev.clientY - 10) + 'px';
      document.querySelectorAll('.xv-tp-row.drop').forEach(r => r.classList.remove('drop'));
      const row = document.elementFromPoint(ev.clientX, ev.clientY); const r = row && row.closest && row.closest('.xv-tp-row'); if (r) r.classList.add('drop');
    };
    const stop = () => {
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
      document.removeEventListener('keydown', esc_); window.removeEventListener('blur', stop);
      if (ghost) ghost.remove(); ghost = null; bar.classList.remove('dragging');
      document.querySelectorAll('.xv-tp-row.drop').forEach(r => r.classList.remove('drop'));
    };
    const esc_ = ev => { if (ev.key === 'Escape') { if (moved) ev.stopPropagation(); moved = false; stop(); } };   // Esc / fereastra pierde focusul = renunți (fără să deselecteze)
    const up = ev => {
      const wasMoved = moved; stop();
      if (!wasMoved) { xvOpen(tid, ev); return; }
      const el = document.elementFromPoint(ev.clientX, ev.clientY), row = el && el.closest && el.closest('.xv-tp-row');
      if (row) reassignTask(tid, from, +row.dataset.rid);
    };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    document.addEventListener('keydown', esc_); window.addEventListener('blur', stop);
  });
}
// Mută activitatea de la resursa `from` la `to` (0 = fără resursă de muncă). Întoarce true dacă s-a schimbat ceva.
function reassignTask(tid, from, to) {
  const t = T.find(x => x.id === tid); if (!t || from === to) return false;
  const tr = to ? resById(to) : null; if (to && (!tr || tr.type !== 'work')) return false;
  pushHistory();
  const asg = (t.assign || []).slice(), i = asg.findIndex(a => a.rid === from), units = i >= 0 ? asg[i].units : 100;
  if (i >= 0) asg.splice(i, 1);
  if (to && !asg.some(a => a.rid === to)) asg.push({ rid: to, units: units || 100 });
  if (asg.length) t.assign = asg; else delete t.assign;
  syncTabData(); renderAll();
  const more = (t.assign || []).filter(a => a.rid !== to).length;
  toast('👥 „' + t.nm + '” → ' + (tr ? tr.name : 'fără ' + (resById(from) ? resById(from).name : 'resursă')) + (more ? ' (mai are și alte resurse)' : ''));
  return true;
}
