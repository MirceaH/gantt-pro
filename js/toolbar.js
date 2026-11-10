// ============================================================
// TOOLBAR.JS — funcții bară extinsă (WBS Schedule Pro inspired)
//   • Clipboard (Cut/Copy/Paste cu Ctrl+X/C/V) — funcționează între tab-uri
//   • Find (Ctrl+F) — caută în tab-ul activ
//   • Goto / Scroll to selected
//   • Expand All / Collapse All
//   • Summary Only toggle (per tab)
//   • Unlink (șterge toate dependențele task-ului)
//   • Task Info modal
//   • Export Microsoft Project XML
// ============================================================

let _clipboard = null;       // { tasks: [...], rootId: nr }
let _summaryOnly = false;     // toggle per tab

// ============================================================
// CLIPBOARD — Cut / Copy / Paste (cross-tab via _clipboard global)
// ============================================================
function cutTask() {
  if (!sel) { toast('⚠️ Selectează un task'); return; }
  if (selIds().length > 1) { copyTask(); return; }   // același mesaj: un singur rând
  // la un capitol, copierea și mesajul vin abia după confirmarea ștergerii
  delSel(() => { copyTask(); setTimeout(() => toast('✂️ Tăiat în clipboard'), 0); });
}

// ----- Sortare (ca View › Sort din MS Project, „păstrează structura"): rândurile se ordonează în fiecare capitol -----
const SORT_KEYS = {
  sd:   { nm: 'Start',            v: t => t.sd },
  fin:  { nm: 'Final',            v: t => fD(endDate(t)) },
  dur:  { nm: 'Durată',           v: t => (t.isMilestone && !hasK(t.id)) ? 0 : t.dur },
  nm:   { nm: 'Nume',             v: t => String(t.nm || ''), txt: true },
  prog: { nm: 'Progres',          v: t => t.prog || 0 },
  fl:   { nm: 'Rezervă',          v: t => hasK(t.id) ? Math.min(1e9, ...allD(t.id).map(id => cpm[id] ? cpm[id].float : 1e9)) : (cpm[t.id] ? cpm[t.id].float : 1e9) },   // capitolul: cea mai mică rezervă din el
  cost: { nm: 'Cost',             v: t => (typeof costMap !== 'undefined' && costMap[t.id]) || 0 }
};
function sortTasks(key, desc) {
  const k = SORT_KEYS[key]; if (!k || !T.length) return;
  if (typeof structLocked === 'function' && structLocked()) return;
  const cmp = (a, b) => { const x = k.v(a), y = k.v(b); const r = k.txt ? x.localeCompare(y, 'ro', { sensitivity: 'base', numeric: true }) : (x < y ? -1 : x > y ? 1 : 0); return desc ? -r : r; };
  const before = T.map(t => t.id).join();
  const sorted = T.slice().sort(cmp);              // sortare stabilă: în fiecare capitol (kids păstrează ordinea din T) rândurile ajung în ordinea cerută
  if (sorted.map(t => t.id).join() === before) { toast('ℹ️ Rândurile sunt deja în ordinea „' + k.nm + '"'); return; }
  pushHistory(); T = sorted; syncTabData(); renderAll();
  toast('↕ Sortat după ' + k.nm + (desc ? ' (descrescător)' : '') + ' · Ctrl+Z anulează');
}

function copyTask() {
  if (!sel) { toast('⚠️ Selectează un task'); return; }
  if (selIds().length > 1) { toast('ℹ️ Copierea / tăierea merge pe un rând (un capitol se copiază cu tot ce conține)'); return; }
  const ids = [sel, ...allD(sel)];
  const tasks = T.filter(t => ids.includes(t.id)).map(t => JSON.parse(JSON.stringify(t)));
  _clipboard = { tasks, rootId: sel };
  toast('📋 Copiat (' + tasks.length + ' task-uri)');
}

function pasteTask() {
  if (!_clipboard || !_clipboard.tasks.length) { toast('⚠️ Clipboard gol'); return; }
  stopFilterForEdit();
  pushHistory();

  // Map vechi-id → nou-id
  const idMap = {};
  _clipboard.tasks.forEach(t => { idMap[t.id] = nid++; });

  // Copia se lipește ca rând NOU, la același nivel cu rândul selectat, imediat sub el (rândul selectat nu devine capitol)
  const anchor = sel ? T.find(x => x.id === sel) : null;
  const newParentId = anchor ? anchor.pid : null;
  const pasted = [];

  _clipboard.tasks.forEach(t => {
    const cp = JSON.parse(JSON.stringify(t));
    const oldId = cp.id;
    cp.id = idMap[oldId];

    if (oldId === _clipboard.rootId) {
      cp.pid = newParentId;
    } else {
      cp.pid = idMap[cp.pid] !== undefined ? idMap[cp.pid] : newParentId;
    }

    // Re-mapăm doar dependențele interne clipboard-ului (cele externe se pierd)
    if (cp.deps && cp.deps.length) {
      cp.deps = cp.deps
        .map(d => (idMap[d.id] !== undefined ? Object.assign({ id: idMap[d.id], type: d.type || 'FS', lag: +d.lag || 0 }, d.pct ? { pct: true } : {}) : null))
        .filter(Boolean);
    } else {
      cp.deps = [];
    }

    pasted.push(cp);
  });
  insertAfterBlock(pasted, anchor ? anchor.id : null);

  if (newParentId) coll.delete(newParentId);
  sel = idMap[_clipboard.rootId];
  syncTabData();
  renderAll();
  toast('📎 Lipit (' + _clipboard.tasks.length + ' task-uri)');
}

// ============================================================
// DIALOG ADĂUGARE ACTIVITATE (simplu + opțiuni avansate)
// ============================================================
// Data de start propusă pentru o activitate nouă: începutul proiectului (cea mai devreme dată de start)
function defaultNewStart() {
  const starts = T.map(t => t.sd).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
  return starts.length ? starts[0] : fD(nextWork(new Date()));
}

// „+ Capitol": adaugă un rând-capitol chiar deasupra rândului selectat (sau la final), gata de redenumit.
// Activitățile de sub el se mută în capitol cu săgeata → (Tab).
function addChapter() {
  stopFilterForEdit();
  pushHistory();
  const selTask = sel ? T.find(x => x.id === sel) : null;
  const ch = { id: nid++, nm: 'Capitol nou', sd: defaultNewStart(), dur: 1, prog: 0, pid: selTask ? selTask.pid : null, deps: [] };
  if (selTask) T.splice(T.indexOf(selTask), 0, ch); else T.push(ch);
  sel = ch.id;
  syncTabData();
  renderAll();
  const inp = document.querySelector('.t-row[data-tid="' + ch.id + '"] .c-name input');
  if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ block: 'nearest' }); }
  toast('📁 Scrie numele capitolului. Apoi pune activitățile sub el cu → (Tab)');
}

function openAddTask(asMilestone) {
  stopFilterForEdit();
  const w = wbs();
  const opts = ['<option value="">— fără (nivel principal) —</option>'];
  T.forEach(t => opts.push('<option value="' + t.id + '">' + esc((w[t.id] || '') + ' ' + t.nm) + '</option>'));
  $('atParent').innerHTML = opts.join('');
  const selTask = sel ? T.find(x => x.id === sel) : null;
  $('atParent').value = selTask && selTask.pid ? String(selTask.pid) : '';

  $('atName').value = '';
  $('atName').placeholder = asMilestone ? 'Reper' : 'Activitate nouă';
  dtSet('atStart', defaultNewStart());
  $('atDur').value = '';
  $('atDur').classList.remove('err'); $('atErr').style.display = 'none';
  $('atMs').checked = !!asMilestone;
  $('atDur').disabled = !!asMilestone;
  $('atProg').value = 0;
  $('atDeps').value = '';
  $('atNotes').value = '';
  $('atAdv').classList.remove('open');
  $('atAdvBtn').textContent = '⚙ Opțiuni avansate ▾';
  $('atTitle').textContent = asMilestone ? 'Reper nou' : 'Activitate nouă';
  $('addTaskModal').classList.add('open');
  setTimeout(() => $('atName').focus(), 50);
}

function closeAddTask() { $('addTaskModal').classList.remove('open'); }

function toggleAddAdvanced() {
  const adv = $('atAdv'), open = !adv.classList.contains('open');
  adv.classList.toggle('open', open);
  $('atAdvBtn').textContent = open ? '⚙ Opțiuni avansate ▴' : '⚙ Opțiuni avansate ▾';
}

function saveAddTask() {
  const isMs = $('atMs').checked;
  const nm = $('atName').value.trim() || (isMs ? 'Reper' : 'Activitate nouă');
  const sd = $('atStart').value || defaultNewStart();
  const durIn = parseDur($('atDur').value);            // zile, sau cu unitate: 2s / 1l / 16h
  if (!isMs && !durIn) {   // durata e obligatorie: nu punem o valoare în locul utilizatorului
    $('atErr').style.display = 'block';
    $('atDur').classList.add('err');
    $('atDur').focus();
    toast('⚠️ Nu ai completat durata activității');
    return;
  }
  const dur = isMs ? 1 : durIn;
  const prog = isMs ? 0 : clamp(parseInt($('atProg').value, 10) || 0, 0, 100);
  const pid = $('atParent').value ? +$('atParent').value : null;

  const rev = wbsReverse(), deps = [];
  $('atDeps').value.split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(tok => {
    const p = _parseDepToken(tok); if (!p) return;
    const predId = rev[p.wbs];
    if (predId !== undefined) deps.push(Object.assign({ id: predId, type: p.type, lag: p.lag }, p.pct ? { pct: true } : {}));
  });

  pushHistory();
  const task = { id: nid++, nm, sd, dur, prog, pid, deps: [] };
  if (isMs) task.isMilestone = true;
  const notes = $('atNotes').value.trim();
  if (notes) task.notes = notes;
  // Se inserează sub rândul selectat (dacă e în același capitol), altfel ultima în capitolul ales
  const selRow = sel ? T.find(x => x.id === sel) : null;
  insertAfterBlock([task], selRow && selRow.pid === pid ? selRow.id : pid);
  _applyDepsSafely(task, deps);
  if (pid) coll.delete(pid);
  sel = task.id;
  closeAddTask();
  syncTabData();
  renderAll();
  toast(isMs ? '♦ Reper adăugat' : '➕ Activitate adăugată');
}

// Enter în dialog = Adaugă
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && $('addTaskModal').classList.contains('open') && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    saveAddTask();
  } else if (e.key === 'Enter' && $('taskInfoModal').classList.contains('open') && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    $('tiSaveBtn').click();
  } else if (e.key === 'Enter' && $('depEditModal').classList.contains('open') && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    $('depEditSave').click();
  }
});

// ============================================================
// FIND
// ============================================================
function openFind() {
  const bar = $('findBar');
  if (!bar) return;
  bar.classList.add('open');
  setTimeout(() => { const inp = $('findInput'); if (inp) { inp.focus(); inp.select(); } }, 50);
}

function closeFind() {
  const bar = $('findBar');
  if (bar) bar.classList.remove('open');
  document.querySelectorAll('.find-match').forEach(el => el.classList.remove('find-match'));
}

function doFind() {
  const q = ($('findInput').value || '').trim().toLowerCase();
  document.querySelectorAll('.find-match').forEach(el => el.classList.remove('find-match'));
  if (!q) return;

  const matches = T.filter(t => t.nm.toLowerCase().includes(q));
  if (!matches.length) { toast('🔍 Niciun rezultat'); return; }

  // Expand toate părinții pt fiecare match
  matches.forEach(t => {
    let p = t.pid;
    while (p) {
      coll.delete(p);
      const par = T.find(x => x.id === p);
      p = par ? par.pid : null;
    }
  });

  sel = matches[0].id;
  renderAll();

  // Highlight + scroll
  setTimeout(() => {
    matches.forEach(t => {
      document.querySelectorAll(`[data-tid="${t.id}"], [data-gid="${t.id}"]`).forEach(el => el.classList.add('find-match'));
    });
    gotoSelected();
  }, 50);

  toast('🔍 ' + matches.length + ' rezultat' + (matches.length > 1 ? 'e' : ''));
}

// ============================================================
// GOTO — scroll pe Gantt și tabel la task-ul selectat
// ============================================================
function gotoSelected() {
  if (!sel) { toast('⚠️ Selectează un task'); return; }
  const bar = document.querySelector(`.gb[data-bid="${sel}"]`);
  const gBody = $('gBody');
  if (bar && gBody) {
    const barL = parseFloat(bar.style.left);
    const barW = parseFloat(bar.style.width);
    gBody.scrollLeft = Math.max(0, barL - gBody.clientWidth / 2 + barW / 2);
  }
  const row = document.querySelector(`.t-row[data-tid="${sel}"]`);
  const tBody = $('tBody');
  if (row && tBody) {
    const rt = row.offsetTop;
    tBody.scrollTop = Math.max(0, rt - tBody.clientHeight / 2);
  }
}

// ============================================================
// EXPAND / COLLAPSE ALL
// ============================================================
function expandAll() {
  coll.clear();
  _summaryOnly = false;
  const btn = $('btnSummaryOnly'); if (btn) btn.classList.remove('active');
  renderAll();
  toast('📂 Toate deschise');
}

function collapseAll() {
  T.forEach(t => { if (kids(t.id).length) coll.add(t.id); });
  renderAll();
  toast('📁 Toate închise');
}

function toggleSummaryOnly() {
  _summaryOnly = !_summaryOnly;
  if (_summaryOnly) {
    T.forEach(t => { if (kids(t.id).length) coll.add(t.id); });
  } else {
    coll.clear();
  }
  const btn = $('btnSummaryOnly');
  if (btn) btn.classList.toggle('active', _summaryOnly);
  renderAll();
  toast(_summaryOnly ? '🗂️ Doar capitole' : '📋 Toate vizibile');
}

// ============================================================
// UNLINK — șterge toate dependențele task-ului selectat
// ============================================================
// Culoarea barei pe activitățile selectate (fila Format › Culoare); '' = culoarea obișnuită (după stare / nivel)
function setBarColorSel(k) {
  const list = selIds().map(id => T.find(x => x.id === id)).filter(t => t && !hasK(t.id) && !t.isMilestone);
  if (!list.length) { toast('⚠️ Selectează una sau mai multe activități (nu capitole sau repere)'); return; }
  if (k && !BAR_COLORS[k]) return;
  pushHistory();
  list.forEach(t => { if (k) t.color = k; else delete t.color; });
  syncTabData(); renderAll();
  toast(k ? '🎨 Culoare: ' + BAR_COLORS[k] + (list.length > 1 ? ' (' + list.length + ' activități)' : '') + (showCritical ? ' · cu drumul critic pornit, cele critice rămân roșii' : '') : '🎨 Culoarea obișnuită');
}

// „Leagă activitățile" (Ctrl+F2, ca în MS Project): rândurile selectate, în ordinea din tabel, se leagă în lanț FS
function linkSelected() {
  const ids = selIds();
  if (ids.length < 2) { toast('⚠️ Selectează cel puțin două activități (Ctrl+click sau Shift+click pe rânduri)'); return; }
  const h0 = _history.slice(), f0 = _future.slice();
  pushHistory();
  let added = 0, bad = 0, had = 0;
  for (let i = 0; i + 1 < ids.length; i++) {
    const pred = ids[i], t = T.find(x => x.id === ids[i + 1]); if (!t) continue;
    if (!t.deps) t.deps = [];
    if (t.deps.some(d => d.id === pred)) { had++; continue; }
    if (isD(t.id, pred) || isD(pred, t.id) || wouldCreateCycle(pred, t.id)) { bad++; continue; }
    t.deps.push({ id: pred, type: 'FS', lag: 0 }); added++;
  }
  if (!added) { _history = h0; _future = f0; updateUndoRedoBtns(); }
  else { syncTabData(); renderAll(); }
  toast(added ? '🔗 ' + added + (added === 1 ? ' legătură FS' : ' legături FS') + ' create' + (bad ? ' · ' + bad + ' ignorate (buclă sau capitolul propriu)' : '')
              : (bad ? '🚫 Legăturile ar crea o buclă sau ar lega o activitate de capitolul ei' : 'ℹ️ Activitățile sunt deja legate'));
}

function unlinkSelected() {
  if (!sel) { toast('⚠️ Selectează un task'); return; }
  const many = selIds();
  if (many.length > 1) {          // mai multe rânduri: se șterg doar legăturile dintre ele (ca în MS Project)
    const S = new Set(many); let n = 0;
    T.forEach(x => { if (S.has(x.id) && x.deps) n += x.deps.filter(d => S.has(d.id)).length; });
    if (!n) { toast('ℹ️ Nicio legătură între rândurile selectate'); return; }
    pushHistory();
    T.forEach(x => { if (S.has(x.id) && x.deps) x.deps = x.deps.filter(d => !S.has(d.id)); });
    syncTabData(); renderAll(); toast('🔓 ' + n + (n === 1 ? ' legătură ștearsă' : ' legături șterse') + ' între rândurile selectate');
    return;
  }
  const t = T.find(x => x.id === sel);
  if (!t) return;
  if (!t.deps) t.deps = [];

  const ownDeps = t.deps.length;
  let asPred = 0;
  T.forEach(x => { if (x.deps && x.deps.some(d => d.id === sel)) asPred++; });
  const total = ownDeps + asPred;
  if (!total) { toast('ℹ️ Niciun link de șters'); return; }

  customConfirm('Ștergi toate cele ' + total + ' dependențe ale task-ului „' + t.nm + '"?', function() {
    pushHistory();
    t.deps = [];
    T.forEach(x => { if (x.deps) x.deps = x.deps.filter(d => d.id !== sel); });
    syncTabData();
    renderAll();
    toast('🔓 ' + total + ' link-uri șterse');
  });
}

// ============================================================
// TASK INFO MODAL
// ============================================================
// Antetul ferestrei „Detalii activitate”: etichete de stare + rezumat calculat de program (nu se editează aici)
function tiChipsHtml(t) {
  const c = cpm[t.id], tw = taskWarn[t.id], out = [];
  out.push(`<span class="ti-chip kind">${hasK(t.id) ? 'Capitol' : t.isMilestone ? 'Reper' : 'Activitate'}</span>`);
  if (c && c.crit) out.push('<span class="ti-chip bad">CRITICĂ</span>');
  if (isBehind(t)) out.push('<span class="ti-chip bad">Întârziată</span>');
  if (tw) [tw.lateText, tw.cons, tw.res].filter(Boolean).forEach(x => out.push(`<span class="ti-chip warn">⚠ ${esc(x)}</span>`));
  return out.join('');
}

function tiSummaryHtml(t) {
  const c = cpm[t.id], p = ps(t), zi = n => `${n} ${n === 1 ? 'zi' : 'zile'}`;
  const st = (k, v) => `<div class="ti-stat"><div class="ti-sk">${k}</div><div class="ti-sv">${v}</div></div>`;
  const out = [
    st('Perioadă', `<b>${fmtDate(p._s)} → ${fmtDate(p._e)}</b><small>${zi(t.dur)}</small>`),
    st('Progres', `<b>${t.prog}%</b><span class="ti-bar"><span style="width:${Math.min(100, t.prog)}%"></span></span>`)
  ];
  if (c) out.push(st('Rezervă', c.crit ? '<b class="bad">0 zile</b><small>pe drumul critic</small>' : `<b>${zi(c.float)}</b><small>fără să întârzie proiectul</small>`));
  if (costMap[t.id]) out.push(st('Cost', `<b>${fmtMoney(costMap[t.id])}</b>`));
  const b = blSpan(t);
  if (b) { const v = varDays(t);
    out.push(st('Față de linia de bază', `<b class="${v > 0 ? 'bad' : 'ok'}">${v === 0 ? 'la termen' : v > 0 ? '+' + zi(v) + ' întârziere' : zi(-v) + ' mai devreme'}</b><small>${fmtDate(b.s)} → ${fmtDate(b.e)}</small>`)); }
  const a = actSpan(t);
  if (a) out.push(st('Real', `<b>${fmtDate(a.s)} → ${a.done ? fmtDate(a.e) : 'în desfășurare'}</b>`));
  return out.join('');
}

function openTaskInfo(id) {
  const t = T.find(x => x.id === id);
  if (!t) return;
  if (!t.deps) t.deps = [];

  const w = wbs();
  const p = ps(t);
  const isSumm = hasK(t.id);
  const depsList = t.deps.map(d => {
    const wb = w[d.id]; if (!wb) return null;
    const suffix = (d.type !== 'FS' || d.lag) ? depLabel(d) : '';
    return wb + suffix;
  }).filter(Boolean).join('; ');
  const succsList = T.filter(x => (x.deps || []).some(d => d.id === id))
    .map(x => w[x.id]).filter(Boolean).join('; ');

  const card = (title, inner, extra = '') => `<section class="ti-card"${extra}><h4 class="ti-ct">${title}</h4>${inner}</section>`;
  const linkChip = (id, d) => `<span class="ti-link" style="--c:${DEP_COLORS[d.type] || DEP_COLORS.FS}" title="${esc((T.find(x => x.id === id) || {}).nm || '')}">${w[id] || '?'}<i>${esc(depLabel(d))}</i></span>`;
  const succChips = T.filter(x => (x.deps || []).some(d => d.id === id)).map(x => linkChip(x.id, x.deps.find(d => d.id === id))).join('') || '<span class="ti-none">—</span>';
  const kind = isSumm ? '🗂️ Capitol — datele se calculează automat din subactivități' : t.isMilestone ? '◆ Reper' : '📌 Activitate';

  const cGeneral = card('General', `
    <div class="ti-row">
      <label>Nume</label>
      <input id="tiName" value="${esc(t.nm)}">
    </div>
    <div class="ti-row">
      <label>Nume scurt <span class="ti-opt">(opțional — apare în bară când numele complet nu încape)</span></label>
      <input id="tiShort" value="${esc(t.sn || '')}" placeholder="${esc(_autoShort(t))}" maxlength="24">
    </div>
    <div class="ti-meta">WBS <b>${w[t.id] || ''}</b> · ID <b>${rowIds()[t.id] || t.id}</b> · ${kind}</div>`);

  const cPlan = card('Plan: date, durată, progres', `
    <div class="ti-row ti-2col">
      <div><label>Data start</label>${dtField(t.sd, {id:'tiStart', dis:isSumm})}</div>
      <div><label>Data final</label>${dtField(fD(p._e), {id:'tiEnd', dis:isSumm})}</div>
    </div>
    <div class="ti-row ti-2col">
      <div><label>Durată (zile)</label><input type="text" autocomplete="off" id="tiDur" value="${t.dur}" title="Zile lucrătoare; poți scrie și 2s (săptămâni), 1l (luni), 16h (ore)" ${isSumm ? 'disabled' : ''}></div>
      <div><label>Progres (%)</label><input type="number" min="0" max="100" id="tiProg" value="${t.prog}" ${isSumm ? 'disabled' : ''}></div>
    </div>`);

  const cReal = (isSumm || t.isMilestone) ? '' : card('Progres real', `
    <div class="ti-row ti-2col">
      <div><label>Început real <button type="button" class="ti-mini" onclick="dtSet('tiAs',statusDay())" title="Pune data de status">azi</button></label>${dtField(t.as || '', {id:'tiAs'})}</div>
      <div><label>Final real <button type="button" class="ti-mini" onclick="dtSet('tiAf',statusDay())" title="Pune data de status">azi</button></label>${dtField(t.af || '', {id:'tiAf'})}</div>
    </div>
    <div class="dep-hint">Se completează singure când progresul trece de 0% / ajunge la 100% (cu data de status). Planul se mută după ele doar când apeși „Actualizează planul" (Proiect › Urmărire).</div>`);

  const cNotes = card('Note', `
    <div class="ti-row">
      <label>Note</label>
      <textarea id="tiNotes" rows="3" placeholder="Note opționale...">${esc(t.notes || '')}</textarea>
    </div>
    <div class="ti-row">
      <label>Link <span class="ti-opt">(planșă, contract, deviz — adresă web; se deschide din 🔗 lângă nume)</span></label>
      <input id="tiLink" type="url" autocomplete="off" maxlength="500" placeholder="https://…" value="${esc(t.link || '')}">
    </div>`);

  const cLinks = card('Legături', `
    <div class="ti-row">
      <label>Se face după (WBS[Tip][±zile], separat cu ;)</label>
      <input id="tiDeps" value="${esc(depsList)}" placeholder="ex: 1.1; 2.3FS+2; 3.4SS-1">
      <div class="dep-hint">Scrie numărul rândului după care se face. <b>1.2</b> = începe după ce se termină 1.2. <b>1.2SS+3</b> = începe la 3 zile după ce începe 1.2. Mai multe: separate cu ;<br>Tipuri: FS (implicit) • SS (start-start) • FF (finish-finish) • SF (start-finish). Lag opțional: +2 / -1</div>
    </div>
    <div class="ti-row">
      <label>Urmează după ea (doar informativ)</label>
      <div class="ti-chips-row">${succChips}</div>
    </div>`);

  const cCons = card('Restricții și termen', `
    <div class="ti-row ti-2col">
      <div>
        <label>Restricție</label>
        <select id="tiCons" ${isSumm ? 'disabled' : ''} onchange="$('tiConsDate').disabled = !CONS_NEEDS_DATE.includes(this.value)">
          ${Object.keys(CONS_LABELS).map(k => `<option value="${k}" ${((t.cons && t.cons.type) || 'ASAP') === k ? 'selected' : ''}>${CONS_LABELS[k]}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Data restricției</label>
        ${dtField(t.cons && t.cons.date ? t.cons.date : '', {id:'tiConsDate', dis:(isSumm || !(t.cons && CONS_NEEDS_DATE.includes(t.cons.type)))})}
      </div>
    </div>
    <div class="ti-row">
      <label>Termen limită (deadline)</label>
      ${dtField(t.deadline || '', {id:'tiDeadline'})}
      <div class="dep-hint">Nu mută nimic — doar avertizează dacă e depășit.</div>
    </div>`);

  const cRes = card('Resurse și cost', `
    <div class="ti-row ti-res">
      <label>Resurse atribuite</label>
      <div id="tiAssign"></div>
      <div class="ti-res-actions">
        <button type="button" class="modal-btn cancel" onclick="tiAddAssign()">＋ Adaugă resursă</button>
        <button type="button" class="modal-btn cancel" onclick="openResources('res')">👥 Gestionează resursele</button>
        <span id="tiCost" class="ti-cost"></span>
      </div>
    </div>
    <div class="ti-row">
      <label>Cost real (${esc(RES.cur)}) <span class="ti-opt">(opțional — cât s-a cheltuit până acum; alimentează valoarea realizată / EVM)</span></label>
      <input type="number" min="0" step="any" id="tiActualCost" value="${t.acost !== undefined && t.acost !== null ? t.acost : ''}" placeholder="necompletat = în buget">
    </div>
    <div class="ti-row">
      <label>Tip activitate (ce se păstrează când schimbi durata sau resursele)</label>
      <select id="tiType">
        ${Object.keys(TASK_TYPES).map(k => `<option value="${k}" ${(t.ttype || 'fu') === k ? 'selected' : ''}>${TASK_TYPES[k]}</option>`).join('')}
      </select>
      <div class="dep-hint">Durată fixă: la mai multe resurse crește munca. Muncă fixă: la mai multe resurse scade durata. Unități fixe: la altă durată se schimbă munca.</div>
    </div>
    <div class="ti-row">
      <label>Calendar <span class="ti-opt">(zilele în care se lucrează la ea; calendarele se fac în Proiect › Calendar)</span></label>
      <select id="tiCal">
        <option value="">Calendarul proiectului</option>
        ${(CAL.cals || []).map(c => `<option value="${c.id}" ${t.cal === c.id ? 'selected' : ''}>${esc(c.nm)}</option>`).join('')}
      </select>
    </div>`, isSumm ? ' style="display:none"' : '');

  $('tiBody').innerHTML = `<div class="ti-grid"><div class="ti-col">${cGeneral}${cPlan}${cReal}${cNotes}</div><div class="ti-col">${cLinks}${cCons}${cRes}</div></div>`;

  _tiAssign = JSON.parse(JSON.stringify(t.assign || []));
  _tiOld = { dur: t.dur, assign: JSON.parse(JSON.stringify(t.assign || [])) };
  _tiTaskId = id;
  tiRenderAssign();
  $('tiDur') && $('tiDur').addEventListener('input', tiRenderCost);
  if (!isSumm) {
    // Start, durată și final sunt legate între ele (la salvare, finalul ar anula altfel durata scrisă de tine):
    // schimbi startul sau durata → se recalculează finalul; schimbi finalul → se recalculează durata.
    // Calendarul după care se numără zilele: cel ales în fereastră + concediile resurselor atribuite acum în fereastră
    const tmp = extra => Object.assign({ cal: ($('tiCal') && +$('tiCal').value) || undefined, assign: _tiAssign }, extra);
    const syncEnd = () => { const sd = $('tiStart').value, d = parseDur($('tiDur').value); if (sd && d) dtSet('tiEnd', fD(endDate(tmp({ sd, dur: d })))); };
    $('tiStart').addEventListener('change', syncEnd);
    $('tiDur').addEventListener('input', syncEnd);
    if ($('tiCal')) $('tiCal').addEventListener('change', syncEnd);
    $('tiEnd').addEventListener('change', () => {
      const sd = $('tiStart').value, ed = $('tiEnd').value; if (!sd || !ed) return;
      if (ed < sd) { toast('⚠️ Finalul nu poate fi înaintea startului'); syncEnd(); return; }
      $('tiDur').value = withCal(calOf(tmp({})), () => workDur(pD(sd), pD(ed))); tiRenderCost();
    });
  }
  $('tiWbs').textContent = w[t.id] || '';
  $('tiTitle').textContent = t.nm;
  $('tiChips').innerHTML = tiChipsHtml(t);
  $('tiSummary').innerHTML = tiSummaryHtml(t);
  $('tiBody').scrollTop = 0;
  $('taskInfoModal').classList.add('open');
  $('tiSaveBtn').onclick = () => saveTaskInfo(id);
}

function closeTaskInfo() {
  $('taskInfoModal').classList.remove('open');
}

function saveTaskInfo(id) {
  const t = T.find(x => x.id === id);
  if (!t) return;
  const asEl = $('tiAs'), afEl = $('tiAf');
  const asV = asEl ? asEl.value : '', afV = afEl ? afEl.value : '';
  if (asV && afV && afV < asV) { toast('⚠️ Finalul real nu poate fi înaintea începutului real'); return; }
  pushHistory();
  let actMsg = '';
  const sd0 = t.sd;

  t.nm = $('tiName').value.trim() || t.nm;
  { const sn = $('tiShort').value.trim(); if (sn) t.sn = sn; else delete t.sn; }
  if (!hasK(t.id)) {
    t.sd = $('tiStart').value || t.sd;
    const newDur = parseDur($('tiDur').value);       // zile, sau cu unitate: 2s / 1l / 16h
    if (newDur == null && $('tiDur').value.trim()) toast('⚠️ Durată invalidă „' + $('tiDur').value.trim().slice(0, 20) + '” — am păstrat ' + t.dur + ' zile (scrie 5, 2s, 1l sau 16h)');
    if (newDur) t.dur = newDur;
    const oldProg = t.prog;
    t.prog = clamp(parseInt($('tiProg').value, 10) || 0, 0, 100);
    // durata vine din câmpul Durată (finalul scris de tine o recalculează deja, în calendarul activității)
    if (asEl && afEl) {                       // început / final real: întâi ce ai scris tu, apoi completarea automată
      const oldAf = t.af;
      if (asV) t.as = asV; else delete t.as;
      if (afV) { t.af = afV; if (!t.as) t.as = _minISO(t.sd, afV); if (afV !== oldAf && t.prog < 100) t.prog = 100; } else delete t.af;
      actMsg = _syncActuals(t, oldProg);
    }
  }

  // Notes
  const notes = $('tiNotes').value.trim();
  if (notes) t.notes = notes;
  else delete t.notes;
  const lkIn = $('tiLink') ? $('tiLink').value.trim() : '', lk = safeLink(lkIn);   // link către document: doar http(s)
  if (lk) t.link = lk; else { delete t.link; if (lkIn) toast('⚠️ Linkul nu e o adresă web (http / https) — nu l-am salvat'); }

  // Restricție + termen limită
  if (!hasK(t.id)) {
    const ct = $('tiCons').value, cd = $('tiConsDate').value;
    const oldType = t.cons && t.cons.type;
    if (ct === 'ASAP' || (CONS_NEEDS_DATE.includes(ct) && !cd)) delete t.cons;
    else t.cons = { type: ct, date: CONS_NEEDS_DATE.includes(ct) ? cd : null };
    if (ct !== 'ALAP' || oldType !== 'ALAP') delete t._alap;
  }
  const dlv = $('tiDeadline').value;
  if (dlv) t.deadline = dlv; else delete t.deadline;

  // Deps — folosește parser-ul extins (acceptă WBS[Tip][±lag])
  const depsStr = $('tiDeps').value.trim();
  if (depsStr) {
    const rev = wbsReverse();
    const out = [];
    depsStr.split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(tok => {
      const p = _parseDepToken(tok); if (!p) return;
      const predId = rev[p.wbs];
      if (predId === undefined || predId === id) return;
      out.push(Object.assign({ id: predId, type: p.type, lag: p.lag }, p.pct ? { pct: true } : {}));
    });
    _applyDepsSafely(t, out);
  } else {
    t.deps = [];
  }
  // Start schimbat: activitatea se mută (decalaj pe legătură / restricție), la fel ca în tabel și la tragerea barei
  if (!hasK(t.id) && t.sd !== sd0) { const m = moveStartTo(t, t.sd); if (m) actMsg = actMsg ? actMsg + ' · ' + m : m; }

  // Resurse atribuite + tip activitate
  if (!hasK(t.id)) {
    const tt = $('tiType').value;
    if (tt === 'fu') delete t.ttype; else t.ttype = tt;
    const cv = $('tiCal') ? +$('tiCal').value : 0;                     // calendarul activității
    if (cv && (CAL.cals || []).some(c => c.id === cv)) t.cal = cv; else delete t.cal;
    t.assign = _tiAssign.filter(a => resById(a.rid) && a.units > 0).map(a => ({ rid: a.rid, units: +a.units }));
    if (!t.assign.length) delete t.assign;
    applyTaskType(t, _tiOld.dur, _tiOld.assign);
    const acEl = $('tiActualCost'), acV = acEl ? parseFloat(acEl.value) : NaN;       // cost real (EVM)
    if (acEl && acEl.value.trim() !== '' && Number.isFinite(acV) && acV >= 0) t.acost = acV; else delete t.acost;
  }

  closeTaskInfo();
  syncTabData();
  renderAll();
  toast('💾 Salvat' + (actMsg ? ' · ' + actMsg : ''));
}

// ============================================================
// EXPORT MICROSOFT PROJECT XML
// ============================================================
function exportMSProject() {
  if (!T.length) { toast('⚠️ Proiect gol'); return; }
  const tab = tabs.find(t => t.id === activeTabId);
  const defaultName = tab ? tab.name : 'proiect-mpp';
  showNameModal(defaultName, function(projectName) {
    const xml = _buildMSProjectXML(projectName);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = projectName.replace(/\s+/g, '-') + '.xml';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('📊 MS Project XML exportat');
  });
}


// ============================================================
// IMPORT DIN MS PROJECT (XML, schema „http://schemas.microsoft.com/project") — inversul exportului de mai sus
// ============================================================
// Citește: activitățile (ierarhia din OutlineLevel, durate, repere, progres, restricții, termene, note, date reale, linia de bază 0),
// legăturile (tip + decalaj în zecimi de minut), calendarul proiectului (zile lucrătoare + zile libere), resursele și atribuirile.
// Rezultatul trece prin aceeași sanitizare ca orice fișier (addNewTab → loadTabData → _sanitizeTasks / setCal / setRes).
function _parseMSProjectXML(text) {
  const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Fișierul nu e un XML valid');
  const root = doc.documentElement;
  if (!root || root.localName !== 'Project') throw new Error('Nu e un fișier MS Project XML (lipsește <Project>)');
  const kidsOf = (el, tag) => el ? [...el.children].filter(c => c.localName === tag) : [];
  const one = (el, tag) => kidsOf(el, tag)[0] || null;
  const val = (el, tag) => { const c = one(el, tag); return c ? c.textContent.trim() : ''; };
  const num = (el, tag, d) => { const v = parseFloat(val(el, tag)); return Number.isFinite(v) ? v : d; };
  const day = s => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : '');
  const mpd = num(root, 'MinutesPerDay', 480), minPerDay = mpd > 0 ? mpd : 480;
  // durată ISO 8601 (PT40H0M0S, P2DT4H…) → ore
  const hours = s => { const m = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s || ''); return m ? (+m[1] || 0) * 24 + (+m[2] || 0) + (+m[3] || 0) / 60 + (+m[4] || 0) / 3600 : null; };
  const warn = [];

  // --- calendarele ---
  const cals = kidsOf(one(root, 'Calendars'), 'Calendar'), calUid = val(root, 'CalendarUID');
  const first = cals.find(c => val(c, 'UID') === calUid) || cals.find(c => val(c, 'IsBaseCalendar') === '1') || cals[0];
  let holCap = false, holTotal = 0, rec = 0;                 // fișier ostil: plafon de zile libere (pe tot fișierul)
  // zilele lucrătoare + zilele libere ale unui calendar; un calendar derivat moștenește din calendarul lui de bază (întâi baza, apoi ce schimbă el)
  const calData = (c0, ownOnly) => {
    const out = { days: [0, 1, 1, 1, 1, 1, 0] }, hol = new Set();
    const addRange = (from, to) => { const a = day(from), b = day(to) || a; if (!a) return; for (let d = pD(a), n = 0; fD(d) <= b && n < 3660; d = aD(d, 1), n++) { if (holTotal >= 20000) { holCap = true; return; } if (!hol.has(fD(d))) { hol.add(fD(d)); holTotal++; } } };
    const chain = [];
    for (let c = c0; c && !chain.includes(c) && chain.length < 10; c = cals.find(x => val(x, 'UID') === val(c, 'BaseCalendarUID') && x !== c)) chain.unshift(c);
    (ownOnly ? [c0] : chain).forEach(base => {
      if (!base) return;
      kidsOf(one(base, 'WeekDays'), 'WeekDay').forEach(w => {
        const t = num(w, 'DayType', -1), work = val(w, 'DayWorking') === '1';
        if (t >= 1 && t <= 7) out.days[t - 1] = work ? 1 : 0;
        else if (t === 0 && !work) { const tp = one(w, 'TimePeriod'); if (tp) addRange(val(tp, 'FromDate'), val(tp, 'ToDate')); }
      });
      // formatul nou (Project 2007+): <Exceptions><Exception> — doar excepțiile nelucrătoare pe un interval (fără recurență)
      kidsOf(one(base, 'Exceptions'), 'Exception').forEach(x => {
        if (val(x, 'DayWorking') === '1') return;
        const tp = one(x, 'TimePeriod'); if (!tp) return;
        if (!val(x, 'Type') || num(x, 'Type', 1) === 1) addRange(val(tp, 'FromDate'), val(tp, 'ToDate')); else rec++;
      });
    });
    if (!out.days.some(Boolean)) out.days = [0, 1, 1, 1, 1, 1, 0];
    out.hol = [...hol].sort();
    return out;
  };
  const cal = calData(first);
  // celelalte calendare de bază (ex. „7 din 7") → calendare suplimentare, pe care activitățile le folosesc prin CalendarUID
  const calMap = {}; cal.cals = [];
  const used = new Set(kidsOf(one(root, 'Tasks'), 'Task').map(x => val(x, 'CalendarUID')));   // doar calendarele folosite de activități (nu „24 Hours" / „Night Shift" nefolosite)
  cals.filter(c => c !== first && val(c, 'IsBaseCalendar') === '1' && used.has(val(c, 'UID'))).slice(0, 20).forEach(c => {
    const d = calData(c), id = cal.cals.length + 1, ph = new Set(cal.hol);
    const own = d.hol.filter(h => !ph.has(h)), inh = cal.hol.every(h => d.hol.includes(h));   // dacă are toate zilele libere ale proiectului, le moștenește
    cal.cals.push({ id, nm: (val(c, 'Name') || 'Calendar ' + id).replace(/[\u0000-\u001f]/g, ' ').slice(0, 40), days: d.days, hol: inh ? own : d.hol, inh });
    calMap[val(c, 'UID')] = id;
  });
  if (rec) warn.push(rec + ' excepții recurente din calendar ignorate (adaugă-le din Calendar)');
  if (holCap) warn.push('prea multe zile libere în calendar: s-au păstrat primele 20 000');

  // --- activitățile ---
  const consRev = { 1: 'ALAP', 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT' };
  const typeRev = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' }, ttRev = { 0: 'fu', 1: 'fd', 2: 'fw' };
  const raw = kidsOf(one(root, 'Tasks'), 'Task').filter(x => val(x, 'IsNull') !== '1' && val(x, 'UID') !== '' && val(x, 'UID') !== '0' && num(x, 'OutlineLevel', 1) >= 1);
  const uid2id = {}, tasks = [], stack = [], fileStart = {};
  raw.forEach((x, i) => { uid2id[val(x, 'UID')] = i + 1; });
  let lagEl = 0, lagFrac = 0, extLinks = 0;
  raw.forEach((x, i) => {
    const id = i + 1, lvl = Math.max(1, Math.round(num(x, 'OutlineLevel', 1)));
    while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
    const pid = stack.length ? stack[stack.length - 1].id : null;
    stack.push({ id, lvl });
    const h = hours(val(x, 'Duration')), start = day(val(x, 'Start')), finish = day(val(x, 'Finish'));
    const ms = val(x, 'Milestone') === '1' || (h === 0 && val(x, 'Summary') !== '1');   // durată 0 = reper (ca în MS Project)
    let dur = h != null ? Math.min(36500, Math.round(Math.max(0, h) * 60 / minPerDay)) : 0;
    if (!ms && dur < 1) dur = 1;
    const nm = (val(x, 'Name') || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 250) || 'Activitate';
    const t = { id, nm, sd: start || finish, dur: ms ? 1 : dur, prog: Math.round(num(x, 'PercentComplete', 0)), pid, deps: [] };
    if (ms) { t.isMilestone = true; if (finish) t.sd = finish; }     // reperul (durată 0) stă la finalul zilei lui
    fileStart[id] = t.sd;
    const tt = ttRev[val(x, 'Type')]; if (tt && tt !== 'fu') t.ttype = tt;
    const tc = calMap[val(x, 'CalendarUID')]; if (tc) t.cal = tc;                 // calendarul activității (alt calendar de bază)
    const notes = val(x, 'Notes'); if (notes) t.notes = notes.slice(0, 5000);
    { const lk = safeLink(val(x, 'HyperlinkAddress')); if (lk) t.link = lk; }      // linkul (Hyperlink) al activității
    const dl = day(val(x, 'Deadline')); if (dl) t.deadline = dl;
    const ct = consRev[val(x, 'ConstraintType')], cd = day(val(x, 'ConstraintDate'));
    if (ct === 'ALAP') t.cons = { type: 'ALAP' }; else if (ct && cd) t.cons = { type: ct, date: cd };
    const as = day(val(x, 'ActualStart')), af = day(val(x, 'ActualFinish'));
    if (!ms && as) t.as = as;
    if (!ms && af) t.af = af;
    const bl = kidsOf(x, 'Baseline').find(b => val(b, 'Number') === '0' || val(b, 'Number') === '');
    if (bl && day(val(bl, 'Start'))) {
      const bh = hours(val(bl, 'Duration')), b = { sd: day(val(bl, 'Start')), dur: Math.max(1, bh != null ? Math.round(bh * 60 / minPerDay) : 1) };
      const bc = parseFloat(val(bl, 'Cost')); if (Number.isFinite(bc)) b.cost = Math.max(0, bc) / 100;   // MS Project ține costurile în bani (×100)
      t.bl = b;
    }
    kidsOf(x, 'PredecessorLink').forEach(l => {
      const pred = val(l, 'CrossProject') === '1' ? null : uid2id[val(l, 'PredecessorUID')];
      if (!pred) { extLinks++; return; }
      const fmt = num(l, 'LagFormat', 7), type = typeRev[val(l, 'Type')] || 'FS';
      // decalaj în procente din durata predecesorului: LinkLag = procentul simplu (verificat în MS Project: SS+50% → LinkLag 50, LagFormat 19)
      if (fmt === 20 || fmt === 52) lagEl++;                                          // procent „scurs" (calendaristic): îl luăm ca procent obișnuit, cu avertisment
      if (fmt === 19 || fmt === 20 || fmt === 51 || fmt === 52) { t.deps.push({ id: pred, type, lag: clamp(Math.round(num(l, 'LinkLag', 0)), -1000, 1000), pct: true }); return; }
      let lag = num(l, 'LinkLag', 0) / (minPerDay * 10);        // zecimi de minut → zile lucrătoare
      if ([6, 8, 10, 12, 54, 56, 58, 60].includes(fmt)) lagEl++;                     // decalaj în timp „scurs" (calendaristic): îl luăm în zile lucrătoare
      if (Math.abs(lag - Math.round(lag)) > 0.01) lagFrac++;                               // decalaj în ore: se rotunjește la zile întregi
      t.deps.push({ id: pred, type, lag: clamp(Math.round(lag), -36500, 36500) });
    });
    tasks.push(t);
  });
  if (lagEl) warn.push(lagEl + (lagEl === 1 ? ' decalaj calendaristic luat' : ' decalaje calendaristice luate') + ' în zile lucrătoare');
  if (lagFrac) warn.push(lagFrac + (lagFrac === 1 ? ' decalaj în ore rotunjit' : ' decalaje în ore rotunjite') + ' la zile întregi');
  if (extLinks) warn.push(extLinks + ' legături către alte proiecte ignorate');
  const hasKid = new Set(tasks.map(t => t.pid).filter(p => p != null));
  tasks.forEach(t => {
    // capitolele își iau datele din activități; pe ele rămân doar legăturile FS / SS (ca la noi)
    if (hasKid.has(t.id)) { ['cons', 'as', 'af', 'bl', 'ttype', 'isMilestone', 'deadline', 'cal'].forEach(k => delete t[k]); t.dur = 1; t.deps = t.deps.filter(d => d.type === 'FS' || d.type === 'SS'); return; }
    // fără legături, „nu începe înainte de" exact la start e doar felul în care MS Project fixează data (la noi startul rămâne oricum)
    if (t.cons && t.cons.type === 'SNET' && !t.deps.length && t.cons.date <= t.sd) delete t.cons;
  });

  // --- resursele și atribuirile ---
  const rTypeRev = { 1: 'work', 0: 'material', 2: 'cost' }, rid = {}, list = [];
  kidsOf(one(root, 'Resources'), 'Resource').forEach(r => {
    if (val(r, 'IsNull') === '1' || val(r, 'UID') === '0' || !val(r, 'Name')) return;
    const type = rTypeRev[val(r, 'Type')] || 'work', id = list.length + 1;
    rid[val(r, 'UID')] = { id, type };
    const n = { id, name: val(r, 'Name'), type, rate: type === 'cost' ? 0 : Math.max(0, num(r, 'StandardRate', 0)) };
    if (type === 'work') n.max = Math.round(Math.max(0, num(r, 'MaxUnits', 1)) * 100);
    if (type === 'material' && val(r, 'MaterialLabel')) n.unit = val(r, 'MaterialLabel');
    const rc = type === 'work' ? cals.find(c => val(c, 'UID') === val(r, 'CalendarUID')) : null;   // calendarul resursei: zilele ei libere în plus = concediu
    if (rc && rc !== first) { const ph = new Set(cal.hol), off = calData(rc, true).hol.filter(h => !ph.has(h)); if (off.length) n.off = off.slice(0, 2000); }
    list.push(n);
  });
  const byUid = new Map(tasks.map(t => [t.id, t]));
  kidsOf(one(root, 'Assignments'), 'Assignment').forEach(a => {
    const t = byUid.get(uid2id[val(a, 'TaskUID')]), r = rid[val(a, 'ResourceUID')];
    if (!t || !r || hasKid.has(t.id)) return;
    let units;
    if (r.type === 'work') units = Math.round(num(a, 'Units', 1) * 100);
    else if (r.type === 'material') { units = num(a, 'Units', NaN); if (!Number.isFinite(units)) { const wh = hours(val(a, 'Work')); units = wh != null ? wh : 0; } }
    else units = num(a, 'Cost', 0) / 100;                               // costul: în bani (×100)
    if (!t.assign) t.assign = [];
    if (!t.assign.some(x => x.rid === r.id)) t.assign.push({ rid: r.id, units: Math.max(0, units) });
  });
  const res = { list, next: list.length + 1, cur: val(root, 'CurrencySymbol') || 'RON' };
  const sdate = day(val(root, 'StatusDate'));
  const name = (val(root, 'Title') || val(root, 'Name').replace(/\.(xml|mpp)$/i, '')).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  return { name, tasks, cal, res, meta: { sdate: sdate || null }, fileStart, warn };
}

// Încarcă textul unui fișier MS Project XML într-o filă nouă; întoarce fila.
function importMSProjectText(text, fallbackName) {
  const p = _parseMSProjectXML(text);
  if (!p.tasks.length) throw new Error('Fișierul nu conține activități');
  const tab = addNewTab(p.name || fallbackName || 'Proiect MS Project', p.tasks, p.tasks.length + 1, p.cal, p.res, p.meta);
  // după recalculare: câte activități au alt start decât în MS Project (calendare de resursă / activitate, nivelare, programare manuală…)
  const diff = T.filter(t => !hasK(t.id) && p.fileStart[t.id] && t.sd !== p.fileStart[t.id]).length;
  const msg = ['📥 Importat din MS Project: ' + T.length + ' rânduri' + (RES.list.length ? ', ' + RES.list.length + ' resurse' : '')];
  if (diff) msg.push('⚠️ ' + diff + (diff === 1 ? ' activitate are' : ' activități au') + ' alt start decât în MS Project (calendare de resursă, nivelare sau programare manuală)');
  if (p.warn.length) msg.push(p.warn.join(' · '));
  toast(msg.join(' · '));
  return tab;
}

function importMSProject() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xml';
  input.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { importMSProjectText(await f.text(), f.name.replace(/\.xml$/i, '')); }
    catch (err) { toast('❌ ' + (err && err.message ? err.message : 'Fișier invalid')); }
  };
  document.body.appendChild(input); input.click(); document.body.removeChild(input);
}

function _msXmlEscape(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function _msXmlDate(s) {
  return s + 'T08:00:00';
}
const _msFin = s => s + 'T17:00:00';
const _msDur = days => 'PT' + Math.round(days * 8) + 'H0M0S';

// Fișier XML pentru Microsoft Project (schema „http://schemas.microsoft.com/project"), verificat deschizându-l în MS Project.
// Reguli importante ale formatului: decalajul (LinkLag) e în ZECIMI de minut (1 zi = 8 h = 4800); activitățile sunt planificate automat
// (Manual = 0), deci MS Project le recalculează după legături; activitățile fără legături primesc restricția „Nu începe înainte de"
// la startul lor (așa le păstrează MS Project data); reperele au durată 0 și cad la finalul zilei (17:00).
function _buildMSProjectXML(projectName) {
  const w = wbs(), ids = rowIds(), now = fD(new Date()) + 'T08:00:00', X = _msXmlEscape;
  const typeMap = { FS: 1, SS: 3, FF: 0, SF: 2 };
  const consMap = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
  const ttMap = { fu: 0, fd: 1, fw: 2 };
  const starts = T.map(t => t.sd).sort(), projStart = starts.length ? starts[0] : fD(new Date());

  // calendarul proiectului (UID 1): zilele lucrătoare (8–12, 13–17) și zilele libere; calendarele suplimentare = alte calendare de bază (UID 2…);
  // resursele cu concediu primesc un calendar derivat din „Standard" cu zilele lor libere (UID 1000+id)
  const wt = '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>';
  const offDays = hs => hs.map(h => `<WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>${h}T00:00:00</FromDate><ToDate>${h}T23:59:00</ToDate></TimePeriod></WeekDay>`).join('');
  const weekOf = days => { let s = ''; for (let i = 0; i < 7; i++) s += `<WeekDay><DayType>${i + 1}</DayType><DayWorking>${days[i] ? 1 : 0}</DayWorking>${days[i] ? wt : ''}</WeekDay>`; return s; };
  const calUidOf = id => 1 + id;                     // CAL.cals: id 1 → UID 2
  let calendars = `<Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${weekOf(CAL.days)}${offDays(CAL.hol)}</WeekDays></Calendar>`;
  (CAL.cals || []).forEach(c => { const hs = [...new Set([...(c.inh ? CAL.hol : []), ...c.hol])].sort(); calendars += `<Calendar><UID>${calUidOf(c.id)}</UID><Name>${X(c.nm)}</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${weekOf(c.days)}${offDays(hs)}</WeekDays></Calendar>`; });
  RES.list.filter(r => r.type === 'work' && r.off && r.off.length).forEach(r => { calendars += `<Calendar><UID>${1000 + r.id}</UID><Name>${X(r.name)}</Name><IsBaseCalendar>0</IsBaseCalendar><BaseCalendarUID>1</BaseCalendarUID><WeekDays>${offDays(r.off)}</WeekDays></Calendar>`; });
  calendars = `<Calendars>${calendars}</Calendars>`;

  let tasksXml = '';
  (function walk(list) {
    list.forEach(t => {
      const isSumm = hasK(t.id), isMs = !!t.isMilestone && !isSumm, end = fD(endDate(t));
      const start = isMs ? _msFin(t.sd) : _msXmlDate(t.sd), finish = isMs ? _msFin(t.sd) : _msFin(end);
      let cons = '';
      if (!isSumm) {
        if (t.cons && consMap[t.cons.type] !== undefined && t.cons.type !== 'ASAP') cons = `<ConstraintType>${consMap[t.cons.type]}</ConstraintType>` + (t.cons.date ? `<ConstraintDate>${_msXmlDate(t.cons.date)}</ConstraintDate>` : '');
        else if (!schedDeps(t).length) cons = `<ConstraintType>4</ConstraintType><ConstraintDate>${_msXmlDate(t.sd)}</ConstraintDate>`;
        else cons = '<ConstraintType>0</ConstraintType>';     // explicit „cât mai devreme" (fără el, MS Project poate pune altă restricție la import)
      }
      if (!isSumm && t.cal && (CAL.cals || []).some(c => c.id === t.cal)) cons = cons.replace('</ConstraintType>', '</ConstraintType><CalendarUID>' + calUidOf(t.cal) + '</CalendarUID>');   // calendarul activității, la locul lui din schemă (după ConstraintType)
      // Datele reale: MS Project le cere pentru progres > 0 (altfel le inventează și raportează conflicte de planificare)
      const aS = !isSumm ? (t.as || (t.prog > 0 ? t.sd : '')) : '', aF = !isSumm ? (t.af || (t.prog >= 100 ? end : '')) : '';
      const bl = (!isSumm && t.bl) ? `<Baseline><Number>0</Number><Start>${_msXmlDate(t.bl.sd)}</Start><Finish>${_msFin(fD(endDate({ sd: t.bl.sd, dur: t.bl.dur })))}</Finish><Duration>${_msDur(isMs ? 0 : t.bl.dur)}</Duration>${t.bl.cost != null ? `<Cost>${Math.round(t.bl.cost * 100)}</Cost>` : ''}</Baseline>` : '';
      const links = (t.deps || []).map(d => `<PredecessorLink><PredecessorUID>${d.id}</PredecessorUID><Type>${typeMap[d.type] ?? 1}</Type><CrossProject>0</CrossProject>${d.pct ? `<LinkLag>${Math.round(+d.lag || 0)}</LinkLag><LagFormat>19</LagFormat>` : `<LinkLag>${Math.round((+d.lag || 0) * 4800)}</LinkLag><LagFormat>7</LagFormat>`}</PredecessorLink>`).join('');   // procentul: LinkLag = procentul simplu, LagFormat 19 (ca MS Project)
      tasksXml += `
    <Task><UID>${t.id}</UID><ID>${ids[t.id] || t.id}</ID><Name>${X(t.nm)}</Name><Type>${ttMap[t.ttype] ?? 0}</Type><IsNull>0</IsNull><CreateDate>${now}</CreateDate>
      <WBS>${X(w[t.id] || '')}</WBS><OutlineNumber>${X(w[t.id] || '')}</OutlineNumber><OutlineLevel>${dep(t.id) + 1}</OutlineLevel><Priority>500</Priority>
      <Start>${start}</Start><Finish>${finish}</Finish><Duration>${_msDur(isMs ? 0 : t.dur)}</Duration><DurationFormat>7</DurationFormat>
      <Milestone>${isMs ? 1 : 0}</Milestone><Summary>${isSumm ? 1 : 0}</Summary><Manual>0</Manual><EffortDriven>0</EffortDriven>
      <PercentComplete>${t.prog || 0}</PercentComplete>${cons}${t.deadline ? `<Deadline>${_msFin(t.deadline)}</Deadline>` : ''}${aS ? `<ActualStart>${_msXmlDate(aS)}</ActualStart>` : ''}${aF ? `<ActualFinish>${_msFin(aF)}</ActualFinish>` : ''}${t.notes ? `<Notes>${X(t.notes)}</Notes>` : ''}${t.link ? `<Hyperlink>${X(t.link)}</Hyperlink><HyperlinkAddress>${X(t.link)}</HyperlinkAddress>` : ''}${bl}${links}
    </Task>`;
      walk(kids(t.id));
    });
  })(T.filter(t => !t.pid));

  // resurse și atribuiri (muncă: tarif pe oră, unități ca fracție; material: cantitate; cost fix: sumă)
  const rType = { work: 1, material: 0, cost: 2 };
  const resXml = RES.list.map((r, i) => `<Resource><UID>${r.id}</UID><ID>${i + 1}</ID><Name>${X(r.name)}</Name><Type>${rType[r.type] ?? 1}</Type><IsNull>0</IsNull>`
    + (r.type === 'material' ? `<MaterialLabel>${X(r.unit || '')}</MaterialLabel>` : '')
    + (r.type === 'work' ? `<MaxUnits>${(r.max || 100) / 100}</MaxUnits>` : '')
    + (r.type !== 'cost' ? `<StandardRate>${r.rate || 0}</StandardRate><StandardRateFormat>${r.type === 'work' ? 2 : 7}</StandardRateFormat>` : '')
    + (r.type === 'work' && r.off && r.off.length ? `<CalendarUID>${1000 + r.id}</CalendarUID>` : '') + `</Resource>`).join('');   // fără concediu: fără CalendarUID (MS Project îi face calendarul; cu 1 ar redenumi calendarul proiectului)
  let aUid = 1;
  const asgXml = T.filter(t => !hasK(t.id)).flatMap(t => (t.assign || []).filter(a => resById(a.rid)).map(a => {
    const r = resById(a.rid);
    const units = r.type === 'work' ? (a.units || 0) / 100 : (r.type === 'material' ? (a.units || 0) : 1);
    // munca: ore; materialul: cantitatea totală (MS Project o ține tot în câmpul Work, câte o „oră" pe unitate)
    const work = r.type === 'work' ? `<Work>${_msDur(Math.max(1, t.dur) * (a.units || 0) / 100)}</Work>` : (r.type === 'material' ? `<Work>PT${a.units || 0}H0M0S</Work>` : '');
    // Start / Finish pe atribuire: fără ele MS Project le pune la începutul proiectului și mută activitatea (conflict de planificare)
    return `<Assignment><UID>${aUid++}</UID><TaskUID>${t.id}</TaskUID><ResourceUID>${r.id}</ResourceUID><Start>${_msXmlDate(t.sd)}</Start><Finish>${_msFin(fD(endDate(t)))}</Finish><Units>${units}</Units>${work}${r.type === 'cost' ? `<Cost>${Math.round((a.units || 0) * 100)}</Cost>` : ''}</Assignment>`;
  })).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${X(projectName)}</Name>
  <Title>${X(projectName)}</Title>
  <Author>Gantt PRO</Author>
  <CreationDate>${now}</CreationDate>
  <LastSaved>${now}</LastSaved>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${_msXmlDate(projStart)}</StartDate>
  ${hasCustomStatus() ? `<StatusDate>${_msFin(META.sdate)}</StatusDate>` : ''}
  <CriticalSlackLimit>0</CriticalSlackLimit>
  <CurrencyDigits>2</CurrencyDigits>
  <CurrencySymbol>${X(RES.cur || 'RON')}</CurrencySymbol>
  <CurrencySymbolPosition>3</CurrencySymbolPosition>
  <CalendarUID>1</CalendarUID>
  <DefaultStartTime>08:00:00</DefaultStartTime>
  <DefaultFinishTime>17:00:00</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>${480 * CAL.days.filter(Boolean).length}</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <NewTasksAreManual>0</NewTasksAreManual>
  ${calendars}
  <Tasks>${tasksXml}
  </Tasks>
  <Resources>${resXml}</Resources>
  <Assignments>${asgXml}</Assignments>
</Project>`;
}


// ============================================================
// CUSTOM MODALE — confirm + name input (înlocuiesc confirm/prompt)
// ============================================================
function customConfirm(msg, callback) {
  const overlay = $('confirmModal');
  const btnOk = $('confirmBtn');
  if (!overlay || !btnOk) {
    // fallback
    if (confirm(msg)) callback();
    return;
  }
  $('confirmMsg').textContent = msg;
  overlay.classList.add('open');

  const newBtn = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(newBtn, btnOk);
  newBtn.id = 'confirmBtn';
  newBtn.addEventListener('click', () => {
    closeConfirm();
    if (callback) callback();
  });
}

function closeConfirm() {
  const overlay = $('confirmModal');
  if (overlay) overlay.classList.remove('open');
}

function showNameModal(defaultName, callback) {
  const overlay = $('nameModal');
  const input = $('nameModalInput');
  const okBtn = $('nameModalOk');
  if (!overlay || !input || !okBtn) {
    // fallback
    const v = prompt('Nume:', defaultName);
    if (v && v.trim()) callback(v.trim());
    return;
  }

  input.value = defaultName || '';
  overlay.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 100);

  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  newOk.id = 'nameModalOk';
  newOk.addEventListener('click', function() {
    const val = input.value.trim();
    if (val) {
      closeNameModal();
      callback(val);
    } else {
      input.focus();
      input.style.outline = '2px solid var(--red)';
      setTimeout(() => input.style.outline = '', 800);
    }
  });
}

function closeNameModal() {
  const overlay = $('nameModal');
  if (overlay) overlay.classList.remove('open');
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', function(e) {
  const inForm = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

  // Ctrl+F — Find (override browser)
  if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !inForm) {
    e.preventDefault();
    openFind();
    return;
  }

  // Escape în find bar
  if (e.key === 'Escape') {
    if ($('addTaskModal') && $('addTaskModal').classList.contains('open')) {
      closeAddTask();
      return;
    }
    if ($('findBar') && $('findBar').classList.contains('open')) {
      closeFind();
      return;
    }
    if ($('taskInfoModal') && $('taskInfoModal').classList.contains('open')) {
      closeTaskInfo();
      return;
    }
    if ($('nameModal') && $('nameModal').classList.contains('open')) {
      closeNameModal();
      return;
    }
    if ($('confirmModal') && $('confirmModal').classList.contains('open')) {
      closeConfirm();
      return;
    }
  }

  if (inForm) return;
  if (document.body.classList.contains('pp-open')) return;   // cu previzualizarea de tipărire deschisă nu modificăm proiectul

  if ((e.ctrlKey || e.metaKey) && e.key === 'x' && sel) { e.preventDefault(); cutTask(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && sel) { e.preventDefault(); copyTask(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); pasteTask(); }
  else if (document.querySelector('.modal-overlay.open') || !tabs.length) return;
  else if ((e.ctrlKey || e.metaKey) && e.key === 'F2') { e.preventDefault(); if (e.shiftKey) unlinkSelected(); else linkSelected(); }
  else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'A') && view === 'gantt') { e.preventDefault(); selectAllRows(); }
});

// Ctrl+A: toate rândurile vizibile
function selectAllRows() {
  const o = viewRows(); if (!o.length) return;
  msel = new Set(o.map(t => t.id));
  if (sel == null || !msel.has(sel)) sel = o[0].id;
  _selAnchor = o[0].id; refreshSelection();
  toast('☑ ' + o.length + ' rânduri selectate');
}
