let tipTimer = null;
const _tc = document.createElement('canvas').getContext('2d');
function _textW(s, font){ _tc.font = font; return _tc.measureText(s).width; }

// ---- Numele activității în bară: complet dacă încape, altfel nume scurt / prescurtare automată ----
const _FILLER_WORDS = new Set(['si','și','de','la','pentru','in','în','cu','a','al','ale','din','pe','sau','un','o','lui']);
let _barFont = '';
function barLabel(t, avail) {
  if (avail < 22) return '';
  if (!_barFont) _barFont = '700 12px ' + getComputedStyle(document.body).fontFamily;
  const fits = s => _textW(s, _barFont) <= avail;
  if (fits(t.nm)) return t.nm;
  const sn = (t.sn || '').trim();
  if (sn && fits(sn)) return sn;
  // prescurtare automată: scoatem cuvintele de legătură și păstrăm cât încape din primele cuvinte
  const keep = t.nm.split(/\s+/).filter((w, i) => w && (i === 0 || !_FILLER_WORDS.has(w.toLowerCase())));
  let out = '', used = 0;
  for (const w of keep) {
    const c = out ? out + ' ' + w : w;
    if (fits(c + (used + 1 < keep.length ? '…' : ''))) { out = c; used++; } else break;
  }
  if (used === keep.length && out) return out;
  if (used > 0) return out + '…';
  let s = keep[0] || t.nm;   // nici primul cuvânt nu încape: îl tăiem
  while (s.length > 2 && !fits(s + '…')) s = s.slice(0, -1);
  return s.length > 2 ? s + '…' : '';
}

// ============================================================
// Rutare ortogonală (Manhattan) pentru săgețile de dependență
// ============================================================
// fromDir / toDir: +1 (ieșire/intrare pe dreapta), -1 (pe stânga).
// Rezultatul este un array de puncte [[x,y], ...] care formează un
// traseu numai cu segmente orizontale/verticale. Colțurile sunt
// rotunjite ulterior de `_roundedPolyPath`.
function _buildOrthoPoints(fromX, fromY, fromDir, toX, toY, toDir, pad, rowH) {
  const exitX  = fromX + fromDir * pad;
  const entryX = toX   + toDir   * pad;

  // Dacă start și target sunt pe același rând, un segment orizontal simplu
  if (fromY === toY) {
    // Cu excepția cazului când direcțiile se contrazic — atunci ocolim pe sub
    if ((fromDir === +1 && toX > fromX && toDir === -1) ||
        (fromDir === -1 && toX < fromX && toDir === +1)) {
      return [[fromX,fromY],[toX,toY]];
    }
    const detour = fromY + rowH * 0.6;
    return [[fromX,fromY],[exitX,fromY],[exitX,detour],[entryX,detour],[entryX,toY],[toX,toY]];
  }

  // Cazuri în funcție de combinația de direcții
  // 1) fromDir=+1, toDir=-1  (FS tipic)
  if (fromDir === +1 && toDir === -1) {
    // Bare lipite (fără/aproape fără decalaj): ieșim din marginea de jos/sus a predecesorului
    const gap = toX - fromX;
    if (gap < pad * 2) {
      const midY = fromY + (toY > fromY ? 1 : -1) * rowH / 2, inX = Math.min(toX - 20, fromX + 6);
      return [[fromX,fromY],[fromX+6,fromY],[fromX+6,midY],[inX,midY],[inX,toY],[toX-2,toY]];
    }
    if (exitX <= entryX) {
      // Spațiu suficient — L în trei segmente (H-V-H) cu cot la mijloc
      const midX = (exitX + entryX) / 2;
      return [[fromX,fromY],[midX,fromY],[midX,toY],[toX,toY]];
    }
    // Target în spate — ocolim pe sub rândul mai de jos
    const detour = Math.max(fromY, toY) + rowH * 0.55;
    return [[fromX,fromY],[exitX,fromY],[exitX,detour],[entryX,detour],[entryX,toY],[toX,toY]];
  }

  // 2) fromDir=-1, toDir=+1  (SF — rar)
  if (fromDir === -1 && toDir === +1) {
    if (exitX >= entryX) {
      const midX = (exitX + entryX) / 2;
      return [[fromX,fromY],[midX,fromY],[midX,toY],[toX,toY]];
    }
    const detour = Math.max(fromY, toY) + rowH * 0.55;
    return [[fromX,fromY],[exitX,fromY],[exitX,detour],[entryX,detour],[entryX,toY],[toX,toY]];
  }

  // 3) fromDir=-1, toDir=-1  (SS) — amândouă ies pe stânga
  if (fromDir === -1 && toDir === -1) {
    const leftX = Math.min(exitX, entryX);
    return [[fromX,fromY],[leftX,fromY],[leftX,toY],[toX,toY]];
  }

  // 4) fromDir=+1, toDir=+1  (FF) — amândouă ies pe dreapta
  const rightX = Math.max(exitX, entryX);
  return [[fromX,fromY],[rightX,fromY],[rightX,toY],[toX,toY]];
}

// Convertește o polilinie în path SVG cu colțuri rotunjite (quadratic Bézier)
function _roundedPolyPath(points, r) {
  if (!points || points.length < 2) return '';
  if (points.length === 2) return `M${points[0][0]} ${points[0][1]} L${points[1][0]} ${points[1][1]}`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i-1], cur = points[i], next = points[i+1];
    const d1x = cur[0]-prev[0], d1y = cur[1]-prev[1];
    const d2x = next[0]-cur[0], d2y = next[1]-cur[1];
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    const rr = Math.min(r, l1/2, l2/2);
    if (rr <= 0.5 || l1 === 0 || l2 === 0) { d += ` L${cur[0]} ${cur[1]}`; continue; }
    const bx = cur[0] - (d1x/l1)*rr, by = cur[1] - (d1y/l1)*rr;
    const ax = cur[0] + (d2x/l2)*rr, ay = cur[1] + (d2y/l2)*rr;
    d += ` L${bx} ${by} Q${cur[0]} ${cur[1]} ${ax} ${ay}`;
  }
  const last = points[points.length-1];
  return d + ` L${last[0]} ${last[1]}`;
}

// Alege un punct bun pentru label — pe mijlocul segmentului vertical cel mai lung,
// evitând primii/ultimii CORNER_GAP pixeli (acolo sunt colțurile barelor cu dep-dots).
// Dacă segmentul e prea scurt pentru gap, cade înapoi pe mijlocul geometric.
function _labelAnchor(points) {
  // Eticheta stă pe mijlocul celui mai lung segment (vertical sau orizontal), departe de capete
  let bestLen = 0, best = null;
  for (let i = 1; i < points.length; i++) {
    const [x1,y1] = points[i-1], [x2,y2] = points[i];
    const len = Math.abs(x2 - x1) + Math.abs(y2 - y1), vert = x1 === x2;
    if (len > bestLen + (vert ? -0.01 : 6)) { bestLen = len; best = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }; }
  }
  return best || { x: (points[0][0] + points[points.length-1][0]) / 2, y: points[0][1] - 6 };
}

// Pune accent pe toate săgețile care ating un task (celelalte se estompează)
function focusDepsFor(id) {
  const svg = document.querySelector('.dep-svg'); if (!svg) return;
  svg.classList.add('has-focus');
  svg.querySelectorAll('.dep-group').forEach(g => {
    const touches = +g.dataset.depFrom === id || +g.dataset.depTo === id;
    g.classList.toggle('dep-focused', touches);
  });
}
function unfocusDeps() {
  const svg = document.querySelector('.dep-svg'); if (!svg) return;
  svg.classList.remove('has-focus');
  svg.querySelectorAll('.dep-group').forEach(g => g.classList.remove('dep-focused'));
  if (sel) focusDepsFor(sel); // activitatea selectată rămâne evidențiată
}

function showTip(e,t){
  clearTimeout(tipTimer);
  const p=ps(t), dp=dep(t.id), tip=$("tip"), colors=["var(--accent)","var(--blue)","var(--purple)","var(--amber)"];
  const c = colors[Math.min(dp,3)];
  const w2 = wbs();
  const depList = (t.deps||[]).map(d => (w2[d.id] || '?') + (d.type !== 'FS' || d.lag ? ' ['+depLabel(d)+']' : '')).join(', ') || '—';
  tip.innerHTML=`
    <div class="tip-name" style="color:${c}">${esc(t.nm)}</div>
    <div class="tip-row"><span class="tip-label">Durată:</span><span class="tip-val">${t.dur} zile</span></div>
    <div class="tip-row"><span class="tip-label">Start:</span><span class="tip-val">${fmtDate(p._s)}</span></div>
    <div class="tip-row"><span class="tip-label">Final:</span><span class="tip-val">${fmtDate(p._e)}</span></div>
    <div class="tip-row"><span class="tip-label">Se face după:</span><span class="tip-val">${depList}</span></div>
    ${cpm[t.id]?`<div class="tip-row"><span class="tip-label">Rezervă:</span><span class="tip-val" style="${cpm[t.id].crit?'color:#d94040;font-weight:800':''}">${cpm[t.id].crit?'0 zile · CRITIC':cpm[t.id].float+' zile'}</span></div>`:''}
    <div class="tip-row">
      <span class="tip-label">Progres:</span>
      <span style="background:${c};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:800;display:inline-block">${t.prog}%</span>
    </div>
    <div class="tip-prog-container">
      <div class="tip-prog-fill" style="width:${t.prog}%;background:${c}"></div>
    </div>
  `;
  tip.style.left=Math.min(e.clientX+16, innerWidth-240)+"px";
  tip.style.top=Math.min(e.clientY+16, innerHeight-180)+"px";
  tip.classList.add("show");
}

function hideTip(){clearTimeout(tipTimer);tipTimer=null;$("tip").classList.remove("show")}

function showCtx(e,id){
  e.preventDefault(); hideTip();
  sel=id; renderAll(); const t=T.find(x=>x.id===id); if(!t) return;
  const hasPar=!!t.pid; let h="";
  h+='<div class="ctx-item" onclick="openTaskInfo('+id+');closeCtx()">ⓘ Detalii (Task Info)</div>';
  h+='<div class="ctx-sep"></div>';
  h+='<div class="ctx-item" onclick="cutTask();closeCtx()">✂️ Tăiat (Ctrl+X)</div>';
  h+='<div class="ctx-item" onclick="copyTask();closeCtx()">📋 Copiat (Ctrl+C)</div>';
  h+='<div class="ctx-item" onclick="pasteTask();closeCtx()">📎 Lipit (Ctrl+V)</div>';
  h+='<div class="ctx-sep"></div>';
  h+='<div class="ctx-item" onclick="indentSel();closeCtx()">→ Indent</div>';
  if(hasPar) h+='<div class="ctx-item" onclick="outdentSel();closeCtx()">← Outdent</div>';
  h+='<div class="ctx-item" onclick="moveSel(-1);closeCtx()">↑ Muta sus</div>';
  h+='<div class="ctx-item" onclick="moveSel(1);closeCtx()">↓ Muta jos</div>';
  h+='<div class="ctx-sep"></div>';
  if(hasPar) h+='<div class="ctx-item" onclick="upd('+id+',\'pid\',null);closeCtx()">⇱ Desprinde de capitol</div>';
  h+='<div class="ctx-item" onclick="unlinkSelected();closeCtx()">🔓 Șterge link-uri</div>';
  h+='<div class="ctx-item danger" onclick="delSel();closeCtx()">✕ Sterge</div>';
  const ctx=$("ctx");
  ctx.innerHTML=h;
  ctx.style.left=Math.min(e.clientX,innerWidth-220)+"px";
  ctx.style.top=Math.min(e.clientY,innerHeight-340)+"px";
  ctx.classList.add("open");
}
function closeCtx(){$("ctx").classList.remove("open")}
document.addEventListener("click",closeCtx);

function startBarEdit(bar,t){
  hideTip();
  const rect=bar.getBoundingClientRect(), input=document.createElement("input");
  input.className="bar-edit"; input.value=t.nm;
  input.style.left=rect.left+"px"; input.style.top=(rect.top-2)+"px";
  input.style.width=Math.max(rect.width,120)+"px"; input.style.height=(rect.height+4)+"px";
  document.body.appendChild(input); input.focus(); input.select();
  function done(){if(!input.parentNode)return; t.nm=input.value.trim()||t.nm; document.body.removeChild(input); renderAll()}
  input.addEventListener("blur",done);
  input.addEventListener("keydown",e=>{
    if(e.key==="Enter") done();
    if(e.key==="Escape") document.body.removeChild(input);
  });
}

function highlightRow(id){
  document.querySelectorAll("[data-tid]").forEach(r=>r.classList.toggle("hovered",+r.dataset.tid===id));
  document.querySelectorAll("[data-gid]").forEach(r=>r.classList.toggle("hovered",+r.dataset.gid===id));
}
function clearHighlight(){
  document.querySelectorAll(".hovered").forEach(r=>r.classList.remove("hovered"));
}

const C=[
  {k:"wbs", l:"WBS",       w:44},
  {k:"nm",  l:"Activitate", w:142},
  {k:"dur", l:"Zile",       w:46},
  {k:"sd",  l:"Start",      w:112},
  {k:"ed",  l:"Final",      w:112},
  {k:"prog",l:"%",          w:38},
  {k:"deps",l:"După",       w:54}
];
// Coloane EXTRA afișate doar când panel-ul e expanded (clase CSS gestionează vizibilitatea)
const CX=[
  {k:"var",   l:"Δ bază",  w:62, cls:"col-var"},
  {k:"cost",  l:"Cost",    w:92, cls:"col-cost"},
  {k:"status",l:"Status",  w:80, cls:"col-status"},
  {k:"id",    l:"ID",      w:40, cls:"col-id"}
];

// Lățimi coloane salvate (redimensionate de utilizator)
(function loadColWidths(){
  try {
    const s = JSON.parse(localStorage.getItem("ganttColW") || "{}");
    [...C, ...CX].forEach(c => { if (s[c.k] >= 24) c.w = s[c.k]; });
  } catch(e) {}
})();

function renderTH(){
  let h="";
  C.forEach((c,i)=>h+='<div class="th" style="width:'+c.w+'px;min-width:'+c.w+'px">'+c.l+'<span class="col-rs" data-ci="'+i+'"></span></div>');
  CX.forEach((c,i)=>h+='<div class="th '+c.cls+'" style="width:'+c.w+'px;min-width:'+c.w+'px">'+c.l+'<span class="col-rs" data-ci="'+(C.length+i)+'"></span></div>');
  $("thRow").innerHTML=h;
}

// Redimensionare coloane: trage de marginea dreaptă a header-ului
$("thRow").addEventListener("mousedown", e => {
  const handle = e.target.closest(".col-rs"); if (!handle) return;
  e.preventDefault(); e.stopPropagation();
  const all = [...C, ...CX], col = all[+handle.dataset.ci];
  const startX = e.clientX, startW = col.w, idx = +handle.dataset.ci + 1;
  const pane = $("paneL");
  document.body.style.cursor = "col-resize";
  const mv = ev => {
    col.w = Math.max(30, startW + ev.clientX - startX);
    const css = col.w + "px";
    document.querySelectorAll("#thRow > .th:nth-child(" + idx + "), #tBody .t-row > .c:nth-child(" + idx + ")")
      .forEach(el => { el.style.width = css; el.style.minWidth = css; });
    // Panoul crește ca să încapă coloanele (până la 70% din fereastră)
    {
      const visible = pane.classList.contains("expanded") ? all : all.slice(0, C.length);
      const total = visible.reduce((s,c) => s + c.w, 0);
      if (total > pane.offsetWidth) pane.style.width = Math.min(total + 8, innerWidth * 0.88) + "px";
    }
  };
  const up = () => {
    document.removeEventListener("mousemove", mv);
    document.removeEventListener("mouseup", up);
    document.body.style.cursor = "";
    try {
      const s = {}; all.forEach(c => s[c.k] = c.w);
      localStorage.setItem("ganttColW", JSON.stringify(s));
    } catch(e) {}
    if (isAutoZoom) renderGantt();
  };
  document.addEventListener("mousemove", mv);
  document.addEventListener("mouseup", up);
});

// Status derivat automat din dată+progres
function _statusOf(t){
  const isSumm = hasK(t.id);
  if (t.prog >= 100) return {k:'done', lbl:'✓ Done'};
  if (isSumm) return {k:'wip', lbl:'🗂 Capitol'};
  const today = new Date();
  const start = pD(t.sd);
  const end = endDate(t);
  if (today > end && t.prog < 100) return {k:'late', lbl:'⚠ Întârziat'};
  if (today >= start && t.prog > 0) return {k:'wip', lbl:'⏱ În lucru'};
  if (today >= start && t.prog === 0) return {k:'todo', lbl:'○ De start'};
  return {k:'todo', lbl:'📅 Planificat'};
}

function renderTBody(){
  const o=flat(), w=wbs();
  if(!o.length){
    $("tBody").innerHTML='<div style="padding:20px;color:var(--muted);text-align:center;font-weight:700">Proiect gol — apasă <b>+ Activitate</b> sau <b>+ Capitol</b> ca să începi.</div>';
    return;
  }
  let h="";
  o.forEach(t=>{
    const p=ps(t), dp=Math.min(dep(t.id),3), isSumm=hasK(t.id), isCol=coll.has(t.id), indent=dep(t.id)*18;
    const isMs = !!t.isMilestone && !isSumm;
    const ci = isSumm
      ? '<span class="cico" onclick="event.stopPropagation();toggleC('+t.id+')">'+(isCol?"▶":"▼")+'</span>'
      : '<span style="width:16px;display:inline-block"></span>';
    const dis = isSumm ? "disabled" : "";

    // handler comun pentru Enter/Escape pe inputuri
    // Enter = confirmă (blur declanșează onchange dacă valoarea s-a schimbat); Escape = anulează
    const onkeyNm  = `onkeydown="if(event.key==='Enter'){this.blur()}if(event.key==='Escape'){renderAll()}"`;
    const onkeyNum = `onkeydown="if(event.key==='Enter'){this.blur()}if(event.key==='Escape'){renderAll()}"`;

    h += '<div class="t-row dp'+dp+(sel===t.id?" selected":"")+(isSumm?" summ":"")+(isMs?" milestone":"")+(!isSumm&&isCrit(t.id)?" crit":"")+'"'
       + ' data-tid="'+t.id+'" draggable="true"'
       + ' onclick="selTask('+t.id+')"'
       + ' ondblclick="event.stopPropagation();if(!event.target.closest(\'input\'))openTaskInfo('+t.id+')"'
       + ' oncontextmenu="showCtx(event,'+t.id+')"'
       + ' onmouseenter="highlightRow('+t.id+')"'
       + ' onmouseleave="clearHighlight()">';

    // WBS
    h += '<div class="c c-wbs" style="width:'+C[0].w+'px;min-width:'+C[0].w+'px">'+(w[t.id]||"")+'</div>';

    // Nume — folder icon pt capitole, dot pt task-uri
    const marker = isSumm
      ? '<span class="folder-ico">'+(isCol?'📁':'📂')+'</span>'
      : '<span class="tdot"></span>';
    h += '<div class="c c-name" style="width:'+C[1].w+'px;min-width:'+C[1].w+'px">'
       + '<span class="ipad" style="width:'+indent+'px"></span>'+ci+marker+(t.notes&&t.notes.trim()?'<span class="note-ico" title="'+esc(t.notes).replace(/"/g,'&quot;')+'" onclick="event.stopPropagation();openTaskInfo('+t.id+')">📝</span>':'')
       + '<input value="'+esc(t.nm)+'"'
       + ' onchange="commitName('+t.id+',this.value)"'
       + ' '+onkeyNm
       + ' onclick="event.stopPropagation()" ondblclick="event.stopPropagation()">'
       + '</div>';

    // Zile
    h += '<div class="c" style="width:'+C[2].w+'px;min-width:'+C[2].w+'px">'
       + '<input type="number" min="1" value="'+t.dur+'" style="width:42px" '+dis
       + ' onchange="upd('+t.id+',\'dur\',this.value)"'
       + ' '+onkeyNum
       + ' onclick="event.stopPropagation()" ondblclick="event.stopPropagation()">'
       + '</div>';

    // Start
    h += '<div class="c" style="width:'+C[3].w+'px;min-width:'+C[3].w+'px">'
       + dtField(t.sd, {dis:isSumm, onchange:"upd("+t.id+",'sd',this.value)"})
       + '</div>';

    // Final
    h += '<div class="c" style="width:'+C[4].w+'px;min-width:'+C[4].w+'px">'
       + dtField(fD(p._e), {dis:isSumm, onchange:"upd("+t.id+",'ed',this.value)"})
       + '</div>';

    // Progres
    h += '<div class="c" style="width:'+C[5].w+'px;min-width:'+C[5].w+'px">'
       + '<input type="number" min="0" max="100" value="'+t.prog+'" style="width:36px" '+dis
       + ' onchange="upd('+t.id+',\'prog\',this.value)"'
       + ' '+onkeyNum
       + ' onclick="event.stopPropagation()" ondblclick="event.stopPropagation()">'
       + '</div>';

    // „Se face după" — afișează doar numărul (cu tooltip pentru WBS-urile complete)
    const depCount = (t.deps || []).length;
    const depsWbs  = (t.deps || []).map(d => (w[d.id] || '?') + (d.type !== 'FS' || d.lag ? depLabel(d) : '')).join('; ');
    const depCountLbl = depCount || '—';
    h += '<div class="c" style="width:'+C[6].w+'px;min-width:'+C[6].w+'px;justify-content:center">'
       + '<span class="dep-count" title="'+esc(depsWbs||'Fără predecesori')+'" '
       + 'style="font-weight:800;font-size:11px;color:'+(depCount?'var(--accent)':'var(--muted)')+'">'
       + depCountLbl + '</span></div>';

    // ===== COLOANE EXTRA (vizibile doar când .pane-l.expanded) =====

    // Variație față de linia de bază (zile calendaristice)
    const vd = varDays(t);
    h += '<div class="c col-var" style="width:'+CX[0].w+'px;min-width:'+CX[0].w+'px;justify-content:center;font-size:11px;font-weight:800;color:'+(vd>0?'#d94040':(vd<0?'#2f9e6a':'var(--muted)'))+'">'
       + (vd===null?'—':(vd===0?'0':(vd>0?'+':'')+vd)) + '</div>';

    // Cost (din resursele atribuite; la capitole = suma copiilor)
    const cc = costMap[t.id] || 0;
    h += '<div class="c col-cost" style="width:'+CX[1].w+'px;min-width:'+CX[1].w+'px;justify-content:flex-end;font-size:11px;font-weight:700;color:'+(cc?'var(--text)':'var(--muted)')+'">'
       + (cc?fmtMoney(cc):'—') + '</div>';

    // Status
    const st = _statusOf(t);
    h += '<div class="c col-status" style="width:'+CX[2].w+'px;min-width:'+CX[2].w+'px;justify-content:center">'
       + '<span class="status-badge '+st.k+'">'+st.lbl+'</span>'
       + '</div>';

    // ID intern
    h += '<div class="c col-id" style="width:'+CX[3].w+'px;min-width:'+CX[3].w+'px;justify-content:center;color:var(--muted);font-size:10px;font-weight:700">'
       + '#'+t.id
       + '</div>';

    h += '</div>';
  });
  $("tBody").innerHTML=h;
  attachDnD(".t-row[data-tid]","tid","t-row");
}

function commitName(id, v){
  const t=T.find(x=>x.id===id); if(!t) return;
  v=v.trim(); if(!v||v===t.nm){ renderAll(); return; }
  pushHistory(); t.nm=v; syncTabData(); renderAll();
}

function attachDnD(sel2,attr,cls){
  let dragId=null;
  document.querySelectorAll(sel2).forEach(row=>{
    const tid=+row.dataset[attr];
    row.addEventListener("dragstart",e=>{
      dragId=tid; e.dataTransfer.effectAllowed="move";
      e.dataTransfer.setData("text/plain",String(dragId)); row.style.opacity=".35";
    });
    row.addEventListener("dragend",()=>{row.style.opacity=""; clearDI(cls); dragId=null;});
    row.addEventListener("dragover",e=>{
      e.preventDefault(); if(!dragId||dragId===tid||isD(tid,dragId)) return; clearDI(cls);
      const rect=row.getBoundingClientRect(), y=e.clientY-rect.top;
      let dt=y<rect.height*.25?"above":(y>rect.height*.75?"below":"inside");
      row.dataset.drop=dt; row.classList.add("drop-"+dt);
    });
    row.addEventListener("dragleave",e=>{if(!row.contains(e.relatedTarget)) clearDI(cls);});
    row.addEventListener("drop",e=>{
      e.preventDefault(); e.stopPropagation();
      handleDrop(dragId,tid,row.dataset.drop); clearDI(cls); dragId=null;
    });
  });
}
function clearDI(cls){document.querySelectorAll("."+cls).forEach(r=>r.classList.remove("drop-above","drop-below","drop-inside"))}

function renderGantt(){
  const o=flat(); if(!o.length){$("gHead").innerHTML=""; $("gBody").innerHTML=""; return;}
  const b=ab(), cs=aD(b.mn,-3), ce=aD(b.mx,5), td=dD(cs,ce)+1;

  // Spațiu la capăt = cât ocupă cea mai lungă etichetă a activităților care se termină spre final
  const lastDays=Math.max(3,Math.round(td*0.1));
  let tailW=50;
  o.forEach(t=>{
    const endsLate=dD(ps(t)._e,ce)<=lastDays+5; if(!endsLate) return;
    const shown=t.nm.length>20?t.nm.slice(0,19)+'…':t.nm;
    const lw=hasK(t.id)?_textW(shown,'800 11px Nunito')+(t.prog>0?50:12)+10:(t.isMilestone?_textW(t.nm,'700 11px Nunito')+34:50);
    if(lw>tailW) tailW=lw;
  });
  tailW=Math.min(240,Math.round(tailW));
  let dw;
  if(isAutoZoom){
    const paneL=document.getElementById("paneL");
    const availW=window.innerWidth-(paneL?paneL.offsetWidth:540)-6-17-tailW;
    let best=availW/td;
    best=Math.max(1.2,Math.min(best,120));
    zoomLevel=Math.round((best/30)*100);
    document.documentElement.style.setProperty("--day-w",best+"px");
    dw=best;
    $("gBody").classList.remove("manual-zoom");
    const zl=$("zoomLbl"); if(zl) zl.textContent=zoomLevel+"% (Auto)";
  } else {
    dw=+getComputedStyle(document.documentElement).getPropertyValue("--day-w").replace("px","")||30;
    $("gBody").classList.add("manual-zoom");
    const zl=$("zoomLbl"); if(zl) zl.textContent=zoomLevel+"%";
  }

  ["gBody","gHead"].forEach(id=>$(id).classList.toggle("zoom-tiny",dw<7));
  const tw=td*dw;
  let mons=[], cm=null;
  for(let i=0;i<td;i++){
    const d=aD(cs,i), k=d.getFullYear()+"-"+d.getMonth();
    if(!cm||cm.k!==k){cm={k,l:MN(d)+" "+d.getFullYear(),ds:[]};mons.push(cm)}
    cm.ds.push(d);
  }

  let hm="", hd="";
  mons.forEach(m=>{
    const mw=m.ds.length*dw, mlab=mw>=64?m.l:(mw>=26?MN(m.ds[0]):'');
    hm+='<div class="hc mo" style="width:'+mw+'px;min-width:'+mw+'px">'+mlab+'</div>';
    m.ds.forEach(d=>{
      // Ascundem/rariem numerele zilelor la zoom mic
      const showNum  = dw >= 18;
      const showFull = dw >= 24;
      const label    = !showNum ? '' : (showFull ? d.getDate() : (d.getDate()%2===0 ? d.getDate() : ''));
      const fs       = Math.max(7, Math.min(10, dw-4));
      hd+='<div class="hc dy'+(isOff(d)?" we":"")+(fD(d)===todayStr?" today":"")+'"'
        + ' style="width:'+dw+'px;min-width:'+dw+'px;font-size:'+fs+'px">'+label+'</div>';
    });
  });

  $("gHead").innerHTML=`<div style="width:${tw}px"><div class="g-head-row">${hm}</div><div class="g-head-row">${hd}</div></div>`;

  let grid="";
  for(let i=0;i<td;i++){
    const d=aD(cs,i);
    const off=isOff(d);
    grid+='<div class="vl '+(fD(d)===todayStr?"today ":"")+(off?"we":"")+'" style="left:'+i*dw+'px'+(off&&dw>=12?';width:'+dw+'px':'')+'"></div>';
    if(fD(d)===todayStr) grid+='<div class="today-flag" style="left:'+(i*dw+dw/2)+'px" title="Ziua de azi">Azi</div>';
  }

  // Map id → row index pt deps
  const idxMap={}; o.forEach((t,i)=>idxMap[t.id]=i);

  const wbsMap=wbs();
  let rows="";
  o.forEach(t=>{
    const p=ps(t), dp=Math.min(dep(t.id),3), isSumm=hasK(t.id), isMs=!!t.isMilestone && !isSumm;
    const off=dD(cs,p._s), w=Math.max(calSpan(t)*dw,dw), l=off*dw;
    const sc=sel===t.id?"selected":"", ac=sel===t.id?" active":"", bc=isMs?"milestone":(isSumm?"summ":"task");
    let bi="";
    if(isMs){
      // Milestone: doar diamant + nume lângă
      bi+=`<div class="ms-diamond"></div><span class="ms-name">${esc(t.nm)}</span>`;
    } else if(!isSumm){
      // Progres cu text % INTEGRAT la finalul fill-ului (fără pill extern)
      // Textul se ascunde automat dacă bara e prea îngustă (via CSS)
      // Numele se prescurtează automat ca să încapă în bară (niciodată numărul rândului)
      const showPct = t.prog>0 && w>=110;
      const lbl = barLabel(t, w - 20 - (showPct?38:0));
      bi+=`<div class="bp" style="width:${t.prog}%"></div>`;
      if(lbl) bi+=`<div class="bn dp${dp}"${showPct?' style="padding-right:38px"':''}>${esc(lbl)}</div>`;
      if(showPct) bi+=`<span class="bp-pct">${t.prog}%</span>`;
      bi+=`<div class="rs rs-l" data-rl="${t.id}"></div><div class="rs rs-r" data-rr="${t.id}"></div>`;
    } else {
      const pctSumm=t.prog>0?`<span class="summ-pct">${t.prog}%</span>`:"";
      bi+=`<span class="bn-summ dp${dp}">${esc(t.nm)}${pctSumm}</span>`;
    }
    // Pentru milestone: width fix mic, doar diamant + label
    const styleStr = isMs
      ? `left:${l}px;width:auto;`
      : `left:${l}px;width:${w}px`;
    rows+='<div class="g-row '+sc+'" data-gid="'+t.id+'" draggable="true"'
        +' onclick="selTask('+t.id+')"'
        +' oncontextmenu="showCtx(event,'+t.id+')"'
        +' onmouseenter="highlightRow('+t.id+')"'
        +' onmouseleave="clearHighlight()">'
        +'<div class="gb '+bc+' dp'+dp+ac+(!isSumm&&isCrit(t.id)?' crit':'')+(taskWarn[t.id]?' warn':'')+(isBehind(t)?' late-task':'')+'" data-bid="'+t.id+'" style="'+styleStr+'">'+bi+'</div>'+_blBar(t,cs,dw)+_dlMark(t,cs,dw)+'</div>';
  });

  // ===== DEPENDENCY ARROWS (Orthogonal / Manhattan routing) =====
  // Tip FS: pred.FINISH (right)  → succ.START  (left)
  // Tip SS: pred.START  (left)   → succ.START  (left)
  // Tip FF: pred.FINISH (right)  → succ.FINISH (right)
  // Tip SF: pred.START  (left)   → succ.FINISH (right)
  const RH=30, PAD=10, CORNER_R=4;
  let arrowsSvg='';

  // Săgețile care intră în aceeași bară se desenează toate; ultimele segmente se suprapun și par o singură săgeată cu ramificații.
  o.forEach((t,si)=>{
    const deps=t.deps||[]; if(!deps.length) return;
    const succP=ps(t);
    const succLeft  = dD(cs,succP._s)*dw;
    const succRight = (dD(cs,succP._s)+calSpan(t))*dw;
    const succCY=si*RH+RH/2;
    deps.forEach(d=>{
      const predId = d.id, type = d.type || 'FS', lag = +d.lag || 0;
      const pi=idxMap[predId]; if(pi===undefined) return;
      const pred=T.find(x=>x.id===predId); if(!pred) return;
      const predP=ps(pred);
      const predLeft  = dD(cs,predP._s)*dw;
      const predRight = (dD(cs,predP._s)+calSpan(pred))*dw;
      const predCY=pi*RH+RH/2;

      // Anchor points + direcția de ieșire/intrare (+1 = dreapta, -1 = stânga)
      const fromX = (type === 'SS' || type === 'SF') ? predLeft  : predRight;
      const toX   = (type === 'FF' || type === 'SF') ? succRight : succLeft;
      const fromY = predCY, toY = succCY;
      const fromDir = (type === 'SS' || type === 'SF') ? -1 : +1;
      const toDir   = (type === 'FF' || type === 'SF') ? +1 : -1;
      if(isNaN(fromX)||isNaN(toX)||isNaN(fromY)||isNaN(toY)) return;

      const points = _buildOrthoPoints(fromX, fromY, fromDir, toX, toY, toDir, PAD, RH);
      const pathD  = _roundedPolyPath(points, CORNER_R);

      // Unghiul chevron-ului = direcția ultimului segment (întotdeauna orizontal/vertical)
      const last = points[points.length-1], prev = points[points.length-2];
      const angle = Math.atan2(last[1]-prev[1], last[0]-prev[0]) * 180 / Math.PI;

      // Label (tip + lag) — plasat pe segmentul vertical cel mai lung
      const plainLbl = (type === 'FS' && lag === 0);
      const needsLabel = true; // etichetele se afișează prin CSS (la hover/selecție sau la zoom mare)
      const lblText = depLabel({type, lag});
      const lc = plainLbl ? ' lbl-plain' : '';
      const lblPos = _labelAnchor(points);
      const lblX = lblPos.x, lblY = lblPos.y;
      const lblW = lblText.length * 5 + 8;

      const typeCls = ' dep-type-'+type.toLowerCase()+(isCrit(predId)&&isCrit(t.id)?' dep-crit':'');

      arrowsSvg+=`<g class="dep-group${typeCls}" data-dep-from="${predId}" data-dep-to="${t.id}" data-dep-type="${type}">`;
      arrowsSvg+=`<path d="${pathD}" fill="none" stroke="transparent" stroke-width="14" class="dep-hit" data-dep-from="${predId}" data-dep-to="${t.id}"/>`;
      arrowsSvg+=`<path d="${pathD}" fill="none" class="dep-line" data-dep-from="${predId}" data-dep-to="${t.id}"/>`;
      arrowsSvg+=`<path d="M-6,-3.5 L0,0 L-6,3.5" fill="none" class="dep-head" transform="translate(${last[0]},${last[1]}) rotate(${angle})" data-dep-from="${predId}" data-dep-to="${t.id}"/>`;
      if (needsLabel) {
        arrowsSvg+=`<rect class="dep-lbl-bg${lc}" x="${lblX-lblW/2}" y="${lblY-7}" width="${lblW}" height="13" rx="3"/>`;
        arrowsSvg+=`<text class="dep-lbl${lc}" x="${lblX}" y="${lblY+3}" text-anchor="middle">${esc(lblText)}</text>`;
      }
      arrowsSvg+=`</g>`;
    });
  });

  const svgH=o.length*RH+RH*2;
  const svgOvr=`<svg class="dep-svg${showCritical?' crit-mode':''}${dw<14?' lz':''}" id="depSvg" width="${tw}" height="${svgH}" viewBox="0 0 ${tw} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;pointer-events:none;z-index:5;overflow:visible">${arrowsSvg}</svg>`;

  $("gBody").innerHTML=`<div class="g-inner" style="width:${tw+tailW}px;min-height:${svgH}px"><div class="g-grid">${grid}</div>${rows}${svgOvr}</div>`;
  attachDnD(".g-row[data-gid]","gid","g-row");
  attachBars(cs,td,dw);

  // Inițializează interacțiunea cu dependențele (drag-to-link)
  if (typeof initDepsUI === 'function') initDepsUI();
  if (sel) focusDepsFor(sel);
  updateInfoBar(sel ? T.find(x=>x.id===sel) : null);
}

// ===== Insigna live la tragere (mutare / redimensionare) =====
const _dm = d => d.getDate()+"."+String(d.getMonth()+1).padStart(2,"0");
function _liveText(t, sd, dur){
  const tmp={sd:fD(sd),dur}, e=endDate(tmp), skipped=calSpan(tmp)-dur;
  // succesori în lanț (activități care depind direct sau indirect de aceasta)
  const seen=new Set(), q=[t.id];
  while(q.length){ const c=q.pop(); T.forEach(x=>{ if((x.deps||[]).some(d=>d.id===c) && !seen.has(x.id) && !hasK(x.id)){ seen.add(x.id); q.push(x.id); } }); }
  let s=`${dur} ${dur===1?"zi":"zile"} · ${_dm(sd)} → ${_dm(e)}`;
  if(skipped>0) s+=` · ${skipped} libere sărite`;
  if(seen.size) s+=` · ${seen.size} succesoare în lanț`;
  return s;
}
function liveBadge(e, text){
  let b=document.getElementById("liveBadge");
  if(!b){ b=document.createElement("div"); b.id="liveBadge"; b.className="live-badge"; document.body.appendChild(b); }
  b.textContent=text;
  b.style.left=Math.min(e.clientX+16, innerWidth-b.offsetWidth-10)+"px";
  b.style.top=(e.clientY-38)+"px";
}
function hideLive(){ const b=document.getElementById("liveBadge"); if(b) b.remove(); }

// ===== Bara de informații de sub Gantt =====
function updateInfoBar(t){
  const el=$("gInfo"); if(!el) return;
  if(!t){ el.innerHTML='<span style="color:var(--muted)">Treci cu mouse-ul pe o activitate sau selecteaz-o pentru detalii</span>'; return; }
  const w=wbs(), p=ps(t);
  const preds=(t.deps||[]).map(d=>`${w[d.id]||"?"} <b>${depLabel(d)}</b>`).join(", ")||"—";
  const succs=T.filter(x=>(x.deps||[]).some(d=>d.id===t.id)).map(x=>{const d=x.deps.find(d=>d.id===t.id); return `${w[x.id]||"?"} <b>${depLabel(d)}</b>`;}).join(", ")||"—";
  const c=cpm[t.id];
  const slack=c?` · <span style="${c.crit?"color:#d94040;font-weight:800":""}">${c.crit?"CRITIC (0 zile rezervă)":"rezervă "+c.float+" zile"}</span>`:"";
  const consTxt=t.cons&&t.cons.type&&t.cons.type!=="ASAP"?` · <span class="gi-lbl">Restricție:</span> ${CONS_LABELS[t.cons.type]}${t.cons.date?" "+fmtDate(pD(t.cons.date)):""}`:"";
  const dlTxt=t.deadline?` · <span class="gi-lbl">Termen:</span> ${fmtDate(pD(t.deadline))}`:"";
  const tw=taskWarn[t.id], warnTxt=tw?` · <span class="gi-warn">⚠ ${[tw.lateText,tw.cons,tw.res].filter(Boolean).map(esc).join(" · ")}</span>`:"";
  el.innerHTML=`<b>${w[t.id]||""} ${esc(t.nm)}</b> · ${t.dur} ${t.dur===1?"zi":"zile"} · ${fmtDate(p._s)} → ${fmtDate(p._e)} · ${t.prog}%${slack}${consTxt}${dlTxt}${baselineText(t)}${resText(t)}${warnTxt} · <span class="gi-lbl">După:</span> ${preds} · <span class="gi-lbl">Urmează:</span> ${succs}`;
}

function attachBars(cs,td,dw){
  document.querySelectorAll(".gb").forEach(bar=>{
    const isSumm=bar.classList.contains("summ"), tid=+bar.dataset.bid, t=T.find(x=>x.id===tid);
    const onHandle=e=>!!e.target.closest(".dep-dot,.rs,.prog-handle");
    // Detaliile sunt în bara de informații de sub Gantt (nu mai acoperă săgețile)
    bar.addEventListener("mouseenter",()=>{ if(t) updateInfoBar(t); });
    bar.addEventListener("mouseleave",()=>updateInfoBar(sel?T.find(x=>x.id===sel):null));
    // Săgețile se evidențiază doar când mouse-ul e pe bara activității (nu pe rând)
    bar.addEventListener("mouseenter",()=>focusDepsFor(tid));
    bar.addEventListener("mouseleave",unfocusDeps);
    bar.addEventListener("dblclick",e=>{e.stopPropagation(); if(t) startBarEdit(bar,t)});

    if(!isSumm){
      bar.addEventListener("mousedown",e=>{
        // Ignoră dep-dot, resize, progress
        if(e.target.closest(".rs")||e.target.closest(".prog-handle")||e.target.closest(".dep-dot")||e.button!==0) return;
        e.preventDefault(); e.stopPropagation(); sel=tid; hideTip(); if(!t) return;
        const orig=pD(t.sd), sx=e.clientX, startLeft=parseFloat(bar.style.left);
        bar.classList.add("dragging");
        const mv=ev=>{
          const days=Math.round((ev.clientX-sx)/dw);
          bar.style.left=(startLeft+days*dw)+"px";
          liveBadge(ev,_liveText(t,aD(orig,days),t.dur));
        };
        const up=ev=>{
          bar.classList.remove("dragging"); hideLive();
          t.sd=fD(aD(orig,Math.round((ev.clientX-sx)/dw)));
          syncTabData(); renderAll();
          document.removeEventListener("mousemove",mv);
          document.removeEventListener("mouseup",up);
        };
        document.addEventListener("mousemove",mv);
        document.addEventListener("mouseup",up);
      });
    }
    bar.addEventListener("click",e=>{
      if(e.target.closest(".rs")||e.target.closest(".prog-handle")||e.target.closest(".dep-dot")) return;
      e.stopPropagation(); sel=sel===tid?null:tid; renderAll();
    });
  });

  document.querySelectorAll("[data-ph]").forEach(h=>{
    h.addEventListener("mousedown",e=>{
      e.preventDefault(); e.stopPropagation(); hideTip();
      const t2=T.find(x=>x.id===+h.dataset.ph); if(!t2) return;
      const bar=h.closest(".gb"), barRect=bar.getBoundingClientRect(), fillBar=bar.querySelector(".bp");
      const pctEl=bar.querySelector(".bp-pct");
      let pct=t2.prog;
      const mv=ev=>{
        const raw=clamp(Math.round((ev.clientX-barRect.left)/barRect.width*100),0,100);
        // Snap la multipli de 5% (implicit); Shift = control precis 1%
        const step = ev.shiftKey ? 1 : 5;
        pct = clamp(Math.round(raw/step)*step, 0, 100);
        h.style.left=pct+"%";
        if(fillBar) fillBar.style.width=pct+"%";
        if(pctEl) pctEl.textContent = pct + "%";
      };
      const up=()=>{
        t2.prog=pct; syncTabData(); renderAll();
        document.removeEventListener("mousemove",mv);
        document.removeEventListener("mouseup",up);
      };
      document.addEventListener("mousemove",mv);
      document.addEventListener("mouseup",up);
    });
  });

  document.querySelectorAll("[data-rr]").forEach(h=>{
    h.addEventListener("mousedown",e=>{
      e.preventDefault(); e.stopPropagation(); hideTip();
      const t2=T.find(x=>x.id===+h.dataset.rr); if(!t2) return;
      const bar=h.closest(".gb"), origEnd=endDate(t2), sx=e.clientX, origW=parseFloat(bar.style.width);
      bar.classList.add("dragging");
      const mv=ev=>{
        const days=Math.round((ev.clientX-sx)/dw);
        bar.style.width=Math.max(dw,origW+days*dw)+"px";
        liveBadge(ev,_liveText(t2,pD(t2.sd),workDur(pD(t2.sd),aD(origEnd,days))));
      };
      const up=ev=>{
        bar.classList.remove("dragging"); hideLive();
        t2.dur=workDur(pD(t2.sd),aD(origEnd,Math.round((ev.clientX-sx)/dw)));
        syncTabData(); renderAll();
        document.removeEventListener("mousemove",mv);
        document.removeEventListener("mouseup",up);
      };
      document.addEventListener("mousemove",mv);
      document.addEventListener("mouseup",up);
    });
  });

  document.querySelectorAll("[data-rl]").forEach(h=>{
    h.addEventListener("mousedown",e=>{
      e.preventDefault(); e.stopPropagation(); hideTip();
      const t2=T.find(x=>x.id===+h.dataset.rl); if(!t2) return;
      const bar=h.closest(".gb"), orig=pD(t2.sd), od=calSpan(t2), endD=endDate(t2), sx=e.clientX;
      const origW=parseFloat(bar.style.width), origL=parseFloat(bar.style.left);
      bar.classList.add("dragging");
      const mv=ev=>{
        const days=Math.round((ev.clientX-sx)/dw);
        if(days<od){
          bar.style.left=(origL+days*dw)+"px";
          bar.style.width=Math.max(dw,origW-days*dw)+"px";
          const ns=aD(orig,days); liveBadge(ev,_liveText(t2,ns,workDur(ns,endD)));
        } else liveBadge(ev,_liveText(t2,endD,1));
      };
      const up=ev=>{
        bar.classList.remove("dragging"); hideLive();
        const d=Math.round((ev.clientX-sx)/dw);
        if(d>=od){t2.sd=fD(endD);t2.dur=1}
        else{const ns=aD(orig,d); t2.sd=fD(ns); t2.dur=workDur(ns,endD)}
        syncTabData(); renderAll();
        document.removeEventListener("mousemove",mv);
        document.removeEventListener("mouseup",up);
      };
      document.addEventListener("mousemove",mv);
      document.addEventListener("mouseup",up);
    });
  });
}

// Marcaj de termen limită (deadline): dungă verde la finalul zilei-limită; roșie dacă e depășit
function _dlMark(t, cs, dw){
  if(!t.deadline) return "";
  const x=(dD(cs,pD(t.deadline))+1)*dw;
  const late=taskWarn[t.id]&&taskWarn[t.id].late;
  return '<div class="dl-mark'+(late?' late':'')+'" style="left:'+x+'px" title="Termen limită: '+fmtDate(pD(t.deadline))+(late?' — depășit cu '+late+(late===1?' zi':' zile'):'')+'"></div>';
}

// Prescurtarea automată (aceeași regulă ca în bară, pe o lățime medie) — arătată ca exemplu în Detalii
function _autoShort(t) {
  const keep = t.nm.split(/\s+/).filter((w, i) => w && (i === 0 || !_FILLER_WORDS.has(w.toLowerCase())));
  let s = keep.join(' ');
  if (s.length > 14) s = s.slice(0, 13).trim() + '…';
  return s;
}
