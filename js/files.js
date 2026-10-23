// ============================================================
// FIȘIERE PE DISC — Salvează / Salvează ca / Deschide + salvare automată
// ============================================================
// Folosește File System Access API (Chrome / Edge). Fără suport (ex. Firefox) cade pe
// export/import manual. Fișierul are același format ca „Export JSON", deci sunt compatibile.
const fsSupported = "showSaveFilePicker" in window && "showOpenFilePicker" in window;
const fileHandles = {};   // tabId -> FileSystemFileHandle (doar cât timp pagina e deschisă)
const fileAuto = {};      // tabId -> bool (salvare automată în fișier)
const fileSavedAt = {};   // tabId -> Date ultimei scrieri în fișier
const fileNames = {};     // tabId -> numele fișierului

function _fileTab() { return tabs.find(t => t.id === activeTabId); }

function _projectJSON() {
  const tab = _fileTab();
  return JSON.stringify({ T, nid, cal: CAL, res: RES, name: tab ? tab.name : "Proiect", exportedAt: new Date().toISOString() }, null, 2);
}

async function _writeHandle(handle) {
  const w = await handle.createWritable();
  await w.write(_projectJSON());
  await w.close();
  fileSavedAt[activeTabId] = new Date();
  renderStatus();
}

const _pickerTypes = [{ description: "Proiect Gantt PRO", accept: { "application/json": [".json"] } }];

async function fileSaveAs() {
  if (!tabs.length) return;
  if (!fsSupported) { exportJSON(); return; }
  try {
    const tab = _fileTab();
    const handle = await showSaveFilePicker({ suggestedName: ((tab && tab.name) || "proiect").replace(/[\\/:*?"<>|]/g, "-") + ".gantt.json", types: _pickerTypes });
    fileHandles[activeTabId] = handle; fileNames[activeTabId] = handle.name;
    await _writeHandle(handle); recentAdd(handle);
    toast("💾 Salvat în " + handle.name);
  } catch (e) { if (e.name !== "AbortError") toast("❌ Nu s-a putut salva: " + e.message); }
}

async function fileSave() {
  if (!tabs.length) return;
  if (!fsSupported) { exportJSON(); return; }
  const handle = fileHandles[activeTabId];
  if (!handle) return fileSaveAs();
  try { await _writeHandle(handle); toast("💾 Salvat în " + handle.name); }
  catch (e) { if (e.name !== "AbortError") toast("❌ Nu s-a putut salva: " + e.message); }
}

// ---------- Proiecte recente (mânerele fișierelor se păstrează în IndexedDB) ----------
function _recDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open("ganttPRO_files", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("recent", { keyPath: "name" });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function recentAdd(handle) {
  try {
    const db = await _recDB();
    db.transaction("recent", "readwrite").objectStore("recent").put({ name: handle.name, handle, at: Date.now() });
  } catch (e) {}
}
async function recentList() {
  try {
    const db = await _recDB();
    return await new Promise(res => {
      const rq = db.transaction("recent").objectStore("recent").getAll();
      rq.onsuccess = () => res(rq.result.sort((a, b) => b.at - a.at).slice(0, 8));
      rq.onerror = () => res([]);
    });
  } catch (e) { return []; }
}
async function recentRemove(name) {
  try { const db = await _recDB(); db.transaction("recent", "readwrite").objectStore("recent").delete(name); } catch (e) {}
}
let _recents = [];
async function renderRecents() {
  const box = $("wlRecent"); if (!box) return;
  _recents = fsSupported ? await recentList() : [];
  if (!_recents.length) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="wl-rtitle">Proiecte recente</div>' + _recents.map((r, i) =>
    '<button class="wl-rec" onclick="openRecent(' + i + ')"><svg class="ic"><use href="#i-folder"/></svg><span>' + esc(r.name.replace(/\.gantt\.json$|\.json$/i, "")) +
    '</span><small>' + fmtDate(new Date(r.at)) + '</small></button>').join("");
}
async function openRecent(i) {
  const r = _recents[i]; if (!r) return;
  try {
    if (r.handle.requestPermission && (await r.handle.requestPermission({ mode: "readwrite" })) !== "granted") { toast("⚠️ Fără acces la fișier"); return; }
    await _openHandle(r.handle);
  } catch (e) { toast("❌ Fișierul nu mai există sau nu poate fi deschis"); recentRemove(r.name); renderRecents(); }
}

// Deschide un fișier; dacă e deja deschis într-un tab, doar te duce la acel tab (nu face dublură)
async function _openHandle(handle) {
  for (const tid of Object.keys(fileHandles)) {
    const id = +tid;
    if (!tabs.some(t => t.id === id)) continue;
    try {
      if (await fileHandles[id].isSameEntry(handle)) { switchTab(id); toast("📂 Fișierul era deja deschis — te-am dus la el"); return; }
    } catch (e) {}
  }
  const d = JSON.parse(await (await handle.getFile()).text());
  if (!d.T || !Array.isArray(d.T)) throw new Error("Format invalid");
  const name = d.name || handle.name.replace(/\.gantt\.json$|\.json$/i, "");
  const tab = addNewTab(name, d.T, d.nid || (d.T.length ? Math.max(...d.T.map(x => x.id)) + 1 : 1), d.cal, d.res);
  fileHandles[tab.id] = handle; fileNames[tab.id] = handle.name; fileSavedAt[tab.id] = new Date();
  renderStatus();
  recentAdd(handle);
  toast("📂 Deschis: " + handle.name);
}

async function fileOpen() {
  if (!fsSupported) { importJSONasTab(); return; }
  try {
    const [handle] = await showOpenFilePicker({ types: _pickerTypes, multiple: false });
    await _openHandle(handle);
  } catch (e) { if (e.name !== "AbortError") toast("❌ Fișier invalid sau inaccesibil"); }
}

function fileToggleAuto() {
  if (!fsSupported) { toast("ℹ️ Salvarea automată în fișier merge în Chrome / Edge"); return; }
  const on = !fileAuto[activeTabId];
  if (on && !fileHandles[activeTabId]) {
    // întâi alegem fișierul, apoi pornim salvarea automată
    fileSaveAs().then(() => { if (fileHandles[activeTabId]) { fileAuto[activeTabId] = true; _refreshFileUI(); toast("🔁 Salvare automată în fișier: pornită"); } });
    return;
  }
  fileAuto[activeTabId] = on;
  _refreshFileUI();
  toast(on ? "🔁 Salvare automată în fișier: pornită" : "Salvare automată în fișier: oprită");
  if (on) fileSave();
}

// Apelat după fiecare salvare locală (din saveAllTabs)
async function fileAutoWrite() {
  const handle = fileHandles[activeTabId];
  if (!handle || !fileAuto[activeTabId]) return;
  try {
    if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") return;
    await _writeHandle(handle);
  } catch (e) { /* fără permisiune: se salvează manual */ }
}

function fileStatusHtml() {
  const n = fileNames[activeTabId];
  if (!n) return '<span style="color:rgba(255,255,255,.75);margin-left:14px">📄 Doar în browser — salvează cu Ctrl+S</span>';
  const t = fileSavedAt[activeTabId];
  const hh = t ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "";
  return `<span style="color:#fff;margin-left:14px">📄 ${esc(n)}${hh ? " · salvat " + hh : ""}${fileAuto[activeTabId] ? " · 🔁 auto" : ""}</span>`;
}

function _refreshFileUI() {
  const b = $("btnFileAuto"); if (b) b.classList.toggle("active", !!fileAuto[activeTabId]);
  renderStatus();
}

// Scurtături: Ctrl+S = Salvează, Ctrl+Shift+S = Salvează ca, Ctrl+O = Deschide
document.addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); e.shiftKey ? fileSaveAs() : fileSave(); }
  else if (k === "o") { e.preventDefault(); fileOpen(); }
});
