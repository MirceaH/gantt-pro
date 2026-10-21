// ======== DARK MODE ========
function toggleDark() {
  const isDark = document.body.classList.toggle("dark");
  const btn = $("btnDark");
  if (btn) { btn.textContent = isDark ? "☀️" : "🌙"; btn.title = isDark ? "Light mode" : "Dark mode"; }
  localStorage.setItem("ganttDark", isDark ? "1" : "0");
}

function initDark() {
  if (localStorage.getItem("ganttDark") === "1") {
    document.body.classList.add("dark");
    const btn = $("btnDark");
    if (btn) { btn.textContent = "☀️"; btn.title = "Light mode"; }
  }
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
        <input type="date" class="sp-in" value="${t.sd}" ${dis} onchange="upd(${t.id},'sd',this.value)" ${key}></div>
      <div class="sp-group"><label class="sp-lbl">Final</label>
        <input type="date" class="sp-in" value="${fD(p._e)}" ${dis} onchange="upd(${t.id},'ed',this.value)" ${key}></div>
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
    <div class="sp-group"><label class="sp-lbl">Predecesori (WBS[tip][±zile], separat cu ;)</label>
      <input class="sp-in" value="${esc(depsStr)}" placeholder="ex: 1.1; 2.3SS+2" onchange="updDeps(${t.id},this.value)" ${key}></div>
    <div class="sp-info"><span>Succesori</span><b>${esc(succStr)}</b></div>

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
  $("sbar").innerHTML=`<span style="color:#fff">📋 ${tabName} | Noduri: ${n} | Zile: ${td} | Durată Medie: ${av} zile | Progres Mediu: ${ap}%${showCritical&&cpmInfo.end?` | 🔴 Critice: ${cpmInfo.count} | Final proiect: ${fmtDate(pD(cpmInfo.end))}`:''}</span>${typeof fileStatusHtml==="function"?fileStatusHtml():""}`;
}

function renderAll(){
  // Iterăm schedule + summaries până la stabilizare (dep-urile pe
  // capitole folosesc durata derivată din copii, care se poate schimba).
  for (let i = 0; i < 20; i++) {
    const snap = T.map(t => t.sd + '|' + t.dur).join(',');
    recalcSchedule();
    recalcSummaries();
    if (T.map(t => t.sd + '|' + t.dur).join(',') === snap) break;
  }
  computeCPM();
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

// ======== ASCUNDE / ARATĂ BUTOANELE DE SUS ========
function toggleRibbon(force) {
  const on = typeof force === "boolean" ? force : !document.body.classList.contains("ribbon-collapsed");
  document.body.classList.toggle("ribbon-collapsed", on);
  const b = $("btnRibbonCollapse"); if (b) { b.textContent = on ? "⌄" : "⌃"; b.title = on ? "Arată butoanele" : "Ascunde butoanele"; }
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

document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==="z"){ e.preventDefault(); undo(); return; }
  if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="Z"))){ e.preventDefault(); redo(); return; }
  if(e.target.tagName==="INPUT"||e.target.tagName==="SELECT"||e.target.tagName==="TEXTAREA") return;
  if(e.key==="Escape") closeProiectMenu();
  if(e.key==="Delete"&&sel) delSel();
  if(e.key==="Tab"&&sel){e.preventDefault();if(e.shiftKey)outdentSel();else indentSel()}
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

// Încarcă tab-urile salvate sau creează primul tab implicit
const hadData = loadAllTabs();
if (!hadData) {
  // Prima rulare — creăm un tab implicit fără a folosi addNewTab (ca să nu triggăm renderAll prea devreme)
  tabs = [{ id: nextTabId++, name: "Proiectul Meu", T: [], nid: 1 }];
  activeTabId = tabs[0].id;
}

renderTabsBar();
renderAll();
// Sincronizare inițială butoane View ribbon
if ($("rbViewGantt")) $("rbViewGantt").classList.add("active");
if (showCritical && $("btnCrit")) $("btnCrit").classList.add("active");
if (hadData) toast('📂 Proiecte restaurate!');
// Prima deschidere: se încarcă demo-ul, ca să se vadă imediat ce poate aplicația
else { loadDemo(); }

// PWA: service worker (aplicația merge și offline); doar pe http(s), nu pe file://
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
