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
  const workIdx = d => { let n = 0; for (let r = base, g = 0; r < d && g < 36600; r = aD(r, 1), g++) if (isWork(r)) n++; return n; };
  const node = {};
  leaves.forEach(t => {
    const es = workIdx(nextWork(pD(t.sd))), d = Math.max(1, t.dur);
    node[t.id] = { es, ef: es + d, d, ls: 0, lf: 0 };
  });
  const projEnd = Math.max(...Object.values(node).map(n => n.ef));

  const succ = {};
  leaves.forEach(t => (t.deps || []).forEach(dp => {
    if (node[dp.id]) (succ[dp.id] = succ[dp.id] || []).push({ id: t.id, type: dp.type, lag: +dp.lag || 0 });
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
        case 'SF': v = m.lf - s.lag - 1 + n.d; break;
        default: return;
      }
      if (v < lf) lf = v;
    });
    n.lf = lf; n.ls = lf - n.d;
  }

  leaves.forEach(t => {
    const n = node[t.id], fl = n.lf - n.ef;
    cpm[t.id] = { float: fl, crit: fl <= 0 };
    if (fl <= 0) cpmInfo.count++;
  });
  cpmInfo.end = fD(leaves.map(endDate).reduce((a, b) => (b > a ? b : a)));
}

const isCrit = id => showCritical && !!(cpm[id] && cpm[id].crit);

function toggleCritical() {
  showCritical = !showCritical;
  try { localStorage.setItem('ganttCrit', showCritical ? '1' : '0'); } catch (e) {}
  const b = $('btnCrit'); if (b) b.classList.toggle('active', showCritical);
  renderAll();
  toast(showCritical ? '🔴 Drum critic afișat' : 'Drum critic ascuns');
}
