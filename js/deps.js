// ============================================================
// DEPS.JS — Simulink-style dependency interaction
//   • Cerculet pe bară → drag → crează dependență (cu săgeată live)
//   • Drag de pe săgeată → săgeata se mișcă live cu cursorul (re-rutare)
//   • Click scurt pe săgeată → confirm modal → șterge
// ============================================================

function initDepsUI() {
  _addDepDots();
  _attachArrowDrag();
}

// ===== HELPER: marginea barei (left sau right) =====
function _getBarEdge(taskId, side) {
  side = side || 'right';
  const bar = document.querySelector(`.gb[data-bid="${taskId}"]`);
  if (!bar) return null;
  const gInner = document.querySelector('.g-inner');
  if (!gInner) return null;
  const barL = parseFloat(bar.style.left);
  // pt milestone width:auto → folosim getBoundingClientRect ca să luăm lățimea reală
  let barW = parseFloat(bar.style.width);
  if (isNaN(barW)) {
    const innerRect = gInner.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    barW = barRect.right - innerRect.left - barL;
    if (bar.classList.contains('milestone')) barW = 18;
  }
  const grow = bar.closest('.g-row');
  const rows = [...gInner.querySelectorAll('.g-row')];
  const ri = rows.indexOf(grow);
  const x = side === 'left' ? barL : (barL + barW);
  return { x, y: ri * 30 + 15 };
}

// (left/right) × (left/right) → tipul de dependență MS Project
const DEP_TYPE_FROM_SIDES = {
  'right-left':  'FS',
  'left-left':   'SS',
  'right-right': 'FF',
  'left-right':  'SF'
};

// Capătul barei țintă de sub cursor (în ~18px de margine), altfel null → meniu
function _endUnderCursor(e, bar) {
  const r = bar.getBoundingClientRect();
  if (r.width < 40) return null;
  if (e.clientX - r.left <= 18) return 'left';
  if (r.right - e.clientX <= 18) return 'right';
  return null;
}

// Pe ce jumătate a barei este cursorul (stânga/dreapta)
function _targetSideFromMouse(e, targetBar) {
  const r = targetBar.getBoundingClientRect();
  return (e.clientX < r.left + r.width / 2) ? 'left' : 'right';
}

// Floating badge cu tipul (apare lângă cursor în timpul drag-ului)
function _showTypeBadge(e, type) {
  let b = document.getElementById('depTypeBadge');
  if (!b) {
    b = document.createElement('div');
    b.id = 'depTypeBadge';
    b.className = 'dep-type-badge';
    document.body.appendChild(b);
  }
  b.textContent = type;
  b.className = 'dep-type-badge dep-type-badge-' + type.toLowerCase();
  b.style.left = (e.clientX + 14) + 'px';
  b.style.top  = (e.clientY - 24) + 'px';
  b.style.display = 'block';
}
function _hideTypeBadge() {
  const b = document.getElementById('depTypeBadge');
  if (b) b.style.display = 'none';
}

// Highlight pe jumătatea activă (anchor) a barei target
function _markTargetSide(bar, side) {
  if (!bar) return;
  bar.classList.remove('dep-target-left', 'dep-target-right');
  bar.classList.add('dep-target-' + side);
}
function _clearTargetSides() {
  document.querySelectorAll('.dep-target-left, .dep-target-right').forEach(b => {
    b.classList.remove('dep-target-left', 'dep-target-right');
  });
}

function _cursorToInner(e) {
  const gInner = document.querySelector('.g-inner');
  if (!gInner) return { x: 0, y: 0 };
  const rect = gInner.getBoundingClientRect();
  const gBody = gInner.parentElement;
  return {
    x: e.clientX - rect.left + gBody.scrollLeft,
    y: e.clientY - rect.top + gBody.scrollTop
  };
}

function _calcArrowPath(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  let d, cp2x, cp2y;
  if (dx >= 0) {
    const cp = Math.max(30, dx * 0.4);
    cp2x = toX - cp; cp2y = toY;
    d = `M${fromX} ${fromY} C${fromX + cp} ${fromY}, ${cp2x} ${cp2y}, ${toX} ${toY}`;
  } else {
    const belowY = Math.max(fromY, toY) + 40;
    cp2x = toX - 40; cp2y = belowY;
    d = `M${fromX} ${fromY} C${fromX + 40} ${belowY}, ${cp2x} ${cp2y}, ${toX} ${toY}`;
  }
  const angle = Math.atan2(toY - cp2y, toX - cp2x) * 180 / Math.PI;
  return { d, angle };
}

function _ensureLiveArrow() {
  const svg = document.querySelector('.dep-svg');
  if (!svg) return null;
  let g = svg.querySelector('#live-arrow');
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'live-arrow';
    const color = document.body.classList.contains('dark') ? '#f0a060' : '#e07850';
    g.innerHTML = `
      <path fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" id="live-path"/>
      <path d="M-6,-3.5 L0,0 L-6,3.5" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" id="live-head"/>
    `;
    svg.appendChild(g);
  }
  return g;
}

function _hideLiveArrow() {
  const g = document.querySelector('#live-arrow');
  if (g) g.remove();
}

function _updateLiveArrow(fromX, fromY, toX, toY) {
  const g = _ensureLiveArrow();
  if (!g) return;
  const { d, angle } = _calcArrowPath(fromX, fromY, toX, toY);
  g.querySelector('#live-path').setAttribute('d', d);
  g.querySelector('#live-head').setAttribute('transform', `translate(${toX},${toY}) rotate(${angle})`);
  g.style.display = '';
}

function _hideOriginalArrow(fromId, toId) {
  document.querySelectorAll(`.dep-hit[data-dep-from="${fromId}"][data-dep-to="${toId}"],
    .dep-line[data-dep-from="${fromId}"][data-dep-to="${toId}"],
    .dep-head[data-dep-from="${fromId}"][data-dep-to="${toId}"]`).forEach(el => {
    el.style.display = 'none';
  });
}

function _barUnderCursor(e, excludeId) {
  const els = document.elementsFromPoint(e.clientX, e.clientY);
  return els.find(el => el.classList && el.classList.contains('gb') && +el.dataset.bid !== excludeId) || null;
}

// ============================================================
// CERCULEȚE — DOUĂ pe fiecare bară: left (Start) + right (Finish)
// Combinația source-side + target-side determină automat tipul:
//   right→left = FS   •   left→left = SS
//   right→right = FF  •   left→right = SF
// ============================================================
function _addDepDots() {
  document.querySelectorAll('.gb.task').forEach(bar => {
    if (bar.querySelector('.dep-dot')) return;
    ['left', 'right'].forEach(side => {
      const dot = document.createElement('div');
      dot.className = 'dep-dot dep-dot-' + side;
      dot.dataset.side = side;
      dot.title = 'Trage pe altă bară pentru a crea o dependență (alegi tipul la eliberare)';
      bar.appendChild(dot);
      _attachDotDrag(dot, bar, side);
    });
  });
}

// ============================================================
// MENIU TIP DEPENDENȚĂ — apare la eliberarea mouse-ului pe bara țintă
// ============================================================
const DEP_MENU_ITEMS = [
  { type: 'FS', title: 'Final → Start', desc: 'Succesorul începe după ce se termină predecesorul' },
  { type: 'SS', title: 'Start → Start', desc: 'Încep împreună (sau cu decalaj)' },
  { type: 'FF', title: 'Final → Final', desc: 'Se termină împreună (sau cu decalaj)' },
  { type: 'SF', title: 'Start → Final', desc: 'Succesorul se termină când începe predecesorul' }
];

function closeDepMenu() {
  const m = document.getElementById('depMenu');
  if (m) m.remove();
  document.removeEventListener('keydown', _depMenuKey, true);
  document.removeEventListener('mousedown', _depMenuOutside, true);
}
function _depMenuKey(e) {
  const m = document.getElementById('depMenu'); if (!m) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDepMenu(); renderAll(); return; }
  const i = '1234'.indexOf(e.key);
  if (i >= 0) { e.preventDefault(); e.stopPropagation(); m.children[i].click(); }
}
function _depMenuOutside(e) {
  const m = document.getElementById('depMenu');
  if (m && !m.contains(e.target)) { closeDepMenu(); renderAll(); }
}

// onPick(type) e apelat cu tipul ales
function showDepMenu(e, onPick, defaultType) {
  closeDepMenu();
  const m = document.createElement('div');
  m.id = 'depMenu';
  m.className = 'dep-menu';
  DEP_MENU_ITEMS.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dep-menu-item dep-menu-' + it.type.toLowerCase();
    b.innerHTML = '<span class="dm-key">' + (i + 1) + '</span><span class="dm-type">' + it.type + '</span>' +
      '<span class="dm-txt"><b>' + it.title + '</b><small>' + it.desc + '</small></span>';
    b.addEventListener('click', ev => { ev.stopPropagation(); closeDepMenu(); onPick(it.type); });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const di = Math.max(0, DEP_MENU_ITEMS.findIndex(x => x.type === defaultType));
  m.children[di].classList.add('suggested');
  m.children[di].focus();
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(e.clientX + 8, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(e.clientY + 8, innerHeight - r.height - 8)) + 'px';
  setTimeout(() => {
    document.addEventListener('keydown', _depMenuKey, true);
    document.addEventListener('mousedown', _depMenuOutside, true);
  }, 0);
}

function _attachDotDrag(dot, bar, fromSide) {
  dot.addEventListener('mousedown', function(e) {
    e.preventDefault();
    e.stopPropagation();
    hideTip();

    const fromId = +bar.dataset.bid;
    const pt = _getBarEdge(fromId, fromSide);
    if (!pt) return;

    bar.classList.add('dep-source');
    document.body.classList.add('dep-dragging'); // afișează toate dot-urile ca ținte

    const onMove = ev => {
      const cur = _cursorToInner(ev);
      _updateLiveArrow(pt.x, pt.y, cur.x, cur.y);
      document.querySelectorAll('.dep-hover').forEach(b => b.classList.remove('dep-hover'));
      _clearTargetSides();
      _hideTypeBadge();
      const tgt = _barUnderCursor(ev, fromId);
      if (tgt && tgt.classList.contains('task')) {
        tgt.classList.add('dep-hover');
        const toSide = _endUnderCursor(ev, tgt);
        if (toSide) {
          _markTargetSide(tgt, toSide);
          _showTypeBadge(ev, DEP_TYPE_FROM_SIDES[fromSide + '-' + toSide]);
        }
      }
    };

    const onUp = ev => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _hideLiveArrow();
      _hideTypeBadge();
      _clearTargetSides();
      bar.classList.remove('dep-source');
      document.body.classList.remove('dep-dragging');
      document.querySelectorAll('.dep-hover').forEach(b => b.classList.remove('dep-hover'));

      const tgt = _barUnderCursor(ev, fromId);
      if (!tgt || !tgt.classList.contains('task')) { renderAll(); return; }

      const toId = +tgt.dataset.bid;
      const toTask = T.find(x => x.id === toId);
      if (!toTask) return;
      if (!toTask.deps) toTask.deps = [];

      if (toTask.deps.some(d => d.id === fromId)) {
        toast('⚠️ Deja există');
        return;
      }
      if (wouldCreateCycle(fromId, toId)) {
        toast('🚫 Ciclu detectat — legătură respinsă');
        return;
      }

      const create = type => {
        if (toTask.deps.some(d => d.id === fromId)) return;
        pushHistory();
        toTask.deps.push({ id: fromId, type, lag: 0 });
        syncTabData();
        renderAll();
        const w = wbs();
        toast('🔗 ' + (w[fromId] || '?') + ' → ' + (w[toId] || '?') + ' (' + type + ')');
      };
      const toSide = _endUnderCursor(ev, tgt);
      if (toSide) create(DEP_TYPE_FROM_SIDES[fromSide + '-' + toSide]);
      else showDepMenu(ev, create, fromSide === 'left' ? 'SS' : 'FS');
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ============================================================
// SĂGEȚI — drag = re-rutare live, click = ștergere
// ============================================================
function _attachArrowDrag() {
  document.querySelectorAll('.dep-hit, .dep-head').forEach(el => {
    el.style.cursor = 'grab';

    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      hideTip();

      const fromId = +this.dataset.depFrom;
      const toId = +this.dataset.depTo;
      const sx = e.clientX, sy = e.clientY;
      let didDrag = false;
      let pt = null;

      // Determină fromSide pe baza tipului curent al legăturii
      const toTaskCur = T.find(x => x.id === toId);
      const curLink = toTaskCur && toTaskCur.deps ? toTaskCur.deps.find(d => d.id === fromId) : null;
      const curType = curLink ? curLink.type : 'FS';
      const fromSide = (curType === 'SS' || curType === 'SF') ? 'left' : 'right';

      const onMove = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;

        if (!didDrag) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          didDrag = true;
          pt = _getBarEdge(fromId, fromSide);
          if (!pt) return;
          _hideOriginalArrow(fromId, toId);
          const srcBar = document.querySelector(`.gb[data-bid="${fromId}"]`);
          if (srcBar) srcBar.classList.add('dep-source');
          document.body.classList.add('dep-dragging');
        }

        if (!pt) return;

        const cur = _cursorToInner(ev);
        _updateLiveArrow(pt.x, pt.y, cur.x, cur.y);
        document.querySelectorAll('.dep-hover').forEach(b => b.classList.remove('dep-hover'));
        const tgt = _barUnderCursor(ev, fromId);
        if (tgt && tgt.classList.contains('task')) tgt.classList.add('dep-hover');
      };

      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        _hideLiveArrow();
        _hideTypeBadge();
        _clearTargetSides();
        document.body.classList.remove('dep-dragging');
        document.querySelectorAll('.dep-source').forEach(b => b.classList.remove('dep-source'));
        document.querySelectorAll('.dep-hover').forEach(b => b.classList.remove('dep-hover'));

        if (!didDrag) {
          // Click scurt → edit (tip + lag + delete)
          openDepEditor(fromId, toId);
          return;
        }

        // Drag terminat — mută dependența + ACTUALIZEAZĂ tipul în funcție de noile anchor-uri
        const tgt = _barUnderCursor(ev, fromId);
        if (tgt && tgt.classList.contains('task')) {
          const newToId = +tgt.dataset.bid;
          const newType = curType;

          pushHistory();

          // Preluăm linkul vechi (păstrăm doar lag-ul; tipul se recalculează din noile anchor-uri)
          let oldLag = 0;
          const oldTask = T.find(x => x.id === toId);
          if (oldTask && oldTask.deps) {
            const old = oldTask.deps.find(d => d.id === fromId);
            if (old) oldLag = old.lag || 0;
            oldTask.deps = oldTask.deps.filter(d => d.id !== fromId);
          }

          if (wouldCreateCycle(fromId, newToId)) {
            // Rulăm back: restaurăm linkul vechi
            if (oldTask) oldTask.deps.push({ id: fromId, type: curType, lag: oldLag });
            toast('🚫 Ciclu detectat — mutare respinsă');
          } else {
            const newTask = T.find(x => x.id === newToId);
            if (newTask) {
              if (!newTask.deps) newTask.deps = [];
              if (!newTask.deps.some(d => d.id === fromId)) {
                newTask.deps.push({ id: fromId, type: newType, lag: oldLag });
              }
            }
            const w = wbs();
            const movedOrRetyped = (newToId !== toId) ? '↗️ Mutat' : '🔄 Tip actualizat';
            toast(movedOrRetyped + ': ' + (w[fromId] || '?') + ' → ' + (w[newToId] || '?') + ' (' + newType + ')');
          }
          syncTabData();
        }

        renderAll();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ============================================================
// MODAL EDIT DEPENDENȚĂ — tip (FS/SS/FF/SF) + lag (± zile) + delete
// ============================================================
function openDepEditor(fromId, toId) {
  const toTask = T.find(x => x.id === toId); if (!toTask || !toTask.deps) return;
  const link = toTask.deps.find(d => d.id === fromId); if (!link) return;
  const w = wbs();
  const label = (w[fromId] || fromId) + ' → ' + (w[toId] || toId);

  const overlay = $('depEditModal'); if (!overlay) return;
  $('depEditTitle').textContent = label;
  $('depEditLag').value = link.lag || 0;

  document.querySelectorAll('#depEditModal .dep-type-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === link.type);
  });

  overlay.classList.add('open');

  ['depEditSave','depEditDel','depEditCancel'].forEach(id => {
    const el = $(id); const nw = el.cloneNode(true);
    el.parentNode.replaceChild(nw, el); nw.id = id;
  });
  document.querySelectorAll('#depEditModal .dep-type-opt').forEach(btn => {
    const nb = btn.cloneNode(true); btn.parentNode.replaceChild(nb, btn);
    nb.addEventListener('click', () => {
      document.querySelectorAll('#depEditModal .dep-type-opt').forEach(b => b.classList.remove('active'));
      nb.classList.add('active');
    });
  });

  $('depEditCancel').addEventListener('click', closeDepEditor);
  $('depEditSave').addEventListener('click', () => {
    const activeBtn = document.querySelector('#depEditModal .dep-type-opt.active');
    const newType = activeBtn ? activeBtn.dataset.type : link.type;
    const newLag  = parseFloat($('depEditLag').value) || 0;
    pushHistory();
    link.type = newType; link.lag = newLag;
    closeDepEditor(); syncTabData(); renderAll();
    toast('💾 ' + label + ' (' + depLabel(link) + ')');
  });
  $('depEditDel').addEventListener('click', () => {
    pushHistory();
    toTask.deps = toTask.deps.filter(d => d.id !== fromId);
    closeDepEditor(); syncTabData(); renderAll();
    toast('🗑️ Șters: ' + label);
  });
}

function closeDepEditor() {
  const overlay = $('depEditModal'); if (overlay) overlay.classList.remove('open');
}
