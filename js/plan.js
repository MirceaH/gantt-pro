// ============================================================
// PLAN — linia de bază (baseline), variație și activități întârziate
// ============================================================
// t.bl = { sd, dur } — „fotografia" planului aprobat. Pe Gantt apare ca bară subțire sub fiecare activitate.
let showBaseline = (function () { try { return localStorage.getItem('ganttBase') !== '0'; } catch (e) { return true; } })();

const hasBaseline = () => T.some(t => t.bl);

function saveBaseline() {
  if (!T.length) { toast('⚠️ Proiect gol'); return; }
  const doIt = () => {
    pushHistory();
    T.forEach(t => { if (!hasK(t.id)) t.bl = { sd: t.sd, dur: t.dur }; else delete t.bl; });
    showBaseline = true; try { localStorage.setItem('ganttBase', '1'); } catch (e) {}
    syncTabData(); renderAll(); _refreshPlanUI();
    toast('📌 Linia de bază salvată — orice schimbare de acum se compară cu ea');
  };
  if (hasBaseline()) customConfirm('Există deja o linie de bază. O înlocuiești cu planul curent?', doIt); else doIt();
}

function clearBaseline() {
  if (!hasBaseline()) { toast('ℹ️ Nu există linie de bază'); return; }
  customConfirm('Ștergi linia de bază?', () => {
    pushHistory(); T.forEach(t => { delete t.bl; });
    syncTabData(); renderAll(); _refreshPlanUI(); toast('🗑️ Linia de bază ștearsă');
  });
}

function toggleBaseline() {
  if (!hasBaseline()) { toast('ℹ️ Salvează întâi o linie de bază (tab Project › Plan)'); return; }
  showBaseline = !showBaseline;
  try { localStorage.setItem('ganttBase', showBaseline ? '1' : '0'); } catch (e) {}
  _refreshPlanUI(); renderAll();
  toast(showBaseline ? '📏 Linia de bază afișată' : 'Linia de bază ascunsă');
}

function _refreshPlanUI() {
  const b = $('btnBase'); if (b) b.classList.toggle('active', showBaseline && hasBaseline());
}

// Intervalul de bază al unei activități (la capitole: din activitățile copil care au bază)
function blSpan(t) {
  if (!hasK(t.id)) {
    if (!t.bl) return null;
    const s = pD(t.bl.sd); return { s, e: endDate({ sd: t.bl.sd, dur: t.bl.dur }) };
  }
  let s = null, e = null;
  allD(t.id).forEach(i => {
    const x = T.find(y => y.id === i); if (!x || hasK(x.id) || !x.bl) return;
    const a = pD(x.bl.sd), b = endDate({ sd: x.bl.sd, dur: x.bl.dur });
    if (!s || a < s) s = a; if (!e || b > e) e = b;
  });
  return s ? { s, e } : null;
}

// Întârzierea finalului față de bază, în zile calendaristice (+ = întârziat, − = mai devreme)
function varDays(t) {
  const b = blSpan(t); if (!b) return null;
  return dD(b.e, endDate(t));
}

// Activitate întârziată: ar fi trebuit să fie gata până azi, dar nu e finalizată
function isBehind(t) {
  if (hasK(t.id) || t.isMilestone || t.prog >= 100) return false;
  return endDate(t) < pD(todayStr);
}

const behindCount = () => T.filter(isBehind).length;

// Bara subțire de bază, desenată sub bara activității
function _blBar(t, cs, dw) {
  if (!showBaseline) return '';
  const b = blSpan(t); if (!b) return '';
  const left = dD(cs, b.s) * dw, w = Math.max(1, dD(b.s, b.e) + 1) * dw;
  const v = varDays(t);
  const cls = v > 0 ? ' slip' : (v < 0 ? ' ahead' : '');
  return '<div class="bl-bar' + cls + '" style="left:' + left + 'px;width:' + w + 'px" title="Linia de bază: ' + fmtDate(b.s) + ' → ' + fmtDate(b.e) + (v ? ' · ' + (v > 0 ? '+' : '') + v + ' zile' : '') + '"></div>';
}

// Text pentru bara de informații
function baselineText(t) {
  const b = blSpan(t); if (!b) return '';
  const v = varDays(t);
  const vt = v === 0 ? 'la termen' : (v > 0 ? '<span class="gi-warn">+' + v + ' ' + (v === 1 ? 'zi' : 'zile') + ' întârziere</span>' : '<span class="gi-ok">' + v + ' zile mai devreme</span>');
  return ' · <span class="gi-lbl">Bază:</span> ' + fmtDate(b.s) + ' → ' + fmtDate(b.e) + ' (' + vt + ')';
}
