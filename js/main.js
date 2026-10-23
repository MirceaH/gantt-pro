// ======== TEMĂ (luminoasă / întunecată; implicit după sistem) ========
const _darkMQ = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
function _applyDark(on) {
  document.body.classList.toggle("dark", on);
  const btn = $("btnDark");
  if (btn) { btn.innerHTML = '<svg class="ic"><use href="#' + (on ? "i-sun" : "i-moon") + '"/></svg>'; btn.title = on ? "Temă luminoasă" : "Temă întunecată"; }
}
function toggleDark() {
  const on = !document.body.classList.contains("dark");
  _applyDark(on);
  try { localStorage.setItem("ganttDark", on ? "1" : "0"); } catch (e) {}
}
function initDark() {
  let saved = null; try { saved = localStorage.getItem("ganttDark"); } catch (e) {}
  _applyDark(saved === null ? !!(_darkMQ && _darkMQ.matches) : saved === "1");
  // Dacă utilizatorul nu a ales manual, urmărim schimbările temei din sistem
  if (_darkMQ && _darkMQ.addEventListener) _darkMQ.addEventListener("change", e => {
    let s = null; try { s = localStorage.getItem("ganttDark"); } catch (x) {}
    if (s === null) _applyDark(e.matches);
  });
}


// ======== MENIU PROIECT ========
// (Vechiul meniu Proiect a fost înlocuit cu ribbon Project tab — păstrăm stub-uri)
function toggleProiectMenu(e) {
  if (e) e.stopPropagation();
  const menu = $("proiectMenu");
  if (!menu) return;
  menu.classList.toggle("open");
}

function closeProiectMenu() {
  const menu = $("proiectMenu");
  if (menu) menu.classList.remove("open");
}

document.addEventListener("click", e => {
  // Stub: meniul Proiect nu mai există în UI nou (Project e tab în ribbon)
  // Lăsăm doar pentru cazul când localStorage are urme vechi
  const menu = $("proiectMenu");
  if (!menu) return;
  const nameModal = $("nameModal");
  const taskInfo = $("taskInfoModal");
  const confirmM = $("confirmModal");
  if ((nameModal && nameModal.classList.contains("open")) ||
      (taskInfo && taskInfo.classList.contains("open")) ||
      (confirmM && confirmM.classList.contains("open"))) return;
  if (menu.classList.contains("open") && !menu.contains(e.target)) closeProiectMenu();
});

// ======== EXPORT PNG ========
async function exportPNG() {
  if (typeof html2canvas === 'undefined') { toast('❌ Librărie lipsă!'); return; }
  toast('📸 Se generează imaginea...');
  try {
    const canvas = await html2canvas(document.querySelector('.app'), {
      scale: 2, useCORS: true,
      backgroundColor: document.body.classList.contains('dark') ? '#1a1a2e' : '#f7f6f3',
      ignoreElements: el => ['toast','ctx','tip','proiectMenu','findBar','taskInfoModal','nameModal','confirmModal'].includes(el.id)
    });
    const link = document.createElement('a');
    link.download = 'gantt-' + fD(new Date()) + '.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    toast('✅ PNG salvat!');
  } catch(e) { toast('❌ Eroare la export PNG!'); }
}

// ======== EXPORT PDF ========
async function exportPDF() {
  if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') { toast('❌ Librărie lipsă!'); return; }
  toast('📄 Se generează PDF-ul...');
  try {
    const canvas = await html2canvas(document.querySelector('.app'), {
      scale: 2, useCORS: true,
      backgroundColor: document.body.classList.contains('dark') ? '#1a1a2e' : '#f7f6f3',
      ignoreElements: el => ['toast','ctx','tip','proiectMenu','findBar','taskInfoModal','nameModal','confirmModal'].includes(el.id)
    });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const imgW = canvas.width/2, imgH = canvas.height/2;
    const pdf = new jsPDF({ orientation: imgW>imgH?'landscape':'portrait', unit:'px', format:[imgW,imgH] });
    pdf.addImage(imgData,'PNG',0,0,imgW,imgH);
    pdf.save('gantt-'+fD(new Date())+'.pdf');
    toast('✅ PDF salvat!');
  } catch(e) { toast('❌ Eroare la export PDF!'); }
}

// ======== SIDE PANEL ========
function setMilestoneOf(id, on) {
  const t = T.find(x => x.id === id); if (!t || hasK(id)) return;
  pushHistory();
  t.isMilestone = !!on;
  if (on) { t.dur = 1; t.prog = 0; }
  syncTabData(); renderAll();
}

function applyConsFromPanel(id) {
  const t = T.find(x => x.id === id); if (!t || hasK(id)) return;
  const type = $("spCons").value, date = $("spConsDate").value;
  pushHistory();
  const old = t.cons && t.cons.type;
  if (type === "ASAP" || (CONS_NEEDS_DATE.includes(type) && !date)) delete t.cons;
  else t.cons = { type, date: CONS_NEEDS_DATE.includes(type) ? date : null };
  if (type !== "ALAP" || old !== "ALAP") delete t._alap;
  syncTabData(); renderAll();
}

function setDeadlineOf(id, v) {
  const t = T.find(x => x.id === id); if (!t) return;
  pushHistory();
  if (v) t.deadline = v; else delete t.deadline;
  syncTabData(); renderAll();
}

function setNotesOf(id, v) {
  const t = T.find(x => x.id === id); if (!t) return;
  v = v.trim();
  if (v === (t.notes || "")) return;
  pushHistory();
  if (v) t.notes = v; else delete t.notes;
  syncTabData(); renderAll();
}

// Panoul „Detalii Activitate" (vederea Arbore): toate câmpurile, grupate. Ștergerea / desprinderea sunt în meniul click-dreapta.
function renderSidePanel() {
  if (view !== "tree") return;
  const body = $("spBody"); if (!body) return;
  const t = sel ? T.find(x => x.id === sel) : null;
  if (!t) { body.innerHTML = '<div class="sp-empty">Alege o activitate (click pe un card) pentru a o vedea sau edita.<br><small>Click-dreapta pe un card: ștergere, desprindere, mutare.</small></div>'; return; }

  const isSumm = hasK(t.id), dp = Math.min(dep(t.id), 3), w = wbs(), p = ps(t);
  const bgColors  = ["var(--accent)","var(--blue)","var(--purple)","var(--amber)"];
  const bgLColors = ["var(--accentL)","var(--blueL)","var(--purpleL)","var(--amberL)"];
  const typeName = dp === 0 ? "Capitol principal" : `Subcapitol (nivel ${dp})`;
  const dis = isSumm ? "disabled" : "";
  const parent = t.pid ? T.find(x => x.id === t.pid) : null;
  const depsStr = (t.deps || []).map(d => (w[d.id] || "?") + ((d.type !== "FS" || d.lag) ? depLabel(d) : "")).join("; ");
  const succStr = T.filter(x => (x.deps || []).some(d => d.id === t.id)).map(x => { const d = x.deps.find(d => d.id === t.id); return (w[x.id] || "?") + " " + depLabel(d); }).join(", ") || "—";
  const c = cpm[t.id];
  const slack = c ? (c.crit ? '<span class="sp-crit">CRITIC · 0 zile rezervă</span>' : `${c.float} ${c.float === 1 ? "zi" : "zile"} rezervă`) : "—";
  const key = `onkeydown="if(event.key==='Enter'){this.blur()}if(event.key==='Escape'){renderAll()}"`;

  body.innerHTML = `
    <div class="sp-badge" style="background:${bgLColors[dp]};color:${bgColors[dp]};border-color:${bgColors[dp]}">${isSumm ? "🗂️" : "↳"} ${typeName} · ${w[t.id] || ""}</div>

    <div class="sp-sec">General</div>
    <div class="sp-group"><label class="sp-lbl">Nume</label>
      <input class="sp-in" value="${esc(t.nm)}" onchange="commitName(${t.id},this.value)" ${key}></div>
    <label class="sp-check"><input type="checkbox" ${t.isMilestone ? "checked" : ""} ${dis} onchange="setMilestoneOf(${t.id},this.checked)"> ♦ Milestone (punct cheie)</label>

    <div class="sp-sec">Planificare</div>
    <div class="sp-2col">
      <div class="sp-group"><label class="sp-lbl">Start</label>
        ${dtField(t.sd, {cls:"sp-in", dis:!!dis, onchange:`upd(${t.id},'sd',this.value)`})}</div>
      <div class="sp-group"><label class="sp-lbl">Final</label>
        ${dtField(fD(p._e), {cls:"sp-in", dis:!!dis, onchange:`upd(${t.id},'ed',this.value)`})}</div>
    </div>
    <div class="sp-2col">
      <div class="sp-group"><label class="sp-lbl">Durată (zile lucrătoare)</label>
        <input type="number" min="1" class="sp-in" value="${t.dur}" ${dis} onchange="upd(${t.id},'dur',this.value)" ${key}></div>
      <div class="sp-group"><label class="sp-lbl">Progres (%)</label>
        <input type="number" min="0" max="100" step="5" class="sp-in" value="${t.prog}" ${dis} onchange="upd(${t.id},'prog',this.value)" ${key}></div>
    </div>
    <div class="sp-range-row">
      <input type="range" class="sp-range" min="0" max="100" step="5" value="${t.prog}" ${dis}
        oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="upd(${t.id},'prog',this.value)">
      <span class="sp-val" style="background:${bgColors[dp]}">${t.prog}%</span>
    </div>

    <div class="sp-sec">Dependențe</div>
    <div class="sp-group"><label class="sp-lbl">Se face după (WBS[tip][±zile], separat cu ;)</label>
      <input class="sp-in" value="${esc(depsStr)}" placeholder="ex: 1.1; 2.3SS+2" onchange="updDeps(${t.id},this.value)" ${key}>
      <div class="dep-hint">Scrie numărul rândului după care se face. <b>1.2</b> = începe după ce se termină 1.2. <b>1.2SS+3</b> = începe la 3 zile după ce începe 1.2. Mai multe: separate cu ;</div></div>
    <div class="sp-info"><span>Urmează</span><b>${esc(succStr)}</b></div>

    <div class="sp-sec">Restricții și termen</div>
    <div class="sp-group"><label class="sp-lbl">Restricție</label>
      <select class="sp-in" id="spCons" ${dis} onchange="applyConsFromPanel(${t.id})">
        ${Object.keys(CONS_LABELS).map(k => `<option value="${k}" ${((t.cons && t.cons.type) || "ASAP") === k ? "selected" : ""}>${CONS_LABELS[k]}</option>`).join("")}
      </select></div>
    <div class="sp-2col">
      <div class="sp-group"><label class="sp-lbl">Data restricției</label>
        ${dtField(t.cons && t.cons.date ? t.cons.date : "", {cls:"sp-in", id:"spConsDate", dis:(isSumm || !(t.cons && CONS_NEEDS_DATE.includes(t.cons.type))), onchange:`applyConsFromPanel(${t.id})`})}</div>
      <div class="sp-group"><label class="sp-lbl">Termen limită</label>
        ${dtField(t.deadline || "", {cls:"sp-in", onchange:`setDeadlineOf(${t.id},this.value)`})}</div>
    </div>
    ${taskWarn[t.id] ? `<div class="sp-warn">⚠ ${[taskWarn[t.id].lateText, taskWarn[t.id].cons, taskWarn[t.id].res].filter(Boolean).map(esc).join("<br>⚠ ")}</div>` : ""}

    <div class="sp-sec">Resurse și cost</div>
    <div class="sp-info"><span>Cost</span><b>${costMap[t.id] ? fmtMoney(costMap[t.id]) : "—"}</b></div>
    ${(t.assign || []).filter(a => resById(a.rid)).map(a => { const r = resById(a.rid); return `<div class="sp-info"><span>${esc(r.name)}</span><b>${r.type === "cost" ? fmtMoney(a.units) : a.units + (r.type === "work" ? "%" : " " + (r.unit || ""))}</b></div>`; }).join("")}
    ${isSumm ? "" : `<button class="sp-btn" onclick="openTaskInfo(${t.id})">👥 Atribuie / schimbă resurse…</button>`}

    <div class="sp-sec">Analiză</div>
    <div class="sp-info"><span>Rezervă</span><b>${slack}</b></div>
    <div class="sp-info"><span>Capitol părinte</span><b>${parent ? esc((w[parent.id] || "") + " " + parent.nm) : "— (nivel principal)"}</b></div>
    ${isSumm ? `<div class="sp-info"><span>Conține</span><b>${allD(t.id).length} activități</b></div>` : ""}

    <div class="sp-sec">Note</div>
    <div class="sp-group"><textarea class="sp-in" rows="3" placeholder="Note opționale..." onchange="setNotesOf(${t.id},this.value)">${esc(t.notes || "")}</textarea></div>
  `;
}

function renderStatus(){
  const tab = tabs.find(t=>t.id===activeTabId);
  const tabName = tab ? tab.name : 'Proiect';
  const n=T.length, b=ab(), td=b?dD(b.mn,b.mx)+1:0, av=n?(T.reduce((s,t)=>s+t.dur,0)/n).toFixed(1):0, ap=n?Math.round(T.reduce((s,t)=>s+t.prog,0)/n):0;
  $("sbar").innerHTML=`<span style="color:#fff">📋 ${tabName} | Noduri: ${n} | Zile: ${td} | Durată Medie: ${av} zile | Progres Mediu: ${ap}%${showCritical&&cpmInfo.end?` | 🔴 Critice: ${cpmInfo.count} | Final proiect: ${fmtDate(pD(cpmInfo.end))}`:''}</span>${costMap.total?` | 💰 Buget: ${fmtMoney(costMap.total)}`:""}${behindCount()?` | <span title="Ar fi trebuit să fie gata până azi">⏰ ${behindCount()} întârziate</span>`:""}${typeof fileStatusHtml==="function"?fileStatusHtml():""}`;
}

function renderAll(){
  updateEmptyState();
  // Iterăm schedule + summaries până la stabilizare (dep-urile pe
  // capitole folosesc durata derivată din copii, care se poate schimba).
  for (let i = 0; i < 20; i++) {
    const snap = T.map(t => t.sd + '|' + t.dur).join(',');
    recalcSchedule();
    recalcSummaries();
    if (T.map(t => t.sd + '|' + t.dur).join(',') === snap) break;
  }
  computeCPM();
  // ALAP: dacă s-a consumat rezerva, mai rulăm o dată planificarea (maxim 3 ori)
  for (let k = 0; k < 3 && applyALAP(); k++) {
    for (let i = 0; i < 20; i++) {
      const snap = T.map(t => t.sd + '|' + t.dur).join(',');
      recalcSchedule(); recalcSummaries();
      if (T.map(t => t.sd + '|' + t.dur).join(',') === snap) break;
    }
    computeCPM();
  }
  computeResources();
  computeWarnings();
  renderTH();
  renderTBody();
  if(view==="gantt") renderGantt();
  if(view==="tree"){ renderTree(); renderSidePanel(); }
  renderStatus();
  saveAllTabs();
  updateUndoRedoBtns();
  if (typeof updateFormatTabVisibility === "function") updateFormatTabVisibility();
}

// ======== INIT ========
function syncScroll(){
  const tb=$("tBody"),gb=$("gBody");
  tb.addEventListener("scroll",()=>{gb.scrollTop=tb.scrollTop});
  gb.addEventListener("scroll",()=>{tb.scrollTop=gb.scrollTop});
}

function initSplitter(){
  const sp=$("splitter"),pl=$("paneL");
  let dr=false,sx,sw;
  sp.addEventListener("mousedown",e=>{
    // Ignoră click pe butonul extend din interiorul splitter-ului
    if(e.target.closest(".splitter-btn")) return;
    dr=true;sx=e.clientX;sw=pl.offsetWidth;document.body.style.cursor="col-resize";e.preventDefault();
  });
  document.addEventListener("mousemove",e=>{
    if(!dr) return;
    // Rămâne în modul extins (cu coloanele Note/Status/ID) cât timp îl tragi
    pl.style.width=Math.max(200,Math.min(window.innerWidth*0.88,sw+(e.clientX-sx)))+"px";
    if(isAutoZoom && typeof renderGantt==='function') renderGantt();
  });
  document.addEventListener("mouseup",()=>{if(dr){dr=false;document.body.style.cursor=""}});
}

// ======== VIEW SWITCH (Gantt / Arbore) ========
function setViewMode(v) {
  view = v;
  document.querySelectorAll(".vtab").forEach(t => t.classList.toggle("active", t.dataset.v === v));
  // Sincronizare cu butoanele din tab View
  const rbG = $("rbViewGantt"), rbT = $("rbViewTree");
  if (rbG) rbG.classList.toggle("active", v === "gantt");
  if (rbT) rbT.classList.toggle("active", v === "tree");
  $("splitView").style.display  = v === "gantt" ? "flex" : "none";
  $("treeLayout").style.display = v === "tree"  ? "flex" : "none";
  if (v !== "tree" && typeof _treePrev !== "undefined") _treePrev = null; // fără animație la revenire
  if (v === "tree") {
    _treePrev = null;
    // La deschidere: tot proiectul, toate capitolele deschise, încadrat și centrat
    treeFocus = null;
    T.forEach(t => { if (hasK(t.id)) treeOpen.add(t.id); });
    _treeHold = true; renderAll(); _treeHold = false;
    treeFit();
    return;
  }
  renderAll();
}

$("vtabs").addEventListener("click", e => {
  const tab = e.target.closest(".vtab");
  if (!tab) return;
  setViewMode(tab.dataset.v);
});

// ======== RIBBON TAB SWITCHING ========
$("ribbonTabs").addEventListener("click", e => {
  const tab = e.target.closest(".rb-tab");
  if (!tab) return;
  const which = tab.dataset.rt;
  document.querySelectorAll(".rb-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".rb-content").forEach(c => c.classList.remove("active"));
  tab.classList.add("active");
  const content = document.querySelector('.rb-content[data-rc="' + which + '"]');
  if (content) content.classList.add("active");
});

// Tab Format e vizibil doar dacă e selectat ceva
function updateFormatTabVisibility() {
  const fmt = $("rtFormat");
  if (!fmt) return;
  fmt.style.display = sel ? "" : "none";
  // Dacă era activ și nu mai e selecție → revin la Home
  if (!sel && fmt.classList.contains("active")) {
    document.querySelector('.rb-tab[data-rt="home"]').click();
  }
}

// ======== TOGGLE PANEL STÂNGA (extinde / restrânge) ========
let _paneLOriginalWidth = null;
function togglePaneL() {
  const pl = $("paneL");
  if (!pl) return;
  const btn = $("btnTogglePaneL");
  const splBtn = $("splitterBtn");
  const isExpanded = pl.classList.contains("expanded");
  if (isExpanded) {
    pl.classList.remove("expanded");
    if (_paneLOriginalWidth) pl.style.width = _paneLOriginalWidth;
    if (btn) btn.classList.remove("expanded-on");
    if (splBtn) splBtn.classList.remove("expanded-on");
    toast("⇔ Panel restrâns");
  } else {
    _paneLOriginalWidth = pl.style.width || "540px";
    pl.classList.add("expanded");
    // Pornește de la lățimea tuturor coloanelor (minim 50% din ecran); apoi o poți trage cu mouse-ul
    const colsW = [...C, ...CX].reduce((s, c) => s + c.w, 0) + 8;
    pl.style.width = Math.min(Math.max(colsW, innerWidth * 0.5), innerWidth * 0.88) + "px";
    if (btn) btn.classList.add("expanded-on");
    if (splBtn) splBtn.classList.add("expanded-on");
    toast("⇔ Panel extins (50% ecran) — coloane noi: Note, Status, ID");
  }
  if (typeof renderGantt === "function" && isAutoZoom) renderGantt();
}

// ======== MENIURI DERULANTE DIN RIBBON ========
function closeDD() { document.querySelectorAll(".rb-menu.open").forEach(m => m.classList.remove("open")); }
function toggleDD(btn) {
  const menu = btn.nextElementSibling, wasOpen = menu.classList.contains("open");
  closeDD();
  if (wasOpen) return;
  const r = btn.getBoundingClientRect();
  menu.classList.add("open");
  menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + "px";
  menu.style.top = (r.bottom + 4) + "px";
}
document.addEventListener("click", e => { if (!e.target.closest(".rb-dd")) closeDD(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDD(); });

// ======== LEGENDĂ GANTT ========
function toggleLegend(e) {
  if (e) e.stopPropagation();
  let p = $("legendPop");
  if (p) { p.remove(); return; }
  p = document.createElement("div");
  p.id = "legendPop"; p.className = "legend-pop";
  p.innerHTML = `<div class="lg-title">Legendă Gantt <button onclick="toggleLegend()">✕</button></div>
    <div class="lg-row"><i class="lg-today"></i><span><b>Linie roșie verticală</b> — ziua de azi.</span></div>
    <div class="lg-row"><i class="lg-bar crit"></i><span><b>Bară roșie</b> — activitate de pe drumul critic (orice întârziere mută finalul proiectului).</span></div>
    <div class="lg-row"><i class="lg-bl"></i><span><b>Linie subțire sub bară</b> — planul inițial (linia de bază). <b style="color:#d94040">Roșie</b> = activitatea a întârziat față de plan, <b style="color:#2f9e6a">verde</b> = mai devreme, gri = la termen.</span></div>
    <div class="lg-row"><i class="lg-late"></i><span><b>Punct roșu pe bară</b> — activitate întârziată: trebuia să fie gata până azi, dar nu e finalizată.</span></div>
    <div class="lg-row"><i class="lg-warn"></i><span><b>Contur portocaliu întrerupt</b> — avertisment: restricție neîndeplinită, termen depășit sau resursă supraalocată (detalii în bara de jos).</span></div>
    <div class="lg-row"><i class="lg-dl"></i><span><b>Dungă verde cu triunghi</b> — termen limită (deadline); devine roșie dacă e depășit.</span></div>
    <div class="lg-row"><i class="lg-arrow"></i><span><b>Săgeți</b> — dependențe: gri = FS, verde = SS, portocaliu = FF, mov = SF. Selectează o activitate ca să le vezi etichetele.</span></div>
    <div class="lg-row"><i class="lg-we"></i><span><b>Coloane roșiatice</b> — zile nelucrătoare (weekend sau zile libere din calendar).</span></div>`;
  document.body.appendChild(p);
  const b = $("btnLegend"); if (b) { const r = b.getBoundingClientRect(); p.style.top = (r.bottom + 6) + "px"; p.style.right = Math.max(8, innerWidth - r.right) + "px"; }
}
document.addEventListener("click", e => { const p = $("legendPop"); if (p && !p.contains(e.target) && !e.target.closest("#btnLegend")) p.remove(); });

// ======== ASCUNDE / ARATĂ BUTOANELE DE SUS ========
function toggleRibbon(force) {
  const on = typeof force === "boolean" ? force : !document.body.classList.contains("ribbon-collapsed");
  document.body.classList.toggle("ribbon-collapsed", on);
  const b = $("btnRibbonCollapse"); if (b) { b.innerHTML = '<svg class="ic"><use href="#' + (on ? "i-chevdown" : "i-chevup") + '"/></svg>'; b.title = on ? "Arată butoanele" : "Ascunde butoanele"; }
  try { localStorage.setItem("ganttRibbonCollapsed", on ? "1" : "0"); } catch (e) {}
  if (isAutoZoom && typeof renderGantt === "function") renderGantt();
}
$("ribbonTabs").addEventListener("dblclick", e => { if (e.target.closest(".rb-tab")) toggleRibbon(); });
try { if (localStorage.getItem("ganttRibbonCollapsed") === "1") toggleRibbon(true); } catch (e) {}

// ======== GANTT PE TOT ECRANUL ========
function toggleGanttFull() {
  const on = document.body.classList.toggle("gantt-full");
  if (on && view !== "gantt") setViewMode("gantt");
  renderAll();
  placeFsBar();
  toast(on ? "⛶ Gantt pe tot ecranul — Esc pentru ieșire" : "Revenit la vederea normală");
}
// Bara plutitoare stă imediat sub antetul calendarului (luni + zile)
function placeFsBar() {
  const h = $("gHead"), b = $("fsBar");
  if (h && b) b.style.top = (h.getBoundingClientRect().bottom + 8) + "px";
}
window.addEventListener("resize", () => { if (document.body.classList.contains("gantt-full")) placeFsBar(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.body.classList.contains("gantt-full") &&
      !document.querySelector(".modal-overlay.open, .dep-menu")) toggleGanttFull();
});

// ======== SCROLL LA AZI (📌) ========
function scrollToToday() {
  const gBody = $("gBody");
  if (!gBody || !T.length) return;
  const b = ab();
  if (!b) return;
  const cs = aD(b.mn, -3);
  const dw = +getComputedStyle(document.documentElement).getPropertyValue("--day-w").replace("px", "") || 30;
  const offset = dD(cs, new Date()) * dw;
  gBody.scrollLeft = Math.max(0, offset - gBody.clientWidth / 2);
  toast("📌 Sărit la azi");
}

// ======== TAB-URI PROIECT (rapide) ========
function renameActiveTab() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  showNameModal(tab.name, function(newName) {
    tab.name = newName;
    saveAllTabs();
    renderTabsBar();
    renderAll();
    toast("✏️ Tab redenumit");
  });
}

function closeActiveTab() {
  closeTab(activeTabId);
}

// ======== PROIECT NOU / EXEMPLU / ECRAN DE BUN VENIT ========
function newProject() {
  showNameModal("Proiect " + (tabs.length + 1), function(name) {
    addNewTab(name);
    toast("📁 Proiect nou. Începe cu + Activitate sau + Capitol");
  });
}

function openExample() {
  addNewTab("Exemplu — Hală industrială");
  loadDemo();
}

// Când nu e niciun proiect deschis: ecran de bun venit cu butoane mari și proiecte recente
function updateEmptyState() {
  const empty = !tabs.length;
  document.body.classList.toggle("no-project", empty);
  if (empty && typeof renderRecents === "function") renderRecents();
}

// ======== SELECȚIE + TASTE ========
function setSel(id) { sel = id; renderAll(); }
function deselectAll() { if (sel === null) return; sel = null; renderAll(); }

// Click pe spațiul gol de sub activități (tabel sau Gantt) = nimic selectat
document.addEventListener("click", e => {
  if (e.target.id === "tBody" || e.target.id === "gBody") deselectAll();
});

function _scrollRowIntoView(id) {
  const r = document.querySelector('.t-row[data-tid="' + id + '"]');
  if (r) r.scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown",e=>{
  if(!tabs.length){ if((e.ctrlKey||e.metaKey)&&e.key==="n"){ e.preventDefault(); newProject(); } return; }
  if((e.ctrlKey||e.metaKey)&&e.key==="z"){ e.preventDefault(); undo(); return; }
  if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="Z"))){ e.preventDefault(); redo(); return; }
  if(e.target.tagName==="INPUT"||e.target.tagName==="SELECT"||e.target.tagName==="TEXTAREA") return;
  if(document.querySelector(".modal-overlay.open")) return;
  if((e.ctrlKey||e.metaKey)&&e.key==="n"){ e.preventDefault(); newProject(); return; }
  if(e.key==="Escape"){ closeProiectMenu(); if(!document.body.classList.contains("gantt-full")) deselectAll(); return; }
  if(e.key==="Delete"&&sel) delSel();
  if(e.key==="Tab"&&sel){e.preventDefault();if(e.shiftKey)outdentSel();else indentSel(); return;}
  if(view!=="gantt" || e.ctrlKey || e.metaKey || e.target.tagName==="BUTTON") return;
  // Navigare cu săgeți în tabel (când nu scrii într-o celulă)
  if(e.key==="ArrowUp"||e.key==="ArrowDown"){
    e.preventDefault();
    const dir=e.key==="ArrowUp"?-1:1;
    if(e.altKey){ if(sel) moveSel(dir); return; }
    const o=flat(); if(!o.length) return;
    const i=o.findIndex(t=>t.id===sel);
    const n=i<0?(dir>0?0:o.length-1):Math.max(0,Math.min(o.length-1,i+dir));
    setSel(o[n].id); _scrollRowIntoView(o[n].id);
  } else if(sel && e.key==="ArrowRight"){ e.preventDefault(); indentSel(); _scrollRowIntoView(sel); }
  else if(sel && e.key==="ArrowLeft"){ e.preventDefault(); outdentSel(); _scrollRowIntoView(sel); }
  else if(sel && e.key==="Enter"){
    e.preventDefault();
    const inp=document.querySelector('.t-row[data-tid="'+sel+'"] .c-name input');
    if(inp){ inp.focus(); inp.select(); }
  }
});

window.addEventListener("resize",()=>{
  if(isAutoZoom && typeof renderGantt==='function') renderGantt();
});

// ======== BOOT ========
initDark();
initSplitter();
syncScroll();
$("splitView").style.display = "flex";
$("treeLayout").style.display = "none";
view = "gantt";

// Încarcă proiectele salvate; la prima rulare (sau după ce le închizi pe toate) apare ecranul de bun venit
dtWrapStatic("atStart"); dtWrapStatic("calHolDate");
const hadData = loadAllTabs();
if (!hadData) { tabs = []; activeTabId = null; }

renderTabsBar();
renderAll();
// Sincronizare inițială butoane View ribbon
if ($("rbViewGantt")) $("rbViewGantt").classList.add("active");
if (showCritical && $("btnCrit")) $("btnCrit").classList.add("active");
if (typeof _refreshPlanUI === "function") _refreshPlanUI();
if (hadData && tabs.length) toast('📂 Proiecte restaurate!');

// PWA: service worker (aplicația merge și offline); doar pe http(s), nu pe file://
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
