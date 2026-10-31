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
  // la activitățile finalizate contează finalul REAL, nu cel planificat
  const e = (!hasK(t.id) && t.af && ISO_RE.test(t.af)) ? pD(t.af) : endDate(t);
  return dD(b.e, e);
}

// Activitate întârziată: ar fi trebuit să fie gata până la data de status (azi, dacă nu ai setat alta), dar nu e finalizată
function isBehind(t) {
  if (hasK(t.id) || t.isMilestone || t.prog >= 100) return false;
  return endDate(t) < pD(statusDay());
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

// ============================================================
// URMĂRIRE PROGRES — data de status + început / final real
// ============================================================
// META.sdate = data de status (aaaa-ll-zz); lipsă = „azi".  t.as = început real, t.af = final real (doar activități, nu capitole).
// Datele reale NU mută singure planul; „Actualizează planul" le aplică explicit (vezi mai jos).
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const _minISO = (a, b) => (a <= b ? a : b), _maxISO = (a, b) => (a >= b ? a : b);
const statusDay = () => META.sdate || fD(new Date());
const hasCustomStatus = () => !!META.sdate && META.sdate !== fD(new Date());
const _isLeafTask = t => !!t && !hasK(t.id) && !t.isMilestone;

// Intervalul real al unei activități: de la început real până la final real (sau până la data de status, dacă e în desfășurare)
function actSpan(t) {
  if (!_isLeafTask(t) || !t.as || !ISO_RE.test(t.as)) return null;
  const s = pD(t.as);
  if (t.af && ISO_RE.test(t.af)) { const e = pD(t.af); return { s, e: e < s ? s : e, done: true }; }
  const e = pD(statusDay());
  return { s, e: e < s ? s : e, done: false };
}

// Bara subțire de deasupra activității: verde = finalizat la timp, roșu = finalizat cu întârziere, albastru = în desfășurare
function _actBar(t, cs, dw) {
  const a = actSpan(t); if (!a) return '';
  const left = dD(cs, a.s) * dw, w = Math.max(1, dD(a.s, a.e) + 1) * dw;
  const bl = blSpan(t), refEnd = bl ? bl.e : endDate(t), late = a.done ? dD(refEnd, a.e) : 0;
  const cls = a.done ? (late > 0 ? ' late' : ' ok') : ' wip';
  const txt = 'Real: ' + fmtDate(a.s) + ' → ' + (a.done ? fmtDate(a.e) + (late > 0 ? ' · ' + late + (late === 1 ? ' zi' : ' zile') + ' peste ' + (bl ? 'linia de bază' : 'plan') : ' · la timp') : 'în desfășurare (până la ' + fmtDate(a.e) + ')');
  return '<div class="act-bar' + cls + '" style="left:' + left + 'px;width:' + w + 'px" title="' + esc(txt) + '"></div>';
}

// Text pentru bara de informații
function actualText(t) {
  const a = actSpan(t); if (!a) return '';
  return ' · <span class="gi-lbl">Real:</span> ' + fmtDate(a.s) + ' → ' + (a.done ? fmtDate(a.e) : '<i>în desfășurare</i>');
}

// Când se schimbă progresul: completăm automat începutul / finalul real (cu data de status) și îl scoatem când progresul scade.
function _syncActuals(t, oldProg) {
  if (!_isLeafTask(t)) return '';
  const sd = statusDay(), msg = [];
  if (t.prog > 0 && oldProg <= 0 && !t.as) { t.as = sd; msg.push('Început real: ' + fmtDate(pD(sd))); }
  if (t.prog >= 100 && oldProg < 100) {
    if (!t.as) t.as = _minISO(t.sd, sd);
    if (!t.af) { t.af = _maxISO(sd, t.as); msg.push('Final real: ' + fmtDate(pD(t.af))); }
  }
  if (oldProg >= 100 && t.prog < 100 && t.af) { delete t.af; msg.push('final real șters'); }
  if (oldProg > 0 && t.prog <= 0 && t.as && !t.af) { delete t.as; msg.push('început real șters'); }
  return msg.join(' · ');
}

function markStarted(id) {
  const t = T.find(x => x.id === id); if (!_isLeafTask(t)) { toast('ℹ️ Doar activitățile (nu capitolele sau reperele) au început real'); return; }
  pushHistory();
  if (!t.as) t.as = statusDay();
  syncTabData(); renderAll(); toast('▶ Început real: ' + fmtDate(pD(t.as)));
}

function markDone(id) {
  const t = T.find(x => x.id === id); if (!_isLeafTask(t)) { toast('ℹ️ Doar activitățile (nu capitolele sau reperele) pot fi finalizate'); return; }
  pushHistory();
  const sd = statusDay();
  if (!t.as) t.as = _minISO(t.sd, sd);
  t.af = _maxISO(sd, t.as); t.prog = 100;
  syncTabData(); renderAll(); toast('✓ Finalizat — final real: ' + fmtDate(pD(t.af)));
}

// Editare din tabel (coloanele „Început real" / „Final real")
function updActual(id, f, v) {
  const t = T.find(x => x.id === id); if (!_isLeafTask(t)) return;
  if (v && !ISO_RE.test(v)) return;
  if (v && f === 'af' && t.as && v < t.as) { toast('⚠️ Finalul real nu poate fi înaintea începutului real'); renderAll(); return; }
  if (v && f === 'as' && t.af && v > t.af) { toast('⚠️ Începutul real nu poate fi după finalul real'); renderAll(); return; }
  pushHistory();
  if (v) t[f] = v; else delete t[f];
  if (f === 'af' && v) { if (!t.as) t.as = _minISO(t.sd, v); t.prog = 100; }
  syncTabData(); renderAll();
}

// ----- fereastra „Data de status" -----
function openStatusDate() {
  if (!tabs.length) return;
  $('stAuto').checked = !META.sdate;
  dtSet('stDate', META.sdate || fD(new Date()));
  stToggleAuto();
  $('statusModal').classList.add('open');
}
function stToggleAuto() {
  const auto = $('stAuto').checked;
  $('stDate').disabled = auto;
  if (auto) dtSet('stDate', fD(new Date()));
}
function closeStatusDate() { $('statusModal').classList.remove('open'); }
function saveStatusDate() {
  const auto = $('stAuto').checked, v = $('stDate').value;
  if (!auto && !ISO_RE.test(v)) { toast('⚠️ Alege o dată de status'); return; }
  pushHistory();
  META.sdate = auto ? null : v;
  syncTabData(); closeStatusDate(); renderAll();
  toast(auto ? '📅 Data de status = azi (automat)' : '📅 Data de status: ' + fmtDate(pD(v)));
}

// ----- „Actualizează planul cu datele reale" -----
// 1) activitățile cu început real se fixează la el (restricție „trebuie să înceapă pe"); dacă au și final real, durata devine cea reală
// 2) activitățile nepornite rămase în urmă față de data de status se mută după ea (restricție „nu începe înainte de")
// Fixările create aici au cons.ac = true: se pot reface oricând sau elimina dintr-o mișcare.
// 3) activitățile în desfășurare rămase în urmă (finalul planificat e înainte de data de status) își mută finalul:
//    munca rămasă (durata × (100 − progres)%) se așază după data de status, ca urmașii lor să nu pornească înaintea lor
// Un singur parcurs, folosit și la simulare (mutate = false) și la aplicare (mutate = true).
function _scanActuals(mutate) {
  const sd = statusDay(), sdD = pD(sd), r = { pinned: 0, durChanged: 0, pushed: 0, extended: 0, skipped: 0 };
  T.forEach(t => {
    if (!_isLeafTask(t)) return;
    const userCons = !!(t.cons && t.cons.type && t.cons.type !== 'ASAP');
    const started = !!t.as, inProg = t.prog > 0 && t.prog < 100 && !t.af;
    const startD = started ? pD(t.as) : pD(t.sd);
    const wantsPush = !started && t.prog <= 0 && pD(t.sd) < sdD;
    const wantsExtend = inProg && endDate({ sd: fD(startD), dur: t.dur }) < sdD;
    if (!started && !wantsPush && !wantsExtend) return;
    if (userCons) { r.skipped++; return; }
    if (started) {
      r.pinned++;
      if (mutate) t.cons = { type: 'MSO', date: t.as, ac: true };
      if (t.af) {
        const nd = Math.max(1, workDur(pD(t.as), pD(t.af)));
        if (nd !== t.dur) r.durChanged++;
        if (mutate) { t.dur = nd; t.prog = 100; }
      }
    } else if (wantsPush) {
      r.pushed++;
      if (mutate) t.cons = { type: 'SNET', date: sd, ac: true };
    }
    if (wantsExtend) {
      r.extended++;
      if (mutate) {
        const remaining = Math.max(1, Math.ceil(t.dur * (100 - t.prog) / 100));
        const newEnd = addWorkDays(nextWork(sdD), remaining - 1);
        t.dur = Math.max(t.dur, workDur(startD, newEnd));
      }
    }
  });
  return r;
}

function _planActuals() {
  const saved = JSON.stringify(T);
  T.forEach(t => { if (t.cons && t.cons.ac) delete t.cons; });
  recomputeAll();             // poziția „naturală", dictată de legături
  const r = _scanActuals(false);
  T = JSON.parse(saved);      // planificarea doar a fost simulată: revenim la starea de dinainte
  recomputeAll();
  return r;
}

function _doApplyActuals() {
  T.forEach(t => { if (t.cons && t.cons.ac) delete t.cons; });
  recomputeAll();
  const r = _scanActuals(true);
  recomputeAll();
  return r;
}

function applyActuals() {
  if (!T.length) { toast('⚠️ Proiect gol'); return; }
  const p = _planActuals();
  if (!p.pinned && !p.pushed && !p.extended) { toast('ℹ️ Nimic de actualizat: nu ai date reale și nicio activitate rămasă în urmă față de ' + fmtDate(pD(statusDay()))); return; }
  const parts = [], sdTxt = fmtDate(pD(statusDay()));
  if (p.pinned) parts.push(p.pinned + (p.pinned === 1 ? ' activitate se fixează' : ' activități se fixează') + ' la datele reale' + (p.durChanged ? ' (la ' + p.durChanged + ' se ajustează și durata)' : ''));
  if (p.pushed) parts.push(p.pushed + (p.pushed === 1 ? ' activitate nepornită se mută' : ' activități nepornite se mută') + ' după ' + sdTxt);
  if (p.extended) parts.push(p.extended + (p.extended === 1 ? ' activitate în desfășurare își mută' : ' activități în desfășurare își mută') + ' finalul după ' + sdTxt + ' (munca rămasă)');
  if (p.skipped) parts.push(p.skipped + ' rămân neschimbate (au o restricție pusă de tine)');
  const hint = hasBaseline() ? '' : ' Nu ai linie de bază: salveaz-o întâi dacă vrei să compari cu planul inițial.';
  customConfirm('Actualizez planul: ' + parts.join('; ') + '. Poți anula cu Ctrl+Z.' + hint, () => {
    pushHistory();
    const r = _doApplyActuals();
    syncTabData(); renderAll();
    toast('🔄 Plan actualizat: ' + r.pinned + ' fixate, ' + r.pushed + ' mutate, ' + r.extended + ' prelungite' + (r.skipped ? ', ' + r.skipped + ' neschimbate' : ''));
  });
}

function clearActualPins() {
  const n = T.filter(t => t.cons && t.cons.ac).length;
  if (!n) { toast('ℹ️ Nu există fixări create din datele reale'); return; }
  customConfirm('Elimin cele ' + n + ' fixări create din datele reale? Activitățile cu legături revin la poziția dictată de ele; cele fără legături rămân unde sunt acum. Duratele ajustate și datele reale rămân.', () => {
    pushHistory();
    T.forEach(t => { if (t.cons && t.cons.ac) delete t.cons; });
    syncTabData(); renderAll(); toast('↩️ ' + n + ' fixări eliminate');
  });
}

// Esc închide, Enter salvează în fereastra „Data de status"
document.addEventListener('keydown', e => {
  const m = $('statusModal'); if (!m || !m.classList.contains('open')) return;
  if (e.key === 'Escape') closeStatusDate();
  else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); saveStatusDate(); }
});
