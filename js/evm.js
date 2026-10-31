// ============================================================
// EVM — valoare realizată (Earned Value Management) + curba S
// ============================================================
// Se calculează pe activitățile „frunză" (capitolele doar însumează).
//   Valoarea unei activități = costul de bază: t.bl.cost (salvat odată cu linia de bază) sau, dacă lipsește, costul curent din resurse.
//                              Dacă proiectul nu are costuri deloc, se folosește durata (zile lucrătoare) ca „valoare".
//   PV (planificat)  = valoare × % planificat la data de status — liniar în zile lucrătoare, pe intervalul liniei de bază (sau al planului, dacă nu e bază)
//   EV (realizat)    = valoare × % realizat (t.prog)
//   AC (cost real)   = t.acost, introdus de utilizator; la activitățile fără cost real se presupune AC = EV (în buget)
//   SV = EV − PV, SPI = EV / PV, CV = EV − AC, CPI = EV / AC, EAC = BAC / CPI, ETC = EAC − AC, VAC = BAC − EAC
// Indicatorii de COST (CV, CPI, EAC…) apar doar dacă măcar o activitate are cost real — altfel CPI ar fi mereu 1 și ar induce în eroare.
// Istoricul EV / AC pentru curba S e o estimare: progresul crește liniar între începutul real (sau planificat) și final real (sau data de status).

const _evmLeaves = () => T.filter(t => !hasK(t.id) && !t.isMilestone);

// Valoarea de bază a unei activități (în bani sau, fără costuri, în zile lucrătoare)
function _evmValue(t, useCost) {
  if (!useCost) return Math.max(1, t.dur);
  if (t.bl && Number.isFinite(+t.bl.cost)) return +t.bl.cost;
  return costMap[t.id] || 0;
}

// Număr de zile lucrătoare dinainte de d (strict), față de o origine: indexul se construiește o singură dată
function _evmWorkIndex(origin, last) {
  const n = Math.max(2, dD(origin, last) + 3), cum = new Int32Array(n + 1);
  for (let i = 0, r = origin; i < n; i++, r = aD(r, 1)) cum[i + 1] = cum[i] + (isWork(r) ? 1 : 0);
  return d => cum[clamp(dD(origin, d), 0, n)];
}

function computeEVM() {
  const leaves = _evmLeaves(), S = pD(statusDay());
  const hasBase = hasBaseline(), anyCost = leaves.some(t => _evmValue(t, true) > 0);
  const useCost = anyCost, unit = useCost ? 'cost' : 'zile';
  const hasActual = leaves.some(t => Number.isFinite(+t.acost) && t.acost !== null && t.acost !== '');

  // intervale pentru fiecare activitate
  const info = leaves.map(t => {
    const bs = t.bl ? pD(t.bl.sd) : pD(t.sd), bdur = Math.max(1, t.bl ? t.bl.dur : t.dur);
    const v = _evmValue(t, useCost), evT = v * (t.prog || 0) / 100;
    const s0 = t.as ? pD(t.as) : pD(t.sd);
    let e0 = t.af ? pD(t.af) : S; if (e0 < s0) e0 = s0;
    const acT = (t.acost !== undefined && t.acost !== null && Number.isFinite(+t.acost)) ? +t.acost : evT;
    return { t, bs, bdur, v, evT, acT, s0, e0 };
  });
  if (!info.length) return { empty: true, unit, hasBase, hasActual, status: S };

  let first = info[0].bs, last = S;
  info.forEach(x => {
    if (x.bs < first) first = x.bs; if (x.s0 < first) first = x.s0;
    const be = endDate({ sd: fD(x.bs), dur: x.bdur }); if (be > last) last = be; if (x.e0 > last) last = x.e0;
  });
  first = aD(first, -1);          // curba S pornește de la 0, în ziua dinaintea primei activități
  const wi = _evmWorkIndex(first, aD(last, 2));
  const planFrac = (x, D) => clamp((wi(aD(D, 1)) - wi(x.bs)) / x.bdur, 0, 1);
  const doneFrac = (x, D) => D < x.s0 ? 0 : (D >= x.e0 ? 1 : (dD(x.s0, D) + 1) / (dD(x.s0, x.e0) + 1));

  let bac = 0, pv = 0, ev = 0, ac = 0, nActual = 0;
  info.forEach(x => { bac += x.v; pv += x.v * planFrac(x, S); ev += x.evT; ac += x.acT; if (x.t.acost !== undefined && x.t.acost !== null && Number.isFinite(+x.t.acost)) nActual++; });

  const sv = ev - pv, spi = pv > 0 ? ev / pv : null;
  const cv = hasActual ? ev - ac : null, cpi = hasActual && ac > 0 ? ev / ac : null;
  const eac = cpi ? bac / cpi : null, etc = eac !== null ? eac - ac : null, vac = eac !== null ? bac - eac : null;

  // curba S: cel mult ~240 de puncte
  const days = dD(first, last) + 1, step = Math.max(1, Math.ceil(days / 240)), pts = [];
  for (let i = 0; i < days; i += step) pts.push(aD(first, i));
  if (fD(pts[pts.length - 1]) !== fD(last)) pts.push(last);
  const curve = pts.map(D => {
    let p = 0, e = 0, a = 0; const hist = D <= S;
    info.forEach(x => {
      p += x.v * planFrac(x, D);
      if (hist) { const f = doneFrac(x, D); e += x.evT * f; a += x.acT * f; }
    });
    return { d: D, pv: p, ev: hist ? e : null, ac: hist ? a : null };
  });

  // pe capitole principale
  const rootOf = t => { let c = t; while (c.pid != null) { const p = T.find(y => y.id === c.pid); if (!p) break; c = p; } return c; };
  const groups = new Map(), w = wbs();
  info.forEach(x => {
    const r = rootOf(x.t); let g = groups.get(r.id);
    if (!g) { g = { id: r.id, nm: (w[r.id] || '') + ' ' + r.nm, bac: 0, pv: 0, ev: 0, ac: 0 }; groups.set(r.id, g); }
    g.bac += x.v; g.pv += x.v * planFrac(x, S); g.ev += x.evT; g.ac += x.acT;
  });
  const rows = [...groups.values()].map(g => ({ ...g, spi: g.pv > 0 ? g.ev / g.pv : null, pct: g.bac > 0 ? g.ev / g.bac : 0 }));

  return { unit, hasBase, hasActual, nActual, nLeaves: info.length, status: S, first, last, bac, pv, ev, ac, sv, spi, cv, cpi, eac, etc, vac, curve, rows };
}

// ---------------- fereastra ----------------
const _evmFmt = (unit, v) => v === null || v === undefined || !Number.isFinite(v) ? '—' : (unit === 'cost' ? fmtMoney(v) : (Math.round(v * 10) / 10).toLocaleString('ro-RO') + ' zile');
const _evmIdx = x => x === null || x === undefined ? '—' : x.toFixed(2).replace('.', ',');
const _evmCls = x => x === null || x === undefined ? '' : (x >= 1 ? 'ok' : (x >= 0.9 ? 'warn' : 'bad'));
const _evmSigned = (unit, v) => v === null ? '—' : (v > 0 ? '+' : '') + _evmFmt(unit, v);
let _evmData = null;

function openEVM() {
  if (!T.length) { toast('⚠️ Proiect gol'); return; }
  renderEVM(); $('evmModal').classList.add('open');
}
function closeEVM() { $('evmModal').classList.remove('open'); }

function renderEVM() {
  const D = _evmData = computeEVM(), box = $('evmBody'); if (!box) return;
  if (D.empty) { box.innerHTML = '<div class="evm-note">Proiectul nu are activități.</div>'; return; }
  const u = D.unit, kpi = (k, v, hint, cls = '') => `<div class="evm-kpi ${cls}"><div class="evm-k">${k}</div><div class="evm-v">${v}</div><div class="evm-h">${hint}</div></div>`;
  const noCost = D.hasActual ? '' : 'introdu costul real (Detalii activitate › Resurse și cost)';
  const notes = [];
  notes.push(`Calculat la <b>data de status ${fmtDate(D.status)}</b>${hasCustomStatus() ? '' : ' (azi)'} — o schimbi din Proiect › Urmărire.`);
  notes.push(D.hasBase ? 'Planificatul (PV) urmează <b>linia de bază</b> salvată.' : '<b>Nu ai linie de bază</b>: PV se calculează după planul curent (Proiect › Linia de bază › Salvează), deci SV rămâne aproape de 0 până îl salvezi.');
  if (u !== 'cost') notes.push('Proiectul nu are costuri: valorile sunt în <b>zile lucrătoare</b>. Atribuie resurse (Proiect › Resurse) ca să vezi sume.');
  if (!D.hasActual) notes.push('Indicatorii de <b>cost</b> (CV, CPI, EAC…) apar după ce introduci <b>costul real</b> la cel puțin o activitate — altfel CPI ar fi mereu 1.');
  else if (D.nActual < D.nLeaves) notes.push(`Costul real e introdus la ${D.nActual} din ${D.nLeaves} activități; celelalte sunt considerate în buget (AC = EV).`);
  const rows = D.rows.map(r => `<tr><td>${esc(r.nm)}</td><td class="n">${_evmFmt(u, r.bac)}</td><td class="n">${_evmFmt(u, r.pv)}</td><td class="n">${_evmFmt(u, r.ev)}</td><td class="n"><span class="evm-bar"><i style="width:${Math.min(100, Math.round(r.pct * 100))}%"></i></span> ${Math.round(r.pct * 100)}%</td><td class="n evm-${_evmCls(r.spi)}">${_evmIdx(r.spi)}</td></tr>`).join('');
  box.innerHTML = `
    <div class="evm-notes">${notes.map(n => `<div>${n}</div>`).join('')}</div>
    <div class="evm-grid">
      ${kpi('Buget total (BAC)', _evmFmt(u, D.bac), 'costul planificat al proiectului')}
      ${kpi('Planificat (PV)', _evmFmt(u, D.pv), 'cât ar fi trebuit făcut până la data de status')}
      ${kpi('Realizat (EV)', _evmFmt(u, D.ev), 'valoarea muncii efectiv făcute')}
      ${kpi('Cost real (AC)', D.hasActual ? _evmFmt(u, D.ac) : '—', D.hasActual ? 'cheltuit până acum' : noCost)}
      ${kpi('Variație program (SV)', _evmSigned(u, D.sv), 'EV − PV (negativ = în urmă)', D.sv < 0 ? 'bad' : 'ok')}
      ${kpi('Indice program (SPI)', _evmIdx(D.spi), 'EV / PV (sub 1 = în urmă)', _evmCls(D.spi))}
      ${kpi('Variație cost (CV)', D.hasActual ? _evmSigned(u, D.cv) : '—', D.hasActual ? 'EV − AC (negativ = peste buget)' : noCost, D.hasActual ? (D.cv < 0 ? 'bad' : 'ok') : '')}
      ${kpi('Indice cost (CPI)', _evmIdx(D.cpi), D.hasActual ? 'EV / AC (sub 1 = peste buget)' : noCost, _evmCls(D.cpi))}
      ${kpi('Estimare la final (EAC)', D.hasActual ? _evmFmt(u, D.eac) : '—', D.hasActual ? 'BAC / CPI' : noCost)}
      ${kpi('Rămas de cheltuit (ETC)', D.hasActual ? _evmFmt(u, D.etc) : '—', D.hasActual ? 'EAC − AC' : noCost)}
      ${kpi('Variație la final (VAC)', D.hasActual ? _evmSigned(u, D.vac) : '—', D.hasActual ? 'BAC − EAC (negativ = depășire)' : noCost, D.hasActual ? (D.vac < 0 ? 'bad' : 'ok') : '')}
      ${kpi('Realizat din buget', D.bac > 0 ? Math.round(D.ev / D.bac * 100) + '%' : '—', 'EV / BAC')}
    </div>
    <h4>Curba S</h4>
    <div class="evm-legend"><span><i style="background:#4f6bed"></i>Planificat (PV)</span><span><i style="background:#2f9e6a"></i>Realizat (EV)</span>${D.hasActual ? '<span><i style="background:#e5484d"></i>Cost real (AC)</span>' : ''}<span><i class="dash"></i>Buget total</span><span class="evm-read" id="evmRead">treci cu mouse-ul peste grafic</span></div>
    <div class="evm-chart" id="evmChart">${_evmSvg(D)}</div>
    <h4>Pe capitole</h4>
    <table class="evm-tbl"><thead><tr><th>Capitol</th><th>Buget</th><th>Planificat</th><th>Realizat</th><th>Progres valoric</th><th>SPI</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="evm-foot">Curba EV / AC în trecut e o <b>estimare</b>: progresul crește liniar între începutul real (sau planificat) și finalul real sau data de status.</div>`;
  _evmWire();
}

// geometria graficului (folosită și la afișarea valorilor la mouse)
const _EG = { W: 820, H: 300, L: 74, R: 14, T: 12, B: 30 };
function _evmSvg(D) {
  const { W, H, L, R, T: Tp, B } = _EG, pw = W - L - R, ph = H - Tp - B;
  const c = D.curve, t0 = +c[0].d, t1 = +c[c.length - 1].d || t0 + 1;
  let ymax = Math.max(D.bac, D.pv, D.ev, D.eac || 0, D.hasActual ? D.ac : 0) * 1.06 || 1;
  const X = d => L + (+d - t0) / Math.max(1, t1 - t0) * pw, Y = v => Tp + ph - v / ymax * ph;
  const path = key => { let s = '', pen = false; c.forEach(p => { if (p[key] === null) return; s += (pen ? 'L' : 'M') + X(p.d).toFixed(1) + ',' + Y(p[key]).toFixed(1); pen = true; }); return s; };
  let grid = '';
  for (let i = 0; i <= 4; i++) { const v = ymax * i / 4, y = Y(v); grid += `<line class="g" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="t" x="${L - 6}" y="${y + 3}" text-anchor="end">${D.unit === 'cost' ? Math.round(v).toLocaleString('ro-RO') : Math.round(v)}</text>`; }
  const span = dD(c[0].d, c[c.length - 1].d), every = Math.max(1, Math.ceil(span / 30 / 6)) ; let xl = '', last = null;
  for (let d = new Date(c[0].d.getFullYear(), c[0].d.getMonth(), 1); d <= c[c.length - 1].d; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    if (d < c[0].d) continue; const mi = Math.round(dD(c[0].d, d) / 30);
    if (last !== null && mi - last < every) continue; last = mi; xl += `<line class="g" x1="${X(d)}" x2="${X(d)}" y1="${Tp}" y2="${Tp + ph}"/><text class="t" x="${X(d)}" y="${H - 10}" text-anchor="middle">${MN(d)} ${String(d.getFullYear()).slice(2)}</text>`;
  }
  const sx = X(D.status);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" id="evmSvg">${grid}${xl}
    <line class="bac" x1="${L}" x2="${W - R}" y1="${Y(D.bac)}" y2="${Y(D.bac)}"/>
    <path class="pv" d="${path('pv')}"/><path class="ev" d="${path('ev')}"/>${D.hasActual ? `<path class="ac" d="${path('ac')}"/>` : ''}
    <line class="st" x1="${sx}" x2="${sx}" y1="${Tp}" y2="${Tp + ph}"/><text class="stl" x="${Math.min(sx + 4, W - R - 70)}" y="${Tp + 10}">Status ${fmtDate(D.status).slice(0, 5)}</text>
    <line class="cur" id="evmCur" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" style="display:none"/>
    <rect id="evmHit" x="${L}" y="${Tp}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
}

function _evmWire() {
  const svg = $('evmSvg'), D = _evmData; if (!svg || !D || D.empty) return;
  const { W, L, R } = _EG, pw = W - L - R, c = D.curve, t0 = +c[0].d, t1 = +c[c.length - 1].d, read = $('evmRead'), cur = $('evmCur');
  $('evmHit').addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, t = t0 + clamp((x - L) / pw, 0, 1) * (t1 - t0);
    let best = c[0]; c.forEach(p => { if (Math.abs(+p.d - t) < Math.abs(+best.d - t)) best = p; });
    const sx = L + (+best.d - t0) / Math.max(1, t1 - t0) * pw; cur.setAttribute('x1', sx); cur.setAttribute('x2', sx); cur.style.display = '';
    read.textContent = fmtDate(best.d) + ' · PV ' + _evmFmt(D.unit, best.pv) + (best.ev !== null ? ' · EV ' + _evmFmt(D.unit, best.ev) : '') + (D.hasActual && best.ac !== null ? ' · AC ' + _evmFmt(D.unit, best.ac) : '');
  });
  $('evmHit').addEventListener('mouseleave', () => { cur.style.display = 'none'; read.textContent = 'treci cu mouse-ul peste grafic'; });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('evmModal') && $('evmModal').classList.contains('open')) closeEVM(); });
