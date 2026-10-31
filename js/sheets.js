// ============================================================
// EXCEL / CSV — export și import al listei de activități
// ============================================================
// Export: .xlsx (date reale, capitole îngroșate, antet înghețat, filtre) sau .csv (separator ;, UTF-8 cu BOM, se deschide direct în Excel).
// Import: .xlsx sau .csv → proiect nou într-un tab nou (nu atinge proiectul curent). Coloanele se recunosc după titlu
// (română sau engleză): Activitate, Durată, Start, Final, Progres, Se face după, WBS / Nivel, Început real, Final real, Note.
const SH_HEAD = ['WBS', 'Activitate', 'Durată (zile)', 'Start', 'Final', 'Progres %', 'Se face după', 'Rezervă (zile)', 'Cost', 'Resurse', 'Început real', 'Final real', 'Note'];
const SH_WIDTHS = [8, 44, 13, 12, 12, 11, 18, 14, 14, 34, 13, 13, 40];

// Toate activitățile, în ordinea ierarhiei, indiferent de filtru sau de capitolele închise
function _allRowsInOrder() {
  const out = [];
  (function w(list) { list.forEach(t => { out.push(t); w(kids(t.id)); }); })(T.filter(t => !t.pid));
  return out;
}

function _sheetData() {
  const w = wbs();
  return _allRowsInOrder().map(t => {
    const isSumm = hasK(t.id), isMs = !!t.isMilestone && !isSumm;
    const deps = (t.deps || []).map(d => (w[d.id] || '?') + ((d.type !== 'FS' || d.lag) ? depLabel(d) : '')).join('; ');
    const res = (t.assign || []).filter(a => resById(a.rid)).map(a => { const r = resById(a.rid); return r.name + ' ' + (r.type === 'work' ? a.units + '%' : (r.type === 'cost' ? fmtMoney(a.units) : a.units + ' ' + (r.unit || ''))); }).join('; ');
    return {
      t, summ: isSumm,
      wbs: w[t.id] || '', nm: t.nm, dur: isMs ? 0 : t.dur, sd: t.sd, ed: fD(endDate(t)), prog: t.prog || 0, deps,
      float: (!isSumm && cpm[t.id]) ? cpm[t.id].float : '', cost: costMap[t.id] || '', res,
      as: (!isSumm && t.as) || '', af: (!isSumm && t.af) || '', notes: t.notes || ''
    };
  });
}

function _projName() { const tab = tabs.find(t => t.id === activeTabId); return tab ? tab.name : 'Plan'; }
const _safeFile = s => String(s).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'plan';

function _downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Foile pentru xlsx: „Plan" (activitățile) și „Resurse"
function buildWorkbookBytes() {
  const data = _sheetData();
  const plan = [SH_HEAD.map(h => ({ v: h, s: XL.S_HEAD }))];
  data.forEach(d => {
    const sT = d.summ ? XL.S_CH : 0, sD = d.summ ? XL.S_CH_DATE : XL.S_DATE, sM = d.summ ? XL.S_CH_MONEY : XL.S_MONEY;
    plan.push([
      { v: d.wbs, s: sT }, { v: d.nm, s: sT }, { v: d.dur, t: 'n', s: sT }, { v: d.sd, t: 'd', s: sD }, { v: d.ed, t: 'd', s: sD },
      { v: d.prog, t: 'n', s: sT }, { v: d.deps, s: sT }, { v: d.float, t: 'n', s: sT }, { v: d.cost, t: 'n', s: sM }, { v: d.res, s: sT },
      { v: d.as, t: 'd', s: sD }, { v: d.af, t: 'd', s: sD }, { v: d.notes, s: sT }
    ]);
  });
  const sheets = [{ name: 'Plan', widths: SH_WIDTHS, rows: plan, freezeHeader: true, filter: true }];
  if (RES.list.length) {
    const rr = [['Resursă', 'Tip', 'Tarif', 'Capacitate max %', 'Unitate', 'Cost total'].map(h => ({ v: h, s: XL.S_HEAD }))];
    RES.list.forEach(r => rr.push([r.name, RES_TYPES[r.type] || r.type, { v: r.rate || 0, t: 'n' }, r.type === 'work' ? { v: r.max || 100, t: 'n' } : '', r.unit || '', { v: byResCost[r.id] || 0, t: 'n', s: XL.S_MONEY }]));
    sheets.push({ name: 'Resurse', widths: [28, 12, 10, 16, 10, 14], rows: rr, freezeHeader: true });
  }
  return xlsxBuild(sheets);
}

function exportXLSX() {
  if (!T.length) { toast('⚠️ Proiect gol'); return; }
  _downloadBytes(buildWorkbookBytes(), _safeFile(_projName()) + '-' + fD(new Date()) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  toast('📗 Excel exportat (' + T.length + ' rânduri)');
}

// Excel desparte coloanele după „separatorul de liste" din setările Windows: ; (România, Germania…) sau , (SUA).
// Îl ghicim după separatorul zecimal al browserului: virgulă → ;  altfel → ,
function csvDelimiter() { return (1.5).toLocaleString().includes(',') ? ';' : ','; }

function buildCsvText(delim) {
  const rows = [SH_HEAD.slice()];
  _sheetData().forEach(d => rows.push([d.wbs, d.nm, d.dur, fmtRO(d.sd), fmtRO(d.ed), d.prog, d.deps, d.float, d.cost ? Math.round(d.cost) : '', d.res, d.as ? fmtRO(d.as) : '', d.af ? fmtRO(d.af) : '', d.notes]));
  return csvBuild(rows, delim || csvDelimiter());
}

function exportCSV() {
  if (!T.length) { toast('⚠️ Proiect gol'); return; }
  const d = csvDelimiter();
  _downloadBytes(buildCsvText(d), _safeFile(_projName()) + '-' + fD(new Date()) + '.csv', 'text/csv;charset=utf-8');
  toast('📄 CSV exportat (separator „' + d + '” după setările tale) — se deschide direct în Excel');
}

// ---------- import ----------
const SH_MAP = {
  nm: ['activitate', 'activitati', 'nume', 'denumire', 'task', 'taskname', 'name', 'descriere', 'lucrare'],
  wbs: ['wbs', 'nr', 'nrcrt', 'cod', 'outlinenumber'],
  level: ['nivel', 'level', 'outlinelevel'],
  dur: ['duratazile', 'durata', 'zile', 'duration', 'days', 'dur', 'zilelucratoare'],
  sd: ['start', 'inceput', 'datastart', 'startdate', 'begin', 'datainceput'],
  ed: ['final', 'sfarsit', 'datafinal', 'finish', 'end', 'enddate', 'terminare', 'datasfarsit'],
  prog: ['progres%', 'progres', 'procent', '%', '%complete', 'percentcomplete', 'completat', '%finalizat', 'finalizat%'],
  deps: ['sefacedupa', 'dupa', 'predecesori', 'predecessors', 'predecessor', 'dependente', 'legaturi'],
  as: ['inceputreal', 'startreal', 'actualstart'],
  af: ['finalreal', 'sfarsitreal', 'actualfinish'],
  notes: ['note', 'notes', 'observatii', 'comentarii', 'obs']
};
const _hn = s => _normTxt(s).replace(/[^a-z0-9%]/g, '');

// Cuvinte-cheie pentru titluri care nu sunt exact cele de mai sus (ex: „Denumire lucrare", „Data început planificat")
const SH_FUZZY = [
  ['inceputreal', 'as'], ['startreal', 'as'], ['actualstart', 'as'], ['finalreal', 'af'], ['sfarsitreal', 'af'], ['actualfinish', 'af'],
  ['activitate', 'nm'], ['denumire', 'nm'], ['lucrare', 'nm'], ['taskname', 'nm'], ['nume', 'nm'],
  ['predecesor', 'deps'], ['predecessor', 'deps'], ['sefacedupa', 'deps'], ['dependent', 'deps'], ['legatur', 'deps'],
  ['durata', 'dur'], ['duration', 'dur'], ['inceput', 'sd'], ['start', 'sd'], ['begin', 'sd'], ['sfarsit', 'ed'], ['finish', 'ed'], ['terminare', 'ed'], ['final', 'ed'],
  ['progres', 'prog'], ['procent', 'prog'], ['complete', 'prog'], ['observati', 'notes'], ['comentari', 'notes'], ['notes', 'notes'], ['nivel', 'level'], ['level', 'level'], ['wbs', 'wbs'], ['nrcrt', 'wbs']
].sort((a, b) => b[0].length - a[0].length);

// Titlurile unui rând → { cheie: indexul coloanei }; întâi potrivire exactă, apoi după cuvinte-cheie
function _matchHeaders(cells) {
  const c = {}, hn = cells.map(h => _hn(h));
  hn.forEach((h, j) => { const k = Object.keys(SH_MAP).find(key => c[key] === undefined && SH_MAP[key].includes(h)); if (k) c[k] = j; });
  const used = new Set(Object.values(c));
  hn.forEach((h, j) => { if (!h || used.has(j)) return; const hit = SH_FUZZY.find(([w, k]) => c[k] === undefined && h.includes(w)); if (hit) { c[hit[1]] = j; used.add(j); } });
  return c;
}

function _shDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v > 20000 && v < 80000 ? _serialToISO(v) : '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const iso = s.slice(0, 10); return fD(pD(iso)) === iso ? iso : ''; }
  return parseRO(s) || '';
}
function _shNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const m = String(v == null ? '' : v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Rânduri brute (matrice) → { ok, error, tasks, depText, refByWbs, notes } — fără să atingă proiectul curent
function parseSheetRows(rows) {
  let hi = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
    const c = _matchHeaders(rows[i] || []);
    if (c.nm !== undefined) { hi = i; col = c; }
  }
  if (hi < 0) return { ok: false, error: 'Nu am găsit coloana „Activitate” (sau „Nume”). Pune titluri de coloană în primul rând.' };
  const get = (r, k) => (col[k] === undefined ? '' : r[col[k]]);
  const data = rows.slice(hi + 1).filter(r => r && r.some(c => String(c == null ? '' : c).trim() !== '') && String(get(r, 'nm')).trim() !== '');
  if (!data.length) return { ok: false, error: 'Fișierul nu conține activități sub titlurile de coloană.' };

  // progres exprimat ca fracție (0–1)? → procente
  const progs = data.map(r => _shNum(get(r, 'prog'))).filter(v => v !== null);
  const frac = progs.length > 0 && Math.max(...progs) <= 1 && progs.some(v => v > 0 && v < 1);   // celule procentuale din Excel (0,4 = 40%)
  const wbsOk = col.wbs !== undefined && data.filter(r => /^\d+(\.\d+)*$/.test(String(get(r, 'wbs')).trim())).length >= data.length / 2;

  const tasks = [], depText = {}, refByWbs = {}, refByRow = {}, levelStack = [];
  let defaults = 0;
  data.forEach((r, i) => {
    const id = i + 1, t = { id, nm: String(get(r, 'nm')).trim().slice(0, 300), sd: '', dur: 1, prog: 0, pid: null, deps: [] };
    // dată de start, final, durată
    const sd = _shDate(get(r, 'sd')), ed = _shDate(get(r, 'ed')); let dur = _shNum(get(r, 'dur'));
    if (sd) t.sd = sd;
    if (dur === null && sd && ed && ed >= sd) dur = workDur(pD(sd), pD(ed));
    if (dur === null) { dur = 1; defaults++; }
    dur = Math.round(dur);
    if (dur <= 0) { t.isMilestone = true; dur = 1; }
    t.dur = Math.max(1, dur);
    let pv = _shNum(get(r, 'prog')); if (pv !== null) { if (frac) pv *= 100; t.prog = Math.max(0, Math.min(100, Math.round(pv))); }
    const as = _shDate(get(r, 'as')), af = _shDate(get(r, 'af'));
    if (as) t.as = as; if (af && (!as || af >= as)) t.af = af;
    const notes = String(get(r, 'notes') || '').trim(); if (notes) t.notes = notes.slice(0, 2000);
    // ierarhie: după WBS, altfel după nivel, altfel plat
    if (wbsOk) {
      const wb = String(get(r, 'wbs')).trim();
      if (/^\d+(\.\d+)*$/.test(wb)) { refByWbs[wb] = id; const cut = wb.lastIndexOf('.'); if (cut > 0 && refByWbs[wb.slice(0, cut)]) t.pid = refByWbs[wb.slice(0, cut)]; }
    } else if (col.level !== undefined) {
      const lv = Math.max(1, Math.round(_shNum(get(r, 'level')) || 1));
      levelStack.length = Math.min(levelStack.length, lv - 1);
      t.pid = lv > 1 && levelStack[lv - 2] ? levelStack[lv - 2] : null;
      levelStack[lv - 1] = id;
    }
    refByRow[String(id)] = id;
    const dp = String(get(r, 'deps') == null ? '' : get(r, 'deps')).trim(); if (dp) depText[id] = dp;
    tasks.push(t);
  });
  // capitolele nu sunt repere
  const parents = new Set(tasks.map(t => t.pid).filter(Boolean)); tasks.forEach(t => { if (parents.has(t.id)) delete t.isMilestone; });
  // data de start lipsă = începutul proiectului (cea mai devreme dată dată, sau prima zi lucrătoare de azi)
  const given = tasks.map(t => t.sd).filter(Boolean).sort(), start = given[0] || fD(nextWork(new Date()));
  tasks.forEach(t => { if (!t.sd) t.sd = start; });
  return { ok: true, tasks, depText, refMap: wbsOk ? refByWbs : refByRow, refKind: wbsOk ? 'WBS' : 'numărul rândului', defaults, hasStart: col.sd !== undefined };
}

// Creează proiectul într-un tab nou; returnează un rezumat
function importRowsAsTab(rows, name) {
  const p = parseSheetRows(rows);
  if (!p.ok) { toast('❌ ' + p.error); return null; }
  const tab = addNewTab(name, p.tasks, p.tasks.length + 1);
  let linked = 0, ignored = 0;
  Object.keys(p.depText).forEach(id => {
    const t = T.find(x => x.id === +id), list = [];
    p.depText[id].split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(tok => {
      const d = _parseDepToken(tok), pid = d ? p.refMap[d.wbs] : undefined;
      if (pid !== undefined && pid !== t.id) list.push({ id: pid, type: d.type, lag: d.lag }); else ignored++;
    });
    if (list.length) { _applyDepsSafely(t, list); linked += t.deps.length; }
  });
  syncTabData(); renderAll();
  const msg = ['📥 Importat „' + name + '”: ' + p.tasks.length + ' activități'];
  if (linked) msg.push(linked + ' legături'); if (p.defaults) msg.push(p.defaults + ' fără durată → 1 zi'); if (ignored) msg.push(ignored + ' legături nerecunoscute');
  toast(msg.join(' · '));
  return { tab, parsed: p, linked, ignored };
}

async function importSheetFile(file) {
  const name = file.name.replace(/\.(xlsx|xlsm|csv|txt)$/i, '');
  let rows;
  if (/\.(csv|txt)$/i.test(file.name)) rows = csvParse(await file.text());
  else {
    const wb = await xlsxRead(await file.arrayBuffer());
    const sh = wb.sheets.find(s => parseSheetRows(s.rows).ok) || wb.sheets[0];
    if (!sh) throw new Error('Fișierul nu conține nicio foaie');
    rows = sh.rows;
  }
  return importRowsAsTab(rows, name);
}

function importSheet() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xlsx,.xlsm,.csv,.txt';
  input.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await importSheetFile(f); } catch (err) { toast('❌ ' + (err && err.message ? err.message : 'Fișier invalid')); }
  };
  document.body.appendChild(input); input.click(); document.body.removeChild(input);
}
