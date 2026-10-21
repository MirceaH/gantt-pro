let linkSrc = null, hoverTarget = null;

function startLink(e, id) {
  e.preventDefault(); e.stopPropagation(); linkSrc = id; hideTip();
  const handle = e.target, line = $("tempLink");
  line.setAttribute("x1", handle.getAttribute("cx")); line.setAttribute("y1", handle.getAttribute("cy"));
  line.setAttribute("x2", handle.getAttribute("cx")); line.setAttribute("y2", handle.getAttribute("cy"));
  line.style.display = "block";
}

function trackLine(e) {
  if(!linkSrc) return;
  const svg = document.querySelector('.tree-svg'); if(!svg) return;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
  $("tempLink").setAttribute("x2", loc.x); $("tempLink").setAttribute("y2", loc.y);
}

function setHoverTarget(id) { 
  if (linkSrc && linkSrc !== id) { hoverTarget = id; const g = document.getElementById('node-' + id); if(g) g.classList.add('drop-target'); } 
}

function clearHoverTarget(id) { 
  if (hoverTarget === id) { hoverTarget = null; const g = document.getElementById('node-' + id); if(g) g.classList.remove('drop-target'); } 
}

document.addEventListener('mouseup', (e) => {
  if (linkSrc) {
    if (hoverTarget && hoverTarget !== linkSrc) {
      if (isD(linkSrc, hoverTarget)) toast("Eroare: Nu poți face o buclă!");
      else {
        const tgt = T.find(t => t.id === hoverTarget);
        if(tgt) { tgt.pid = linkSrc; toast("Săgeată creată!"); sel = hoverTarget; renderAll(); }
      }
    }
    if($("tempLink")) $("tempLink").style.display = "none";
    linkSrc = null; hoverTarget = null;
    document.querySelectorAll('.t-node.drop-target').forEach(el => el.classList.remove('drop-target'));
  }
});

// ===== Stare arbore =====
let treeFocus = null;          // capitolul focalizat (null = tot proiectul)
const treeOpen = new Set();    // capitole deschise (implicit sunt închise, în afară de rădăcină)
let treeZoom = 1;              // mărirea arborelui (textul nu se mai scalează automat)
let _treeDims = { w: 1, h: 1 };

let _treeHold = false; // true = nu anima randarea intermediară (animăm doar spre starea finală)
function setTreeFocus(id){ treeFocus = id; _treeHold = true; renderAll(); _treeHold = false; treeFit(); }
// Dublu-click pe un capitol = vedere detaliată (doar ramura lui, mărită și centrată)
function treeDbl(id){
  hideTip();
  if(!hasK(id) || id===treeFocus) return;
  sel = id;
  setTreeFocus(id);
}
function toggleTreeOpen(id){ if(treeOpen.has(id)) treeOpen.delete(id); else treeOpen.add(id); renderAll(); }
function treeOpenAll(){ T.forEach(t=>{ if(hasK(t.id)) treeOpen.add(t.id); }); _treeHold = true; renderAll(); _treeHold = false; treeFit(); }
function treeCloseAll(){ treeOpen.clear(); _treeHold = true; renderAll(); _treeHold = false; treeFit(); }
function setTreeZoom(z){ treeZoom = Math.max(0.4, Math.min(1.6, Math.round(z*100)/100)); renderAll(); }
function treeFit(){
  const b=$("treeBox"); if(!b) return;
  setTreeZoom(Math.min((b.clientWidth-30)/_treeDims.w, (b.clientHeight-80)/_treeDims.h));
  // Centrare lină (pe dimensiunea finală, nu pe cea din timpul animației)
  const finalW = _treeDims.w * treeZoom + 20;
  b.scrollTo({ left: Math.max(0, (finalW - b.clientWidth) / 2), top: 0, behavior: "smooth" });
}

// ===== Animații: cardurile alunecă la noua poziție, cele noi ies din părinte, zoom lin =====
let _treePrev = null;
function _treeAnimate(an, dims){
  const box=$("treeBox"), svg=box && box.querySelector(".tree-svg"); if(!svg) return;
  const cur={}; an.forEach(n=>{ cur[n.id]={x:n.x,y:n.y}; });
  const prev=_treePrev; _treePrev={pos:cur,dims};
  if(!prev || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const moves=[]; let changed = Object.keys(cur).length !== Object.keys(prev.pos).length;
  an.forEach(n=>{
    const o=prev.pos[n.id]; let from=o;
    if(!o){ from = (n.pid!=null && (prev.pos[n.pid]||cur[n.pid])) || {x:n.x,y:n.y}; }
    if(!o || Math.abs(from.x-n.x)>.5 || Math.abs(from.y-n.y)>.5){ moves.push({id:n.id,dx:from.x-n.x,dy:from.y-n.y,isNew:!o}); changed=true; }
  });
  const sizeChanged = prev.dims.w!==dims.w || prev.dims.h!==dims.h || prev.dims.mt!==dims.mt;
  if(!changed && !sizeChanged) return;

  // Pornește de la starea veche
  const T_NODE="transform .45s cubic-bezier(.4,0,.2,1), opacity .35s ease";
  svg.style.width=prev.dims.w+"px"; svg.style.height=prev.dims.h+"px"; svg.style.marginTop=prev.dims.mt+"px";
  moves.forEach(m=>{
    const g=svg.querySelector("#node-"+m.id); if(!g) return;
    g.style.transform=`translate(${m.dx}px,${m.dy}px)`;
    if(m.isNew) g.style.opacity="0";
  });
  if(changed) svg.querySelectorAll(".edge").forEach(p=>{ p.style.opacity="0"; });
  svg.getBoundingClientRect(); // forțează layout-ul stării de start

  // Animă spre starea nouă
  svg.style.transition="width .45s cubic-bezier(.4,0,.2,1), height .45s cubic-bezier(.4,0,.2,1), margin-top .45s cubic-bezier(.4,0,.2,1)";
  svg.style.width=dims.w+"px"; svg.style.height=dims.h+"px"; svg.style.marginTop=dims.mt+"px";
  moves.forEach(m=>{
    const g=svg.querySelector("#node-"+m.id); if(!g) return;
    g.style.transition=T_NODE; g.style.transform="translate(0px,0px)"; if(m.isNew) g.style.opacity="1";
  });
  if(changed) svg.querySelectorAll(".edge").forEach(p=>{ p.style.transition="opacity .35s ease .2s"; p.style.opacity="1"; });

  setTimeout(()=>{
    svg.style.transition="";
    svg.querySelectorAll(".t-node").forEach(g=>{ g.style.transition=""; g.style.transform=""; g.style.opacity=""; });
    svg.querySelectorAll(".edge").forEach(p=>{ p.style.transition=""; p.style.opacity=""; });
  }, 560);
}

// Detaliile ca pe Gantt (aceeași casetă) la hover pe un card
function treeTip(e, id){
  const t = T.find(x => x.id === id); if(!t) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(e, t), 350);
}

function _treeBar(){
  let left='<span class="tc-path"><b>Proiect</b></span>';
  if(treeFocus){
    const chain=[]; let t=T.find(x=>x.id===treeFocus);
    while(t){ chain.unshift(t); t=t.pid?T.find(x=>x.id===t.pid):null; }
    const parts=chain.map((c,i)=> i===chain.length-1 ? `<b>${esc(c.nm)}</b>` : `<a onclick="setTreeFocus(${c.id})">${esc(c.nm)}</a>`).join(' <span class="tc-sep">›</span> ');
    left=`<button onclick="setTreeFocus(null)">← Tot proiectul</button><span class="tc-path">${parts}</span>`;
  }
  return `<div class="tree-crumb">${left}<span class="tc-spacer"></span>
    <button class="tc-sec" onclick="treeCloseAll()" title="Închide toate capitolele">⊟ Închide tot</button>
    <button class="tc-sec" onclick="treeOpenAll()" title="Deschide toate capitolele">⊞ Deschide tot</button>
    <span class="tc-zoom"><span>${Math.round(treeZoom*100)}%</span><button class="tc-sec" onclick="treeFit()" title="Auto-zoom: încadrează și centrează arborele">⤢ Încadrează</button></span></div>`;
}

function renderTree(){
  if(treeFocus && !(T.find(t=>t.id===treeFocus) && hasK(treeFocus))) treeFocus=null;
  const roots=treeFocus ? [T.find(t=>t.id===treeFocus)] : T.filter(t=>!t.pid);
  if(!roots.length){ $("treeBox").innerHTML='<div class="sp-empty" style="margin:50px">Fără activități. Adaugă una folosind bara de sus!</div>'; return; }

  const rW=196, rH=54, sW=rH+10, dStep=rW+56, gX=10;

  function ln(t,x,y,dp){
    const allCh = kids(t.id), closed = dp>=1 && allCh.length>0 && !treeOpen.has(t.id), ch = closed ? [] : allCh;
    const info = {id:t.id, pid:t.pid, nm:t.nm, pr:t.prog, du:t.dur, sd:t.sd, dp, sm:allCh.length>0, isCol:closed, cnt:allD(t.id).length, ms:!!t.isMilestone, crit:!allCh.length && isCrit(t.id), critN:allCh.length ? allD(t.id).filter(i=>!hasK(i) && isCrit(i)).length : 0};
    if(!ch.length) return {w:sW, n:[{...info, x, y}]};
    const cls=ch.map(c=>ln(c,0,y+dStep,dp+1)), tw2=cls.reduce((s,l)=>s+l.w,0), mw=Math.max(sW,tw2);
    let cx2=x+(mw-tw2)/2;
    const an=[{...info, x:x+(mw-sW)/2, y}];
    cls.forEach(cl=>{ cl.n.forEach(n=>{n.x+=cx2;an.push(n)}); cx2+=cl.w; });
    return{w:mw,n:an};
  }

  let an=[], cx=0;
  roots.forEach(r=>{const l=ln(r,cx,0,0); l.n.forEach(n=>an.push(n)); cx+=l.w+gX*2});
  // Transpunem: adâncimea devine axa X (stânga → dreapta), frații se așază pe verticală
  const pd=30; an.forEach(n=>{ const sx=n.x, sy=n.y; n.x=sy+pd; n.y=sx+pd+(sW-rH)/2; });
  const totalW = Math.max(...an.map(n=>n.x)) + rW + pd;
  const totalH = cx + pd * 2;
  _treeDims = { w: totalW, h: totalH };
  const sc = treeZoom;
  // Centrat pe verticală când arborele e mai mic decât fereastra
  const availH = ($("treeBox") && $("treeBox").clientHeight || 600) - 70;
  const mt = Math.max(0, Math.round((availH - totalH*sc) / 2));
  const zl = $("zoomLbl"); if(zl) zl.textContent = Math.round(sc*100) + "%";

  let svg=`<svg class="tree-svg" style="width:${Math.round(totalW*sc)}px;height:${Math.round(totalH*sc)}px;display:block;margin:${mt}px auto 0" viewBox="0 0 ${totalW} ${totalH}">
    <defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.10"/></filter></defs>
    <line id="tempLink" x1="0" y1="0" x2="0" y2="0" stroke="var(--coral)" stroke-width="3" stroke-dasharray="6" style="display:none;pointer-events:none"/>`;

  // Conexiuni ortogonale subțiri, fără săgeți
  an.forEach(n => {
    if(!n.pid) return;
    const p = an.find(q => q.id === n.pid); if(!p) return;
    const x1=p.x+rW, y1=p.y+rH/2, x2=n.x, y2=n.y+rH/2, m=x1+(x2-x1)/2, dy=y2-y1;
    let d;
    if(Math.abs(dy)<1) d=`M${x1},${y1} H${x2}`;
    else { const r=Math.min(8,Math.abs(dy)/2), s=Math.sign(dy);
      d=`M${x1},${y1} H${m-r} Q${m},${y1} ${m},${y1+s*r} V${y2-s*r} Q${m},${y2} ${m+r},${y2} H${x2}`; }
    svg+=`<path class="edge${(n.crit||n.critN>0)?" crit":""}" d="${d}"/>`;
  });

  an.forEach(n=>{
    const dp=Math.min(n.dp,3), isSel = sel === n.id ? " selected" : "";
    let cFg = ["var(--accent)","var(--blue)","var(--purple)","var(--amber)"][dp]; if(n.crit) cFg = "#d94040";
    const chev = n.sm ? (n.isCol ? "▸ " : "▾ ") : "";
    const lb = n.nm.length>18 ? n.nm.slice(0,17)+"…" : n.nm;
    const dA = n.sd.split('-'), dateStr = dA[2]+'.'+dA[1]+'.'+dA[0].slice(2);
    const tx = rW-26, pW = Math.max(0, tx*(n.pr/100));
    const critTxt = n.critN>0 ? ` · ${n.critN} critice` : '';
    const sub = n.isCol ? `${n.cnt} ${n.cnt===1?'activitate':'activități'}${critTxt} · ${dateStr}`
              : (n.ms ? `♦ milestone · ${dateStr}` : `${n.du} ${n.du===1?'zi':'zile'} · ${dateStr}`);

    svg+=`<g id="node-${n.id}" class="t-node${isSel}${n.crit?" crit":""}" onclick="selTask(${n.id})" ondblclick="treeDbl(${n.id})" oncontextmenu="showCtx(event,${n.id})" onmouseenter="setHoverTarget(${n.id});treeTip(event,${n.id})" onmouseleave="clearHoverTarget(${n.id});hideTip()">`;
    svg+=`<rect class="nc" x="${n.x}" y="${n.y}" width="${rW}" height="${rH}" rx="10" filter="url(#shadow)"/>`;
    svg+=`<path d="M${n.x+10},${n.y} H${n.x+4} Q${n.x},${n.y} ${n.x},${n.y+10} V${n.y+rH-10} Q${n.x},${n.y+rH} ${n.x+4},${n.y+rH} H${n.x+10} Z" fill="${cFg}" pointer-events="none" opacity=".95"/>`;
    svg+=`<rect x="${n.x}" y="${n.y}" width="6" height="${rH}" fill="${cFg}" rx="3" pointer-events="none"/>`;
    svg+=`<text x="${n.x+16}" y="${n.y+22}" font-family="var(--font)" font-size="13.5" font-weight="800" fill="var(--text)" pointer-events="none">${esc(chev+lb)}</text>`;
    svg+=`<text x="${n.x+rW-10}" y="${n.y+22}" text-anchor="end" font-family="var(--font)" font-size="12" font-weight="800" fill="${cFg}" pointer-events="none">${n.pr}%</text>`;
    svg+=`<text x="${n.x+16}" y="${n.y+37}" font-family="var(--font)" font-size="11" font-weight="600" fill="var(--muted)" pointer-events="none">${sub}</text>`;
    svg+=`<rect x="${n.x+16}" y="${n.y+rH-10}" width="${tx}" height="3.5" rx="1.75" fill="var(--grid)" pointer-events="none"/>`;
    if(pW>0) svg+=`<rect class="pbar d${dp}" x="${n.x+16}" y="${n.y+rH-10}" width="${pW}" height="3.5" rx="1.75" fill="${cFg}" pointer-events="none"/>`;
    if(n.critN>0) svg+=`<circle cx="${n.x+rW-5}" cy="${n.y+5}" r="5" fill="#d94040" stroke="var(--card)" stroke-width="1.5" pointer-events="none"/>`;
    // Comutator deschis/închis pentru capitole (zonă mare, în stânga titlului)
    if(n.sm && n.dp>=1) svg+=`<rect data-nodrag="1" x="${n.x+8}" y="${n.y+4}" width="26" height="24" fill="transparent" style="cursor:pointer" onclick="event.stopPropagation();toggleTreeOpen(${n.id})"><title>${n.isCol?'Deschide':'Închide'} capitolul</title></rect>`;
    svg+=`</g>`;
  });

  svg+='</svg>'; $("treeBox").innerHTML=_treeBar()+svg;
  if(!_treeHold) _treeAnimate(an, { w: Math.round(totalW*sc), h: Math.round(totalH*sc), mt });
}

// ===== Mutat cu mouse-ul (pan) + Ctrl+rotiță = zoom =====
(function initTreePanZoom(){
  const box=$("treeBox"); if(!box) return;
  let pan=null;
  box.addEventListener("mousedown", e=>{
    if(e.button!==0 || e.target.closest(".t-node,.link-handle,.focus-btn,.tree-crumb")) return;
    pan={x:e.clientX,y:e.clientY,l:box.scrollLeft,t:box.scrollTop}; box.classList.add("panning");
  });
  document.addEventListener("mousemove", e=>{ if(!pan) return; box.scrollLeft=pan.l-(e.clientX-pan.x); box.scrollTop=pan.t-(e.clientY-pan.y); });
  document.addEventListener("mouseup", ()=>{ if(pan){ pan=null; box.classList.remove("panning"); } });
  box.addEventListener("wheel", e=>{
    if(!e.ctrlKey) return;
    e.preventDefault();
    setTreeZoom(treeZoom + (e.deltaY<0 ? 0.1 : -0.1));
  }, {passive:false});
})();

// ===== Tragi un card peste alt card => devine subcapitol al lui =====
(function initTreeCardDrag(){
  let cd = null, justDragged = false;

  const nodeIdOf = el => { const g = el && el.closest && el.closest("#treeBox .t-node"); return g ? +g.id.replace("node-", "") : null; };

  document.addEventListener("mousedown", e => {
    if (e.button !== 0 || e.target.closest("[data-nodrag]")) return;
    const id = nodeIdOf(e.target); if (id == null) return;
    cd = { id, sx: e.clientX, sy: e.clientY, on: false, ghost: null, tgt: null, ok: false };
  });

  document.addEventListener("mousemove", e => {
    if (!cd) return;
    if (!cd.on) {
      if (Math.hypot(e.clientX - cd.sx, e.clientY - cd.sy) < 6) return;
      cd.on = true;
      hideTip();
      const t = T.find(x => x.id === cd.id);
      const gh = document.createElement("div");
      gh.className = "tree-ghost";
      gh.textContent = t ? t.nm : "";
      document.body.appendChild(gh);
      cd.ghost = gh;
      document.body.classList.add("tree-dragging");
      const src = document.getElementById("node-" + cd.id); if (src) src.classList.add("dragging-src");
    }
    cd.ghost.style.left = (e.clientX + 14) + "px";
    cd.ghost.style.top = (e.clientY + 10) + "px";

    document.querySelectorAll("#treeBox .t-node.drop-target, #treeBox .t-node.drop-bad").forEach(g => g.classList.remove("drop-target", "drop-bad"));
    cd.tgt = null; cd.ok = false;
    const hit = document.elementsFromPoint(e.clientX, e.clientY).map(nodeIdOf).find(id => id != null && id !== cd.id);
    if (hit != null) {
      cd.tgt = hit;
      cd.ok = !isD(hit, cd.id); // nu poți pune un capitol în propriul subcapitol
      const g = document.getElementById("node-" + hit);
      if (g) g.classList.add(cd.ok ? "drop-target" : "drop-bad");
    }
  });

  document.addEventListener("mouseup", () => {
    if (!cd) return;
    const cur = cd; cd = null;
    if (!cur.on) return;
    justDragged = true; setTimeout(() => { justDragged = false; }, 0);
    if (cur.ghost) cur.ghost.remove();
    document.body.classList.remove("tree-dragging");
    document.querySelectorAll("#treeBox .t-node").forEach(g => g.classList.remove("drop-target", "drop-bad", "dragging-src"));
    if (cur.tgt == null) return;
    if (!cur.ok) { toast("🚫 Nu poți muta un capitol în propriul subcapitol"); return; }

    const src = T.find(x => x.id === cur.id), tgt = T.find(x => x.id === cur.tgt);
    if (!src || !tgt) return;
    if (src.pid === tgt.id) { toast("ℹ️ Deja e în „" + tgt.nm + "”"); return; }
    pushHistory();
    const sName = src.nm, tName = tgt.nm, sId = src.id, tId = tgt.id;
    // Îl punem ultimul copil al țintei (anulat dacă ar crea o buclă de dependențe)
    const ok = _tryHierarchyChange(() => {
      const s2 = T.find(x => x.id === sId), g2 = T.find(x => x.id === tId);
      T.splice(T.indexOf(s2), 1);
      const block = [g2.id, ...allD(g2.id)];
      const last = Math.max(...block.map(id => T.findIndex(x => x.id === id)));
      s2.pid = g2.id;
      T.splice(last + 1, 0, s2);
    });
    if (!ok) { _history.pop(); updateUndoRedoBtns(); renderAll(); return; }
    treeOpen.add(tId);
    sel = sId;
    syncTabData(); renderAll();
    toast("↳ „" + sName + "” mutat în „" + tName + "”");
  });

  // După tragere nu se mai consideră click (altfel se schimbă selecția)
  document.addEventListener("click", e => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
})();
