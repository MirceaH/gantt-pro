// ============================================================
// CRONOLOGIE — rezumatul proiectului pe o singură pagină (pentru prezentări)
// ============================================================
// Capitolele principale ca bare pe o axă a timpului (cele care se suprapun se așază pe linii separate; umplerea = progresul),
// reperele ca romburi cu nume, termenele limită ca steaguri, plus linia „Azi" (și „Status", dacă e setată).
// Click pe un capitol = te duce în Gantt, la el. Export ca imagine (PNG) pentru slide-uri.
const TL_COLORS = ['#4f6bed', '#2b9e8f', '#9870c7', '#e0a030', '#d4604a', '#4a8fd4', '#2f9e6a'];
const TL = { PAD: 24, RULER: 50, LANE_H: 40, BAR_H: 28, MS_ROW: 22 };

// Elementele afișate: activitățile principale (dacă tot proiectul e sub un singur capitol rădăcină, copiii lui)
function _tlItems() {
  const roots = T.filter(t => !t.pid);
  const list = roots.length === 1 && hasK(roots[0].id) ? kids(roots[0].id) : roots;
  return list.map(t => { const p = ps(t); return { t, s: p._s, e: p._e }; }).sort((a, b) => a.s - b.s || a.e - b.e);
}

const _tlTextW = (s, font) => _textW(s, font || '700 12px ' + getComputedStyle(document.body).fontFamily);

function renderTimeline() {
  const box = $('tlBox'); if (!box) return;
  if (!T.length) { box.innerHTML = '<div class="tl-empty">Proiect gol — adaugă activități ca să vezi cronologia.</div>'; return; }
  const b = ab();
  const cs = new Date(b.mn.getFullYear(), b.mn.getMonth(), 1), ce = new Date(b.mx.getFullYear(), b.mx.getMonth() + 1, 0);
  const total = dD(cs, ce) + 1, W = Math.max(520, box.clientWidth - 2 * TL.PAD);
  const x = d => TL.PAD + dD(cs, d) / total * W, xe = d => TL.PAD + (dD(cs, d) + 1) / total * W;

  // luni
  let months = '', grid = '';
  for (let d = new Date(cs); d <= ce; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1), l = x(d), w = xe(aD(next, -1)) - l;
    const lab = w >= 70 ? MN(d) + ' ' + d.getFullYear() : (w >= 26 ? MN(d) : '');
    months += '<div class="tl-mo' + (d.getMonth() === 0 ? ' yr' : '') + '" style="left:' + l + 'px;width:' + w + 'px">' + lab + '</div>';
    grid += '<div class="tl-vl" style="left:' + l + 'px"></div>';
  }

  // capitole pe linii (greedy): o bară nouă intră pe prima linie unde nu se atinge de precedenta (inclusiv numele, dacă iese în afara barei)
  const items = _tlItems(), lanes = [], font = '700 12px ' + getComputedStyle(document.body).fontFamily;
  const placed = items.map((it, i) => {
    const l = x(it.s), w = Math.max(8, xe(it.e) - l), tw = _tlTextW(it.t.nm, font) + 16, inside = w >= tw;
    const right = inside ? l + w : l + w + 6 + tw - 8;
    let lane = lanes.findIndex(end => end + 6 <= l);
    if (lane < 0) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = right;
    return { it, i, l, w, inside, lane, color: TL_COLORS[i % TL_COLORS.length] };
  });
  const laneCount = Math.max(1, lanes.length), barsTop = TL.RULER + 14;
  const bars = placed.map(p => {
    const t = p.it.t, top = barsTop + p.lane * TL.LANE_H, days = dD(p.it.s, p.it.e) + 1;
    const tip = t.nm + '\n' + fmtDate(p.it.s) + ' → ' + fmtDate(p.it.e) + ' · ' + days + ' zile · progres ' + t.prog + '%';
    return '<div class="tl-bar' + (hasK(t.id) ? '' : ' leaf') + '" data-id="' + t.id + '" title="' + esc(tip) + '" onclick="tlOpen(' + t.id + ')" style="left:' + p.l + 'px;top:' + top + 'px;width:' + p.w + 'px;background:' + p.color + '">'
      + '<i style="width:' + t.prog + '%"></i>' + (p.inside ? '<span>' + esc(t.nm) + '</span>' : '') + '</div>'
      + (p.inside ? '' : '<div class="tl-out" style="left:' + (p.l + p.w + 6) + 'px;top:' + (top + 6) + 'px">' + esc(t.nm) + '</div>')
      + '<div class="tl-dates" style="left:' + p.l + 'px;top:' + (top + TL.BAR_H + 1) + 'px">' + _dm(p.it.s) + ' – ' + _dm(p.it.e) + '</div>';
  }).join('');

  // repere și termene limită: romburi / steaguri; numele se așază pe rânduri ca să nu se suprapună
  const marks = [];
  T.forEach(t => {
    if (t.isMilestone && !hasK(t.id)) marks.push({ kind: 'ms', t, d: pD(t.sd), label: t.nm });
    else if (t.deadline && !hasK(t.id)) marks.push({ kind: 'dl', t, d: pD(t.deadline), label: 'Termen: ' + t.nm });
  });
  marks.sort((a, b) => a.d - b.d);
  const rows = [], msTop = barsTop + laneCount * TL.LANE_H + 26;
  const mhtml = marks.map(m => {
    const l = x(m.d) + (m.kind === 'ms' ? 0 : 0), w = _tlTextW(m.label, '600 11px ' + getComputedStyle(document.body).fontFamily) + 22;
    let r = rows.findIndex(end => end + 6 <= l - 6);
    if (r < 0) { r = rows.length; rows.push(0); }
    rows[r] = l + w;
    const top = msTop + r * TL.MS_ROW;
    const tip = m.label + ' · ' + fmtDate(m.d);
    return '<div class="tl-mk ' + m.kind + '" title="' + esc(tip) + '" style="left:' + (l - 6) + 'px;top:' + (top + 3) + 'px"></div><div class="tl-mk-l" style="left:' + (l + 9) + 'px;top:' + top + 'px">' + esc(m.label) + '</div>';
  }).join('');
  const msH = rows.length ? rows.length * TL.MS_ROW + 12 : 0, H = msTop + msH + 20;

  // linii Azi / Status
  const line = (d, cls, lab) => { if (d < cs || d > ce) return ''; const lx = x(d) + (xe(d) - x(d)) / 2; return '<div class="tl-now ' + cls + '" style="left:' + lx + 'px"></div><div class="tl-now-l ' + cls + '" style="left:' + lx + 'px">' + lab + '</div>'; };
  const nowHtml = line(pD(fD(new Date())), '', 'Azi') + (hasCustomStatus() ? line(pD(META.sdate), 'st', 'Status ' + _dm(pD(META.sdate))) : '');

  const tab = tabs.find(t => t.id === activeTabId), crit = cpmInfo.end ? fmtDate(pD(cpmInfo.end)) : fmtDate(b.mx);
  const avg = Math.round(T.filter(t => !hasK(t.id)).reduce((s, t) => s + t.prog, 0) / Math.max(1, T.filter(t => !hasK(t.id)).length));
  const head = '<div class="tl-head"><b>' + esc(tab ? tab.name : 'Proiect') + '</b><span>' + fmtDate(b.mn) + ' → ' + fmtDate(b.mx) + ' · ' + (dD(b.mn, b.mx) + 1) + ' zile · progres ' + avg + '%'
    + (costMap.total ? ' · buget ' + fmtMoney(costMap.total) : '') + '</span></div>';
  box.innerHTML = head + '<div class="tl-canvas" id="tlCanvas" style="width:' + (W + 2 * TL.PAD) + 'px;height:' + H + 'px">'
    + '<div class="tl-ruler">' + months + '</div>' + grid + bars + (marks.length ? '<div class="tl-mkline" style="left:' + TL.PAD + 'px;width:' + W + 'px;top:' + (msTop - 12) + 'px"></div>' : '') + mhtml + nowHtml + '</div>'
    + '<div class="tl-legend"><span><i class="lg-bar"></i> capitol / activitate (umplere = progres)</span><span><i class="lg-ms"></i> reper</span><span><i class="lg-dl"></i> termen limită</span><span><i class="lg-now"></i> azi</span></div>';
}

// Click pe un capitol: deschide Gantt-ul la el
function tlOpen(id) {
  coll.delete(id); let p = (T.find(t => t.id === id) || {}).pid;
  while (p) { coll.delete(p); const par = T.find(t => t.id === p); p = par ? par.pid : null; }
  setViewMode('gantt'); sel = id; renderAll(); gotoSelected();
}

// Imagine PNG a cronologiei (mereu cu tema luminoasă, ca să arate bine în slide-uri)
async function tlBuildCanvas() {
  if (typeof html2canvas === 'undefined') throw new Error('Biblioteca de imagini lipsește');
  const el = $('tlBox'); if (!el || !T.length) throw new Error('Nimic de exportat');
  const dark = document.body.classList.contains('dark');
  if (dark) { document.body.classList.remove('dark'); renderTimeline(); }
  try { return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true }); }
  finally { if (dark) { document.body.classList.add('dark'); renderTimeline(); } }
}
async function exportTimelinePNG() {
  toast('📸 Se generează imaginea…');
  try {
    const canvas = await tlBuildCanvas(), a = document.createElement('a');
    a.download = (typeof _safeFile === 'function' ? _safeFile(_projName()) : 'cronologie') + '-cronologie-' + fD(new Date()) + '.png';
    a.href = canvas.toDataURL('image/png'); document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('✅ Imagine salvată');
  } catch (e) { toast('❌ Nu s-a putut genera imaginea: ' + e.message); }
}

window.addEventListener('resize', () => { if (view === 'timeline') renderTimeline(); });
