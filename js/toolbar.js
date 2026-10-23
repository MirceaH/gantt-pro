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
  copyTask();
  delSel();
  toast('✂️ Tăiat în clipboard');
}

function copyTask() {
  if (!sel) { toast('⚠️ Selectează un task'); return; }
  const ids = [sel, ...allD(sel)];
  const tasks = T.filter(t => ids.includes(t.id)).map(t => JSON.parse(JSON.stringify(t)));
  _clipboard = { tasks, rootId: sel };
  toast('📋 Copiat (' + tasks.length + ' task-uri)');
}

function pasteTask() {
  if (!_clipboard || !_clipboard.tasks.length) { toast('⚠️ Clipboard gol'); return; }
  pushHistory();

  // Map vechi-id → nou-id
  const idMap = {};
  _clipboard.tasks.forEach(t => { idMap[t.id] = nid++; });

  // Determinăm noul părinte (sub task-ul selectat sau rădăcină)
  const newParentId = sel || null;

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
        .map(d => (idMap[d.id] !== undefined ? { id: idMap[d.id], type: d.type || 'FS', lag: +d.lag || 0 } : null))
        .filter(Boolean);
    } else {
      cp.deps = [];
    }

    T.push(cp);
  });

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
  const durIn = parseInt($('atDur').value, 10);
  if (!isMs && !(durIn >= 1)) {   // durata e obligatorie: nu punem o valoare în locul utilizatorului
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
    if (predId !== undefined) deps.push({ id: predId, type: p.type, lag: p.lag });
  });

  pushHistory();
  const task = { id: nid++, nm, sd, dur, prog, pid, deps: [] };
  if (isMs) task.isMilestone = true;
  const notes = $('atNotes').value.trim();
  if (notes) task.notes = notes;
  T.push(task);
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
function unlinkSelected() {
  if (!sel) { toast('⚠️ Selectează un task'); return; }
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

  $('tiBody').innerHTML = `
    <div class="ti-row">
      <label>Nume</label>
      <input id="tiName" value="${esc(t.nm)}">
      <label style="margin-top:8px">Nume scurt <span style="font-weight:500;color:var(--muted)">(opțional — apare în bară când numele complet nu încape)</span></label>
      <input id="tiShort" value="${esc(t.sn || '')}" placeholder="${esc(_autoShort(t))}" maxlength="24">
    </div>
    <div class="ti-row ti-2col">
      <div>
        <label>WBS</label>
        <input value="${w[t.id] || ''}" disabled>
      </div>
      <div>
        <label>ID intern</label>
        <input value="${t.id}" disabled>
      </div>
    </div>
    <div class="ti-row ti-2col">
      <div>
        <label>Data Start</label>
        ${dtField(t.sd, {id:'tiStart', dis:isSumm})}
      </div>
      <div>
        <label>Data Final</label>
        ${dtField(fD(p._e), {id:'tiEnd', dis:isSumm})}
      </div>
    </div>
    <div class="ti-row ti-2col">
      <div>
        <label>Durată (zile)</label>
        <input type="number" min="1" id="tiDur" value="${t.dur}" ${isSumm ? 'disabled' : ''}>
      </div>
      <div>
        <label>Progres (%)</label>
        <input type="number" min="0" max="100" id="tiProg" value="${t.prog}" ${isSumm ? 'disabled' : ''}>
      </div>
    </div>
    <div class="ti-row">
      <label>Se face după (WBS[Tip][±zile], separat cu ;)</label>
      <input id="tiDeps" value="${esc(depsList)}" placeholder="ex: 1.1; 2.3FS+2; 3.4SS-1">
      <div class="dep-hint">Scrie numărul rândului după care se face. <b>1.2</b> = începe după ce se termină 1.2. <b>1.2SS+3</b> = începe la 3 zile după ce începe 1.2. Mai multe: separate cu ;</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px">
        Tipuri: FS (implicit) • SS (start-start) • FF (finish-finish) • SF (start-finish). Lag opțional: +2 / -1
      </div>
    </div>
    <div class="ti-row ti-2col">
      <div>
        <label>Restricție</label>
        <select id="tiCons" ${isSumm ? 'disabled' : ''} onchange="$('tiConsDate').disabled = !CONS_NEEDS_DATE.includes(this.value)" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--grid);font-family:var(--font)">
          ${Object.keys(CONS_LABELS).map(k => `<option value="${k}" ${((t.cons && t.cons.type) || 'ASAP') === k ? 'selected' : ''}>${CONS_LABELS[k]}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>Data restricției</label>
        ${dtField(t.cons && t.cons.date ? t.cons.date : '', {id:'tiConsDate', dis:(isSumm || !(t.cons && CONS_NEEDS_DATE.includes(t.cons.type)))})}
      </div>
    </div>
    <div class="ti-row">
      <label>Termen limită (deadline) — nu mută nimic, doar avertizează dacă e depășit</label>
      ${dtField(t.deadline || '', {id:'tiDeadline'})}
    </div>
    <div class="ti-row ti-res" ${isSumm ? 'style="display:none"' : ''}>
      <label>Resurse atribuite</label>
      <div id="tiAssign"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <button type="button" class="modal-btn cancel" style="padding:6px 12px" onclick="tiAddAssign()">＋ Adaugă resursă</button>
        <button type="button" class="modal-btn cancel" style="padding:6px 12px" onclick="openResources('res')">👥 Gestionează resursele</button>
        <span id="tiCost" class="ti-cost"></span>
      </div>
    </div>
    <div class="ti-row" ${isSumm ? 'style="display:none"' : ''}>
      <label>Tip activitate (ce se păstrează când schimbi durata sau resursele)</label>
      <select id="tiType" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--grid);font-family:var(--font)">
        ${Object.keys(TASK_TYPES).map(k => `<option value="${k}" ${(t.ttype || 'fu') === k ? 'selected' : ''}>${TASK_TYPES[k]}</option>`).join('')}
      </select>
      <div style="font-size:10px;color:var(--muted);margin-top:3px">Durată fixă: la mai multe resurse crește munca. Muncă fixă: la mai multe resurse scade durata. Unități fixe: la altă durată se schimbă munca.</div>
    </div>
    <div class="ti-row">
      <label>Urmează după ea (doar informativ)</label>
      <input value="${esc(succsList) || '—'}" disabled>
    </div>
    <div class="ti-row">
      <label>Note</label>
      <textarea id="tiNotes" rows="3" placeholder="Note opționale...">${esc(t.notes || '')}</textarea>
    </div>
    <div class="ti-info">
      ${isSumm ? '🗂️ Capitol — datele se calculează automat din subtask-uri' : '📌 Activitate'}
    </div>
  `;

  _tiAssign = JSON.parse(JSON.stringify(t.assign || []));
  _tiOld = { dur: t.dur, assign: JSON.parse(JSON.stringify(t.assign || [])) };
  _tiTaskId = id;
  tiRenderAssign();
  $('tiDur') && $('tiDur').addEventListener('input', tiRenderCost);
  $('tiTitle').textContent = (w[t.id] || '') + ' · ' + t.nm;
  $('taskInfoModal').classList.add('open');
  $('tiSaveBtn').onclick = () => saveTaskInfo(id);
}

function closeTaskInfo() {
  $('taskInfoModal').classList.remove('open');
}

function saveTaskInfo(id) {
  const t = T.find(x => x.id === id);
  if (!t) return;
  pushHistory();

  t.nm = $('tiName').value.trim() || t.nm;
  { const sn = $('tiShort').value.trim(); if (sn) t.sn = sn; else delete t.sn; }
  if (!hasK(t.id)) {
    t.sd = $('tiStart').value || t.sd;
    const newDur = parseInt($('tiDur').value, 10);
    if (newDur >= 1) t.dur = newDur;
    t.prog = clamp(parseInt($('tiProg').value, 10) || 0, 0, 100);
    const ed = $('tiEnd').value;
    if (ed) t.dur = workDur(pD(t.sd), pD(ed));
  }

  // Notes
  const notes = $('tiNotes').value.trim();
  if (notes) t.notes = notes;
  else delete t.notes;

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
      out.push({ id: predId, type: p.type, lag: p.lag });
    });
    _applyDepsSafely(t, out);
  } else {
    t.deps = [];
  }

  // Resurse atribuite + tip activitate
  if (!hasK(t.id)) {
    const tt = $('tiType').value;
    if (tt === 'fu') delete t.ttype; else t.ttype = tt;
    t.assign = _tiAssign.filter(a => resById(a.rid) && a.units > 0).map(a => ({ rid: a.rid, units: +a.units }));
    if (!t.assign.length) delete t.assign;
    applyTaskType(t, _tiOld.dur, _tiOld.assign);
  }

  closeTaskInfo();
  syncTabData();
  renderAll();
  toast('💾 Salvat');
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

function _msXmlEscape(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function _msXmlDate(s) {
  return s + 'T08:00:00';
}

function _buildMSProjectXML(projectName) {
  const w = wbs();
  const today = fD(new Date()) + 'T08:00:00';
  const outlineLevel = id => dep(id) + 1;

  let tasksXml = '';
  function walk(list) {
    list.forEach(t => {
      const p = ps(t);
      const isSumm = hasK(t.id);
      const finishDate = fD(p._e);
      tasksXml += `
    <Task>
      <UID>${t.id}</UID>
      <ID>${t.id}</ID>
      <Name>${_msXmlEscape(t.nm)}</Name>
      <Type>0</Type>
      <IsNull>0</IsNull>
      <CreateDate>${today}</CreateDate>
      <WBS>${_msXmlEscape(w[t.id] || '')}</WBS>
      <OutlineNumber>${_msXmlEscape(w[t.id] || '')}</OutlineNumber>
      <OutlineLevel>${outlineLevel(t.id)}</OutlineLevel>
      <Priority>500</Priority>
      <Start>${_msXmlDate(t.sd)}</Start>
      <Finish>${_msXmlDate(finishDate)}</Finish>
      <Duration>PT${t.dur * 8}H0M0S</Duration>
      <DurationFormat>7</DurationFormat>
      <Work>PT${t.dur * 8}H0M0S</Work>
      <Summary>${isSumm ? 1 : 0}</Summary>
      <Manual>1</Manual>
      <PercentComplete>${t.prog}</PercentComplete>
      <PercentWorkComplete>${t.prog}</PercentWorkComplete>${t.notes ? `
      <Notes>${_msXmlEscape(t.notes)}</Notes>` : ''}${(t.deps || []).map(d => {
        // MS Project link types: 0=FF, 1=FS, 2=SF, 3=SS
        const typeMap = { FS: 1, SS: 3, FF: 0, SF: 2 };
        const lagMin = Math.round((+d.lag || 0) * 480); // 1 zi = 480 min (8h)
        return `
      <PredecessorLink>
        <PredecessorUID>${d.id}</PredecessorUID>
        <Type>${typeMap[d.type] ?? 1}</Type>
        <CrossProject>0</CrossProject>
        <LinkLag>${lagMin}</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>`;
      }).join('')}
    </Task>`;
      walk(kids(t.id));
    });
  }
  walk(T.filter(t => !t.pid));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${_msXmlEscape(projectName)}</Name>
  <Title>${_msXmlEscape(projectName)}</Title>
  <Author>Gantt PRO</Author>
  <CreationDate>${today}</CreationDate>
  <LastSaved>${today}</LastSaved>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${today}</StartDate>
  <FYStartDate>1</FYStartDate>
  <CriticalSlackLimit>0</CriticalSlackLimit>
  <CurrencyDigits>2</CurrencyDigits>
  <CurrencySymbol>$</CurrencySymbol>
  <CurrencySymbolPosition>0</CurrencySymbolPosition>
  <CalendarUID>1</CalendarUID>
  <DefaultStartTime>08:00:00</DefaultStartTime>
  <DefaultFinishTime>17:00:00</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <NewTasksAreManual>1</NewTasksAreManual>
  <Tasks>${tasksXml}
  </Tasks>
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

  if ((e.ctrlKey || e.metaKey) && e.key === 'x' && sel) { e.preventDefault(); cutTask(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && sel) { e.preventDefault(); copyTask(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); pasteTask(); }
});
