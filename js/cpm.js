// ============================================================
// CPM — Drum critic (Forward/Backward pass + rezervă totală)
// ============================================================
// Lucrează pe activitățile "frunză" (fără copii). Datele de start vin din
// auto-scheduling (recalcSchedule), deci forward pass = datele curente.
// Backward pass calculează LF/LS din legături, pornind de la finalul proiectului.
// Rezultat: cpm[id] = { float (zile), crit (bool) }
let cpm = {}, cpmInfo = { end: null, count: 0 };
let showCritical = (function () { try { return localStorage.getItem('ganttCrit') === '1'; } catch (e) { return false; } })();

function computeCPM() {
  cpm = {}; cpmInfo = { end: null, count: 0 };
  const leaves = T.filter(t => !hasK(t.id));
  if (!leaves.length) return;
  const { order, hasCycle } = _topoDepOrder();
  if (hasCycle) return;

  // Indexăm în ZILE LUCRĂTOARE (calendarul proiectului)
  const base = nextWork(pD(T.map(t => t.sd).sort()[0]));
  // număr de zile lucrătoare de la `base` până la d (exclusiv) — tabel cumulat calculat o singură dată, nu câte o buclă pe zile pentru fiecare activitate
  const lastD = leaves.reduce((m, t) => { const d = aD(endDate(t), 1); return d > m ? d : m; }, base);   // până după ultimul final (activitățile cu calendar propriu își măsoară finalul în zilele proiectului)
  const span = Math.min(36600, Math.max(0, dD(base, lastD)));
  const cum = new Int32Array(span + 1);
  for (let i = 0, r = base; i < span; i++, r = aD(r, 1)) cum[i + 1] = cum[i] + (isWork(r) ? 1 : 0);
  const workIdx = d => cum[clamp(dD(base, d), 0, span)];
  const node = {};
  leaves.forEach(t => {
    // reperul are durată 0 și stă la finalul zilei lui (ca în MS Project)
    const ms = !!t.isMilestone, es = workIdx(nextWork(pD(t.sd))) + (ms ? 1 : 0);
    // activitate cu calendar propriu (ex. 7 din 7, concediu de resursă): durata se măsoară în zilele proiectului dintre start și final
    const d = ms ? 0 : (hasTaskCal(t) ? Math.max(0, workIdx(aD(endDate(t), 1)) - es) : Math.max(1, t.dur));
    node[t.id] = { es, ef: es + d, d, ls: 0, lf: 0 };
  });
  const projEnd = Math.max(...Object.values(node).map(n => n.ef));

  // Succesorii fiecărei activități. O legătură către un CAPITOL se aplică activităților lui:
  //   FS / FF (se leagă de FINALUL capitolului) → toate frunzele lui (fiecare trebuie să se termine la timp);
  //   SS / SF (se leagă de STARTUL capitolului) → frunzele care încep primele (ele dau startul capitolului).
  const succ = {};
  const addSucc = (pid, t, dp) => (succ[pid] = succ[pid] || []).push({ id: t.id, type: dp.type, lag: +dp.lag || 0 });
  leaves.forEach(t => schedDeps(t).forEach(dp => {          // inclusiv legăturile moștenite de la capitolele activității
    if (node[dp.id]) { addSucc(dp.id, t, dp); return; }
    if (!hasK(dp.id)) return;
    const under = allD(dp.id).filter(id => node[id]);
    if (dp.type === 'SS' || dp.type === 'SF') { const m = Math.min(...under.map(id => node[id].es)); under.filter(id => node[id].es === m).forEach(id => addSucc(id, t, dp)); }
    else under.forEach(id => addSucc(id, t, dp));
  }));

  for (let i = order.length - 1; i >= 0; i--) {
    const n = node[order[i]]; if (!n) continue;
    let lf = projEnd;
    (succ[order[i]] || []).forEach(s => {
      const m = node[s.id]; if (!m) return;
      let v;
      switch (s.type) {
        case 'FS': v = m.ls - s.lag; break;
        case 'SS': v = m.ls - s.lag + n.d; break;
        case 'FF': v = m.lf - s.lag; break;
        case 'SF': v = m.lf - s.lag + n.d; break;   // succesorul se termină înainte de startul predecesorului
        default: return;
      }
      if (v < lf) lf = v;
    });
    n.lf = lf; n.ls = lf - n.d;
  }

  // Rezerva liberă (ca „Free Slack" din MS Project): cât poate întârzia activitatea fără să miște vreun succesor
  // (fără succesori: până la finalul proiectului); niciodată peste rezerva totală.
  const freeOf = id => {
    const n = node[id]; let f = projEnd - n.ef;
    (succ[id] || []).forEach(s => {
      const m = node[s.id]; if (!m) return;
      let v;
      switch (s.type) {
        case 'FS': v = m.es - s.lag - n.ef; break;
        case 'SS': v = m.es - s.lag - n.es; break;
        case 'FF': v = m.ef - s.lag - n.ef; break;
        case 'SF': v = m.ef - s.lag - n.es; break;   // inversul formulei din backward pass
        default: return;
      }
      if (v < f) f = v;
    });
    return Math.max(0, f);
  };
  leaves.forEach(t => {
    const n = node[t.id], fl = n.lf - n.ef;
    cpm[t.id] = { float: fl, crit: fl <= 0, free: Math.min(Math.max(0, fl), freeOf(t.id)) };
    if (fl <= 0) cpmInfo.count++;
  });
  cpmInfo.end = fD(leaves.map(endDate).reduce((a, b) => (b > a ? b : a)));
}

// ALAP: activitățile cu restricția „cât mai târziu" (și legături) își consumă rezerva.
// _alap = zile lucrătoare cu care e împinsă față de poziția „cât mai devreme". Returnează true dacă s-a schimbat ceva.
function applyALAP() {
  let changed = false;
  T.forEach(t => {
    if (!t.cons || t.cons.type !== 'ALAP' || !(t.deps && t.deps.length) || hasK(t.id)) return;
    const c = cpm[t.id]; if (!c) return;
    const next = Math.max(0, (t._alap || 0) + c.float);
    if (next !== (t._alap || 0)) { t._alap = next; changed = true; }
  });
  return changed;
}

// Avertismente per activitate: restricție neîndeplinită și/sau termen limită depășit
let taskWarn = {};
function computeWarnings() {
  taskWarn = {};
  T.forEach(t => {
    const w = {};
    if (consWarn[t.id]) w.cons = consWarn[t.id];
    if (t.deadline) {
      const end = endDate(t), dl = pD(t.deadline);
      if (end > dl) { w.late = dD(dl, end); w.lateText = 'Termen limită depășit cu ' + w.late + (w.late === 1 ? ' zi' : ' zile') + ' (' + fmtDate(dl) + ')'; }
    }
    if (typeof resWarn !== 'undefined' && resWarn[t.id]) w.res = 'Resursă supraalocată: ' + resWarn[t.id].join(', ');
    if (w.cons || w.late || w.res) taskWarn[t.id] = w;
  });
}

const isCrit = id => showCritical && !!(cpm[id] && cpm[id].crit);

function toggleCritical() {
  showCritical = !showCritical;
  try { localStorage.setItem('ganttCrit', showCritical ? '1' : '0'); } catch (e) {}
  const b = $('btnCrit'); if (b) b.classList.toggle('active', showCritical);
  renderAll();
  toast(showCritical ? '🔴 Drum critic afișat' : 'Drum critic ascuns');
}
