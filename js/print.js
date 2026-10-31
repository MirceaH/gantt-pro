// ============================================================
// TIPĂRIRE / PDF — planul pe pagini (tabel + Gantt, aceleași rânduri ca pe ecran)
// ============================================================
// Cum funcționează: randăm Gantt-ul la o scară care încape pe lățimea paginii, îi capturăm HTML-ul și construim
// pagini de hârtie (A4 / A3 / Letter) cu antet, titlu și subsol. Fiecare pagină ia o felie de rânduri din tabel și
// aceeași felie din Gantt, deci rândurile rămân pe aceeași linie. „Tipărește" folosește tipărirea browserului
// (în fereastra ei alegi „Salvează ca PDF" pentru un PDF vectorial); „PDF (imagine)" generează direct un fișier.
// Se tipărește ce vezi: filtrul activ și capitolele închise se respectă. Tema este mereu cea luminoasă (pe hârtie).
const PP_PAPER = { a4: [793.7, 1122.5], a3: [1122.5, 1587.4], letter: [816, 1056] };   // px la 96 dpi, portret
const PP = { MARGIN: 30, TITLE_H: 42, FOOT_H: 18, ROW_H: 30 };
const PP_COLS = [['WBS', 40, 'pc-wbs'], ['Activitate', 204, 'pc-nm'], ['Zile', 36, 'pc-n'], ['Start', 64, 'pc-d'], ['Final', 64, 'pc-d'], ['%', 38, 'pc-n']];
PP.TW = PP_COLS.reduce((s, c) => s + c[1], 0);
let _ppDark = false;

const _ppShort = d => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getFullYear()).slice(2);
const _ppTime = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

function _ppOptions() {
  const paper = $('ppPaper').value, land = $('ppOrient').value === 'l';
  const [w0, h0] = PP_PAPER[paper] || PP_PAPER.a4;
  return { paper, land, one: $('ppFit').value === '1', names: $('ppNames').checked, pw: land ? h0 : w0, ph: land ? w0 : h0, title: $('ppTitle').value.trim() };
}

function _ppSaveOpts() {
  try { localStorage.setItem('ganttPrintOpts', JSON.stringify({ paper: $('ppPaper').value, orient: $('ppOrient').value, fit: $('ppFit').value, names: $('ppNames').checked })); } catch (e) {}
}
function _ppLoadOpts() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('ganttPrintOpts') || '{}'); } catch (e) {}
  if (PP_PAPER[s.paper]) $('ppPaper').value = s.paper;
  if (s.orient === 'l' || s.orient === 'p') $('ppOrient').value = s.orient;
  if (s.fit === 'w' || s.fit === '1') $('ppFit').value = s.fit;
  if (typeof s.names === 'boolean') $('ppNames').checked = s.names;
}

// Randează Gantt-ul la scara potrivită paginii și întoarce tot ce trebuie ca să construim paginile.
// Starea ecranului (zoom, selecție, nume lângă bară) se restaurează la final, orice s-ar întâmpla.
function _ppCapture(o) {
  const cw = o.pw - 2 * PP.MARGIN, ch = o.ph - 2 * PP.MARGIN;
  const live = { auto: isAutoZoom, zl: zoomLevel, dw: document.documentElement.style.getPropertyValue('--day-w'), side: showSideNames, sel: sel };
  try {
    isAutoZoom = false; showSideNames = o.names; sel = null;
    const rows = viewRows(), n = rows.length;
    const bb = ab(), cs = aD(bb.mn, -3), ce = aD(bb.mx, 5), td = dD(cs, ce) + 1;
    const setDw = dw => { document.documentElement.style.setProperty('--day-w', dw + 'px'); zoomLevel = Math.round(dw / 30 * 100); };
    // 1) la o lățime de probă măsurăm antetul și „coada" (loc pentru nume lungi la capătul graficului)
    setDw(3); renderGantt();
    const hh = $('gHead').offsetHeight, tail = Math.max(40, parseFloat($('gBody').firstElementChild.style.width) - td * 3);
    // 2) alegem lățimea zilei ca tabelul + Gantt-ul, scalate cu k, să umple lățimea paginii
    const availH = ch - PP.TITLE_H - PP.FOOT_H, kH = availH / (hh + n * PP.ROW_H);
    const kTarget = o.land ? 0.8 : 0.62;
    let dw = (cw / (o.one ? Math.min(kTarget, kH) : kTarget) - PP.TW - tail) / td;
    dw = Math.max(1.2, Math.min(30, dw));
    // 3) randăm la lățimea finală și capturăm
    setDw(dw); renderGantt();
    const inner = $('gBody').firstElementChild;
    const gW = parseFloat(inner.style.width);
    let k = Math.min(1.3, cw / (PP.TW + gW));
    if (o.one) k = Math.min(k, kH);
    return {
      rows, n, hh, gW, k, dw,
      headHTML: $('gHead').innerHTML,
      bodyHTML: $('gBody').innerHTML.replace(/ id="depSvg"/g, ''),
      tiny: $('gBody').classList.contains('zoom-tiny')
    };
  } finally {
    isAutoZoom = live.auto; showSideNames = live.side; sel = live.sel; zoomLevel = live.zl;
    if (live.dw) document.documentElement.style.setProperty('--day-w', live.dw); else document.documentElement.style.removeProperty('--day-w');
    renderGantt();
  }
}

function _ppRow(t, w) {
  const isSumm = hasK(t.id), isMs = !!t.isMilestone && !isSumm, d = dep(t.id);
  return '<div class="pp-row' + (isSumm ? ' summ' : '') + '" data-tid="' + t.id + '">'
    + '<div class="pc pc-wbs" style="width:' + PP_COLS[0][1] + 'px">' + (w[t.id] || '') + '</div>'
    + '<div class="pc pc-nm" style="width:' + PP_COLS[1][1] + 'px;padding-left:' + (4 + d * 12) + 'px">' + (isMs ? '♦ ' : '') + esc(t.nm) + '</div>'
    + '<div class="pc pc-n" style="width:' + PP_COLS[2][1] + 'px">' + (isMs ? '' : t.dur) + '</div>'
    + '<div class="pc pc-d" style="width:' + PP_COLS[3][1] + 'px">' + _ppShort(pD(t.sd)) + '</div>'
    + '<div class="pc pc-d" style="width:' + PP_COLS[4][1] + 'px">' + _ppShort(endDate(t)) + '</div>'
    + '<div class="pc pc-n" style="width:' + PP_COLS[5][1] + 'px">' + (t.prog ? t.prog + '%' : '') + '</div>'
    + '</div>';
}

function _ppBuild(o, d) {
  const cw = o.pw - 2 * PP.MARGIN, ch = o.ph - 2 * PP.MARGIN;
  const availH = ch - PP.TITLE_H - PP.FOOT_H;
  const rpp = o.one ? d.n : Math.max(1, Math.floor((availH / d.k - d.hh) / PP.ROW_H));
  const pages = Math.max(1, Math.ceil(d.n / rpp)), w = wbs(), now = new Date();
  const sub = ['Tipărit ' + fmtDate(now) + ' ' + _ppTime(now)];
  if (hasCustomStatus()) sub.push('data de status ' + fmtDate(pD(META.sdate)));
  if (filterActive()) sub.push('filtru: ' + describeFilter());
  const th = PP_COLS.map(c => '<div class="pc ' + c[2] + '" style="width:' + c[1] + 'px">' + c[0] + '</div>').join('');
  let html = '';
  for (let p = 0; p < pages; p++) {
    const a = p * rpp, b = Math.min(d.n, a + rpp), cnt = b - a;
    html += '<div class="pp-page" data-rows="' + cnt + '" style="width:' + o.pw + 'px;height:' + Math.floor(o.ph - 1) + 'px">'
      + '<div class="pp-head" style="left:' + PP.MARGIN + 'px;top:' + PP.MARGIN + 'px;width:' + cw + 'px;height:' + PP.TITLE_H + 'px"><b>' + esc(o.title) + '</b><span>' + esc(sub.join(' · ')) + '</span></div>'
      + '<div class="pp-content" style="left:' + PP.MARGIN + 'px;top:' + (PP.MARGIN + PP.TITLE_H) + 'px;width:' + cw + 'px;height:' + availH + 'px">'
      +   '<div class="pp-scale" style="width:' + (PP.TW + d.gW) + 'px;transform:scale(' + d.k + ')"><div class="pp-cols">'
      +     '<div class="pp-left" style="width:' + PP.TW + 'px"><div class="pp-th" style="height:' + d.hh + 'px">' + th + '</div>'
      +       d.rows.slice(a, b).map(t => _ppRow(t, w)).join('') + '</div>'
      +     '<div class="pp-right" style="width:' + d.gW + 'px">'
      +       '<div class="g-head pp-ghead' + (d.tiny ? ' zoom-tiny' : '') + '" style="height:' + d.hh + 'px">' + d.headHTML + '</div>'
      +       '<div class="g-body pp-gbody' + (d.tiny ? ' zoom-tiny' : '') + '" style="height:' + (cnt * PP.ROW_H) + 'px"><div style="position:absolute;left:0;top:' + (-a * PP.ROW_H) + 'px;width:' + d.gW + 'px">' + d.bodyHTML + '</div></div>'
      +     '</div>'
      +   '</div></div></div>'
      + '<div class="pp-foot" style="left:' + PP.MARGIN + 'px;top:' + (o.ph - PP.MARGIN - PP.FOOT_H) + 'px;width:' + cw + 'px"><span>Gantt PRO</span><span>Pagina ' + (p + 1) + ' din ' + pages + '</span></div>'
      + '</div>';
  }
  $('ppPages').innerHTML = html;
  const mm = px => (px / 96 * 25.4).toFixed(1) + 'mm';
  $('ppPageCss').textContent = '@page{size:' + mm(o.pw) + ' ' + mm(o.ph) + ';margin:0}';
  $('ppInfo').textContent = pages + (pages === 1 ? ' pagină' : ' pagini') + ' · ' + d.n + ' rânduri · scară ' + Math.round(d.k * 100) + '%';
  ppFit();
  return { pages, rpp };
}

// Scalează previzualizarea ca pagina să încapă pe lățimea ferestrei (doar pe ecran; la tipărire e 100%)
function ppFit() {
  const area = $('ppArea'), first = document.querySelector('#ppPages .pp-page'); if (!area || !first) return;
  $('ppPages').style.zoom = Math.min(1, (area.clientWidth - 40) / first.offsetWidth);
}
window.addEventListener('resize', () => { if ($('printPreview') && $('printPreview').style.display !== 'none') ppFit(); });

function ppRebuild() {
  if (!tabs.length || !T.length) return null;
  _ppSaveOpts();
  const o = _ppOptions();
  if (!viewRows().length) { $('ppPages').innerHTML = '<div style="color:#fff;font-weight:700;padding:30px">Niciun rând de tipărit (filtrul nu arată nimic).</div>'; $('ppInfo').textContent = ''; return null; }
  return _ppBuild(o, _ppCapture(o));
}

function openPrintPreview() {
  if (!tabs.length || !T.length) { toast('⚠️ Proiectul e gol — nu e nimic de tipărit'); return; }
  if ($('printPreview').style.display !== 'none') return;
  if (view !== 'gantt') setViewMode('gantt');       // se tipărește Gantt-ul (în alte vederi nu are cum să fie măsurat)
  _ppDark = document.body.classList.contains('dark');
  document.body.classList.remove('dark');          // pe hârtie, mereu tema luminoasă
  document.body.classList.add('pp-open');
  _ppLoadOpts();
  const tab = tabs.find(t => t.id === activeTabId);
  $('ppTitle').value = tab ? tab.name : 'Proiect';
  $('printPreview').style.display = 'flex';
  ppRebuild();
}

function closePrintPreview() {
  const el = $('printPreview'); if (!el || el.style.display === 'none') return;
  el.style.display = 'none';
  $('ppPages').innerHTML = ''; $('ppPageCss').textContent = '';
  document.body.classList.remove('pp-open');
  if (_ppDark) document.body.classList.add('dark');
  renderAll();
}

function ppPrint() {
  if (!document.querySelector('#ppPages .pp-page')) return;
  window.print();
}

// PDF direct (pagini ca imagini): jsPDF + html2canvas, fără fereastra de tipărire
async function ppBuildPdf() {
  if (typeof html2canvas === 'undefined' || !window.jspdf) throw new Error('Bibliotecile PDF lipsesc');
  const pages = [...document.querySelectorAll('#ppPages .pp-page')]; if (!pages.length) throw new Error('Nicio pagină');
  const o = _ppOptions(), zoom = $('ppPages').style.zoom;
  $('ppPages').style.zoom = 1;
  try {
    const { jsPDF } = window.jspdf, orient = o.land ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation: orient, unit: 'px', format: [o.pw, o.ph] });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      if (i) pdf.addPage([o.pw, o.ph], orient);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, o.pw, o.ph);
    }
    return pdf;
  } finally { $('ppPages').style.zoom = zoom; }
}

async function ppPdf() {
  toast('📄 Se generează PDF-ul…');
  try {
    const pdf = await ppBuildPdf(), o = _ppOptions();
    pdf.save((o.title || 'plan').replace(/[\\/:*?"<>|]+/g, '-') + '-' + fD(new Date()) + '.pdf');
    toast('✅ PDF salvat');
  } catch (e) { toast('❌ Nu s-a putut genera PDF-ul: ' + e.message); }
}

// Ctrl+P = fereastra de tipărire a aplicației; Esc o închide
document.addEventListener('keydown', e => {
  const open = $('printPreview') && $('printPreview').style.display !== 'none';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    if (open) { e.preventDefault(); ppPrint(); }
    else if (tabs.length && T.length && !document.querySelector('.modal-overlay.open')) { e.preventDefault(); openPrintPreview(); }
  } else if (e.key === 'Escape' && open) closePrintPreview();
});

let _ppTimer = null;
function ppRebuildSoon() { clearTimeout(_ppTimer); _ppTimer = setTimeout(ppRebuild, 250); }
