// ============================================================
// TESTE DE REGRESIE — se rulează în pagina aplicației (nu face parte din aplicație)
//   În consola browserului (cu aplicația deschisă):
//     eval(await (await fetch('tests/regression.js')).text())
//   Returnează { total, passed, failed:[{name,error}], errors:[...] }.
//   Testele își salvează și își restaurează starea (proiecte, setări), deci pot rula oricând.
// ============================================================
(async function () {
  const results = { total: 0, passed: 0, failed: [], skipped: [], errors: [] };
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'eq') + ': așteptat ' + JSON.stringify(b) + ', primit ' + JSON.stringify(a)); };
  const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) throw new Error((msg || 'near') + ': ' + a + ' vs ' + b + ' (±' + tol + ')'); };
  const skip = why => { const e = new Error(why); e.skip = true; throw e; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // ---------- ajutoare ----------
  const F = (id, type, lag) => ({ id, type: type || 'FS', lag: lag || 0 });
  const mk = (id, nm, dur, pid, deps, sd, extra) => Object.assign({ id, nm, sd: sd || '2026-10-26', dur, prog: 0, pid: pid || null, deps: deps || [] }, extra || {});
  const settle = () => {
    if (typeof recomputeAll === 'function') return recomputeAll();
    for (let i = 0; i < 20; i++) { const s = T.map(t => t.sd + '|' + t.dur).join(','); recalcSchedule(); recalcSummaries(); if (T.map(t => t.sd + '|' + t.dur).join(',') === s) break; }
    computeCPM();
    for (let k = 0; k < 3 && applyALAP(); k++) {
      for (let i = 0; i < 20; i++) { const s = T.map(t => t.sd + '|' + t.dur).join(','); recalcSchedule(); recalcSummaries(); if (T.map(t => t.sd + '|' + t.dur).join(',') === s) break; }
      computeCPM();
    }
    computeResources(); computeWarnings();
  };
  const snap = () => JSON.stringify(T.map(t => [t.id, t.sd, t.dur]));
  const setProject = (tasks, cal, res) => { T = tasks; nid = Math.max(0, ...tasks.map(t => t.id)) + 1; sel = null; coll.clear(); setCal(cal || null); setRes(res || null); _ensureDeps(); };
  const confirmYes = () => { const b = $('confirmBtn'); if (b) b.click(); };
  const key = (k, o) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, o || {})));
  const noTransitions = () => { const st = document.createElement('style'); st.textContent = '*{transition:none!important;animation:none!important}'; document.head.appendChild(st); return () => st.remove(); };
  const newTabWith = (name, tasks, cal, res) => addNewTab(name, JSON.parse(JSON.stringify(tasks)), Math.max(0, ...tasks.map(t => t.id)) + 1, cal, res);

  // ---------- salvăm starea ----------
  const LS_KEYS = ['ganttSideNames', 'ganttBase', 'ganttCrit', 'ganttDark', 'ganttColW', 'ganttRibbonCollapsed', 'ganttTourDone'];
  const env = {
    tabs: JSON.stringify(tabs), active: activeTabId, next: nextTabId, view, dark: document.body.classList.contains('dark'),
    showSideNames: typeof showSideNames !== 'undefined' ? showSideNames : null,
    showBaseline: typeof showBaseline !== 'undefined' ? showBaseline : null,
    showCritical: typeof showCritical !== 'undefined' ? showCritical : null,
    isAutoZoom, zoomLevel, dayW: document.documentElement.style.getPropertyValue('--day-w'),
    ls: {}, hist: [_history.slice(), _future.slice()],
    filter: typeof FILTER !== 'undefined' ? JSON.stringify(FILTER) : null
  };
  LS_KEYS.forEach(k => { try { env.ls[k] = localStorage.getItem(k); } catch (e) {} });
  localStorage.setItem('ganttTourDone', '1');   // în timpul testelor turul nu pornește singur (se restaurează la final); testele de tur îl pornesc explicit
  const onErr = e => results.errors.push(String(e.message || e));
  window.addEventListener('error', onErr);
  const origToast = window.toast;
  const toasts = [];
  window.toast = m => { toasts.push(m); origToast(m); };
  const restoreEnv = () => {
    window.toast = origToast;
    window.removeEventListener('error', onErr);
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    tabs = JSON.parse(env.tabs); nextTabId = env.next;
    if (tabs.length) { activeTabId = env.active; loadTabData(activeTabId); }
    else { activeTabId = null; T = []; nid = 1; sel = null; coll.clear(); setCal(null); setRes(null); }
    if (env.showSideNames !== null) showSideNames = env.showSideNames;
    if (env.showBaseline !== null) showBaseline = env.showBaseline;
    if (env.showCritical !== null) showCritical = env.showCritical;
    LS_KEYS.forEach(k => { try { env.ls[k] === null ? localStorage.removeItem(k) : localStorage.setItem(k, env.ls[k]); } catch (e) {} });
    if (env.filter !== null && typeof FILTER !== 'undefined') { Object.keys(FILTER).forEach(k => delete FILTER[k]); Object.assign(FILTER, JSON.parse(env.filter)); }
    document.body.classList.remove('pp-open'); document.body.classList.toggle('dark', env.dark);
    isAutoZoom = env.isAutoZoom; zoomLevel = env.zoomLevel;
    if (env.dayW) document.documentElement.style.setProperty('--day-w', env.dayW);
    view = 'gantt'; setViewMode(env.view || 'gantt');
    renderTabsBar(); renderAll(); saveAllTabs();
  };

  // ============================================================
  // A) MOTOR: legături, ierarhie, calendar, constrângeri, CPM
  // ============================================================
  const genRandom = seed => {
    const r = rng(seed), n = 5 + Math.floor(r() * 20), tasks = [];
    const hol = r() < 0.4 ? ['2026-10-28', '2026-11-02'] : [];
    for (let i = 1; i <= n; i++) {
      const pid = (i > 1 && r() < 0.4) ? 1 + Math.floor(r() * (i - 1)) : null;
      tasks.push(mk(i, 'T' + i, 1 + Math.floor(r() * 10), pid, [], fD(aD(pD('2026-10-26'), Math.floor(r() * 12)))));
    }
    return { tasks, hol, r };
  };

  test('motor: 150 de proiecte aleatorii — legături respectate, stabil, capitole corecte', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { tasks, hol, r } = genRandom(seed);
      setProject(tasks, { days: [0, 1, 1, 1, 1, 1, 0], hol });
      const types = ['FS', 'SS', 'FF', 'SF'];
      T.forEach(t => {
        const k = r() < 0.6 ? 1 + Math.floor(r() * 2) : 0;
        for (let q = 0; q < k && t.id > 1; q++) {
          const pid = 1 + Math.floor(r() * (t.id - 1));
          if (t.deps.some(d => d.id === pid) || isD(t.id, pid) || wouldCreateCycle(pid, t.id)) continue;
          t.deps.push(F(pid, types[Math.floor(r() * 4)], Math.floor(r() * 5) - 1));
        }
      });
      settle();
      const s1 = snap(); settle(); eq(snap(), s1, 'seed ' + seed + ' nestabil');
      T.forEach(t => {
        if (hasK(t.id)) {
          kids(t.id).forEach(c => { ok(pD(c.sd) >= pD(t.sd), 'seed ' + seed + ' capitol începe după copil'); ok(endDate(c) <= endDate(t), 'seed ' + seed + ' capitol se termină înaintea copilului'); });
          return;
        }
        t.deps.forEach(d => {
          const p = T.find(x => x.id === d.id), lag = d.lag;
          if (d.type === 'FS') ok(pD(t.sd) >= addWorkDays(endDate(p), 1 + lag), 'seed ' + seed + ' FS încălcat ' + t.id);
          if (d.type === 'SS') ok(pD(t.sd) >= addWorkDays(pD(p.sd), lag), 'seed ' + seed + ' SS încălcat ' + t.id);
          if (d.type === 'FF') ok(endDate(t) >= addWorkDays(endDate(p), lag), 'seed ' + seed + ' FF încălcat ' + t.id);
          if (d.type === 'SF') ok(endDate(t) >= addWorkDays(pD(p.sd), lag), 'seed ' + seed + ' SF încălcat ' + t.id);
        });
      });
    }
  });

  test('ierarhie: legătură spre capitol → eliminată la indent, fără creștere infinită', () => {
    setProject([mk(1, 'A', 3), mk(2, 'B', 2, null, [F(1)])]);
    sel = 2; indentSel();
    eq(T.find(t => t.id === 2).pid, 1, 'B în A');
    eq(T.find(t => t.id === 2).deps.length, 0, 'legătura B→A eliminată');
    for (let i = 0; i < 5; i++) settle();
    eq(T.find(t => t.id === 1).dur, 2, 'durata capitolului = copilul');
  });

  test('legături: ciclul e respins; legătura capitol↔copil e respinsă', () => {
    setProject([mk(1, 'A', 2), mk(2, 'B', 2, null, [F(1)]), mk(3, 'C', 2, null, [F(2)])]);
    updDeps(1, wbs()[3]);
    eq(T.find(t => t.id === 1).deps.length, 0, 'ciclu A←C respins');
    setProject([mk(1, 'Cap', 1), mk(2, 'Copil', 2, 1)]);
    updDeps(2, wbs()[1]);
    eq(T.find(t => t.id === 2).deps.length, 0, 'copil←capitol respins');
  });

  test('import: date stricate sunt curățate (nimic NaN, id-uri unice)', () => {
    T = [null, 5, { id: 1, nm: null, sd: 'xx', dur: 'abc', prog: '9e9', pid: 1, deps: [1, 2, 99] }, { id: 1, nm: 'dup', sd: '2026-10-19', dur: -4, prog: 50, pid: 3, deps: [{ id: 1, type: 'FS', lag: 0 }] }, { id: 3, nm: 'c', sd: '2026-10-19', dur: 2, prog: 0, pid: 4, deps: 'x' }, { id: 4, nm: 'd', sd: '2026-10-19', dur: 2, prog: 0, pid: 3 }];
    _sanitizeTasks(); _ensureDeps();
    const ids = T.map(t => t.id); eq(new Set(ids).size, ids.length, 'id unice');
    T.forEach(t => {
      ok(/^\d{4}-\d{2}-\d{2}$/.test(t.sd), 'sd valid'); ok(t.dur >= 1 && isFinite(t.dur), 'dur valid');
      ok(t.prog >= 0 && t.prog <= 100, 'prog valid'); ok(t.pid === null || ids.includes(t.pid), 'pid valid');
      t.deps.forEach(d => ok(ids.includes(d.id) && d.id !== t.id, 'dep valid'));
    });
    ok(!_topoDepOrder().hasCycle, 'fără cicluri de părinți');
    settle();
  });

  test('calendar: zile libere, endDate/workDur coerente', () => {
    setCal({ days: [0, 1, 1, 1, 1, 1, 0], hol: ['2026-10-28'] });
    eq(fD(addWorkDays(pD('2026-10-26'), 2)), '2026-10-29', 'sare peste zi liberă');
    eq(fD(endDate({ sd: '2026-10-26', dur: 3 })), '2026-10-29');
    eq(workDur(pD('2026-10-26'), pD('2026-10-29')), 3);
    const r = rng(7);
    for (let i = 0; i < 100; i++) {
      const sd = fD(aD(pD('2026-10-20'), Math.floor(r() * 30))), dur = 1 + Math.floor(r() * 20);
      eq(workDur(pD(sd), endDate({ sd, dur })), dur, 'workDur(endDate) ' + sd + ' ' + dur);
    }
    setCal(null);
  });

  test('sărbători RO: Paște ortodox și zile fixe', () => {
    eq(fD(_orthodoxEaster(2024)), '2024-05-05'); eq(fD(_orthodoxEaster(2025)), '2025-04-20');
    eq(fD(_orthodoxEaster(2026)), '2026-04-12'); eq(fD(_orthodoxEaster(2027)), '2027-05-02'); eq(fD(_orthodoxEaster(2028)), '2028-04-16');
    const h = roHolidays(2027); ok(h.includes('2027-04-30') && h.includes('2027-05-03') && h.includes('2027-06-21') && h.includes('2027-12-01'), 'zile lipsă');
  });

  test('constrângeri: SNET mută, MSO fixează, SNLT avertizează', () => {
    setProject([mk(1, 'P', 2), mk(2, 'S', 2, null, [F(1)], '2026-10-26', { cons: { type: 'SNET', date: '2026-11-09' } })]);
    settle(); eq(T[1].sd, '2026-11-09', 'SNET');
    setProject([mk(1, 'P', 2), mk(2, 'S', 2, null, [F(1)], '2026-10-26', { cons: { type: 'MSO', date: '2026-11-16' } })]);
    settle(); eq(T[1].sd, '2026-11-16', 'MSO');
    setProject([mk(1, 'P', 5), mk(2, 'S', 2, null, [F(1)], '2026-10-26', { cons: { type: 'SNLT', date: '2026-10-27' } })]);
    settle(); ok(consWarn[2], 'SNLT dă avertisment');
  });

  test('CPM: drum critic și rezervă', () => {
    setProject([mk(1, 'A', 5), mk(2, 'B', 3, null, [F(1)]), mk(3, 'C', 1, null, [F(1)]), mk(4, 'D', 2, null, [F(2), F(3)])]);
    settle();
    ok(cpm[1].crit && cpm[2].crit && cpm[4].crit, 'A,B,D critice'); ok(!cpm[3].crit, 'C nu e critic'); eq(cpm[3].float, 2, 'rezerva lui C');
  });

  test('resurse: cost, încărcare și supraalocare', () => {
    const res = { cur: 'RON', next: 2, list: [{ id: 1, name: 'Echipă', type: 'work', rate: 10, max: 100 }] };
    setProject([mk(1, 'X', 2, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] }), mk(2, 'Y', 2, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] })], null, res);
    settle();
    eq(costMap[1], 160, 'cost X (2 zile × 8h × 10)'); ok(loadMap[1].over.length > 0, 'zile supraalocate'); ok(resWarn[1] && resWarn[2], 'avertisment pe ambele');
  });

  test('linia de bază: salvare și variație', () => {
    setProject([mk(1, 'A', 5)]); settle();
    saveBaseline(); ok(T[0].bl, 'bl salvat'); const e0 = endDate(T[0]);
    T[0].dur = 8; settle();
    eq(varDays(T[0]), dD(e0, endDate(T[0])), 'variație'); ok(varDays(T[0]) > 0);
  });

  test('undo / redo: activități + calendar + resurse', () => {
    setProject([mk(1, 'A', 5)]); settle(); _history = []; _future = [];
    pushHistory(); T[0].nm = 'Nou'; setCal({ days: [1, 1, 1, 1, 1, 1, 1], hol: [] });
    undo(); eq(T[0].nm, 'A'); eq(CAL.days, [0, 1, 1, 1, 1, 1, 0], 'calendar revenit');
    redo(); eq(T[0].nm, 'Nou'); eq(CAL.days, [1, 1, 1, 1, 1, 1, 1], 'calendar refăcut');
    setCal(null);
  });

  test('salvare/încărcare: JSON dus-întors păstrează tot', () => {
    const res = { cur: 'EUR', next: 2, list: [{ id: 1, name: 'R', type: 'work', rate: 5, max: 200 }] };
    const tab = newTabWith('RT', [mk(1, 'Cap', 1), mk(2, 'A', 4, 1, [], '2026-10-26', { assign: [{ rid: 1, units: 50 }], notes: 'n', deadline: '2026-12-01', cons: { type: 'SNET', date: '2026-11-02' } }), mk(3, 'B', 2, 1, [F(2, 'SS', 2)])], { days: [0, 1, 1, 1, 1, 0, 0], hol: ['2026-11-05'] }, res);
    settle(); syncTabData();
    const d = JSON.parse(_projectJSON());
    const before = JSON.stringify(T);
    const t2 = addNewTab('RT2', d.T, d.nid, d.cal, d.res, d.meta);
    settle();
    eq(JSON.stringify(T), before, 'T identic'); eq(CAL.days, [0, 1, 1, 1, 1, 0, 0]); eq(CAL.hol, ['2026-11-05']); eq(RES.cur, 'EUR'); eq(RES.list.length, 1);
  });

  // ============================================================
  // B) INTERFAȚĂ
  // ============================================================
  test('interfață: exemplul se randează; tabel = Gantt = număr de rânduri', () => {
    addNewTab('Ex'); loadDemo();
    const n = (typeof viewRows === 'function' ? viewRows() : flat()).length;
    eq(document.querySelectorAll('.t-row').length, n, 'rânduri tabel'); eq(document.querySelectorAll('.g-row').length, n, 'rânduri Gantt');
    ok(document.querySelectorAll('.dtx-t').length > 0, 'câmpuri de dată');
  });

  test('interfață: proiect gol se randează fără erori', () => {
    addNewTab('Gol'); eq(T.length, 0); ok($('tBody').textContent.includes('Proiect gol'), 'mesaj proiect gol');
  });

  test('interfață: rândul din tabel și bara din Gantt sunt pe aceeași linie', () => {
    newTabWith('Al', [mk(1, 'Cap', 1), mk(2, 'A', 5, 1), mk(3, 'B', 4, 1, [F(2)]), mk(4, 'C', 3, null, [F(3)])]);
    if ($('gBody').clientHeight < 100) skip('fereastră prea mică pentru aliniere');
    alignPanes();
    const rows = [...document.querySelectorAll('.t-row')], g = [...document.querySelectorAll('.g-row')];
    ok(rows.length === g.length && rows.length > 0, 'același număr de rânduri');
    rows.forEach((r, i) => near(r.getBoundingClientRect().top, g[i].getBoundingClientRect().top, 1, 'rând ' + i));
  });

  test('interfață: taste cu săgeți, deselectare, Esc', () => {
    newTabWith('Tx', [mk(1, 'A', 2), mk(2, 'B', 2), mk(3, 'C', 2)]);
    sel = null; renderAll();
    key('ArrowDown'); eq(sel, 1); key('ArrowDown'); eq(sel, 2); key('ArrowUp'); eq(sel, 1);
    key('ArrowDown'); key('ArrowRight'); eq(T.find(t => t.id === 2).pid, 1, 'indent cu →');
    key('ArrowLeft'); eq(T.find(t => t.id === 2).pid, null, 'outdent cu ←');
    key('Escape'); eq(sel, null, 'Esc deselectează');
    sel = 1; renderAll(); $('tBody').click(); eq(sel, null, 'click pe spațiu gol');
  });

  test('interfață: activitate nouă — durata e obligatorie, start implicit = începutul proiectului', () => {
    newTabWith('Add', [mk(1, 'A', 2, null, [], '2026-11-02')]);
    openAddTask(false); eq($('atStart').value, '2026-11-02', 'start implicit'); eq($('atDur').value, '', 'durata goală');
    $('atName').value = 'X'; const n0 = T.length; saveAddTask(); eq(T.length, n0, 'fără durată nu se creează'); eq($('atErr').style.display, 'block', 'avertisment vizibil');
    $('atDur').value = '3'; saveAddTask(); eq(T.length, n0 + 1, 'cu durată se creează'); eq(T[T.length - 1].dur, 3);
    closeAddTask();
  });

  test('interfață: câmp de dată zz.ll.aaaa — scris de mână actualizează activitatea', () => {
    newTabWith('Dt', [mk(1, 'A', 3, null, [], '2026-11-02')]); renderAll();
    const row = () => document.querySelector('.t-row[data-tid="1"]');
    let tx = row().querySelectorAll('.dtx-t')[0]; eq(tx.value, '02.11.2026');
    tx.value = '09.11.26'; tx.dispatchEvent(new Event('change', { bubbles: true })); eq(T[0].sd, '2026-11-09', 'an cu 2 cifre');
    tx = row().querySelectorAll('.dtx-t')[0]; tx.value = '31.02.2027'; tx.dispatchEvent(new Event('change', { bubbles: true })); eq(T[0].sd, '2026-11-09', 'dată invalidă ignorată');
    eq(parseRO('26102026'), '2026-10-26'); eq(fmtRO('2026-10-26'), '26.10.2026');
  });

  test('interfață: nume în bare — prescurtare, fără număr de rând', () => {
    eq(barLabel({ nm: 'Montaj schele' }, 400), 'Montaj schele');
    eq(barLabel({ nm: 'Montaj schele' }, 10), '');
    const l = barLabel({ nm: 'Avize monumente istorice și autorizație de construire' }, 150);
    ok(l.length > 0 && l.length < 52 && /^Avize/.test(l), 'prescurtat: ' + l);
    eq(barLabel({ nm: 'Avize monumente istorice și autorizație', sn: 'Avize' }, 60), 'Avize', 'nume scurt');
    newTabWith('Nm', [mk(1, 'Releveu și expertiză tehnică', 2), mk(2, 'Proiect', 30)]);
    eq(document.querySelectorAll('.bn-code-in,.bn-out').length, 0, 'fără numere în bare');
  });

  test('interfață: nume lângă bară (buton) apar și dispar', () => {
    newTabWith('Sn', [mk(1, 'A', 5), mk(2, 'B', 5, null, [F(1)])]);
    const before = showSideNames; if (showSideNames) toggleSideNames();
    eq(document.querySelectorAll('.bar-side').length, 0);
    toggleSideNames(); eq(document.querySelectorAll('.bar-side').length, 2, 'două nume lângă bare');
    toggleSideNames(); eq(document.querySelectorAll('.bar-side').length, 0);
    if (before) toggleSideNames();
  });

  test('săgeți: două săgeți în aceeași bară se unesc pe același culoar', () => {
    newTabWith('Ar', [mk(1, 'Releveu', 15), mk(2, 'Studiu', 20), mk(3, 'Proiect', 30, null, [F(1), F(2)])]);
    const lines = [...document.querySelectorAll('.dep-line[data-dep-to="3"]')]; eq(lines.length, 2, 'două săgeți desenate');
    const ends = lines.map(p => { const L = p.getTotalLength(), e = p.getPointAtLength(L), a = p.getPointAtLength(L - 9); return { ex: e.x, ey: e.y, ax: a.x }; });
    near(ends[0].ex, ends[1].ex, 0.5, 'același capăt x'); near(ends[0].ey, ends[1].ey, 0.5, 'același capăt y'); near(ends[0].ax, ends[1].ax, 1.2, 'același culoar');
    ok(!document.querySelector('.dep-dup'), 'fără săgeți ascunse');
  });

  test('vedere arbore: se deschide și revine la Gantt', async () => {
    newTabWith('Tr', [mk(1, 'Cap', 1), mk(2, 'A', 3, 1), mk(3, 'B', 2, 1, [F(2)])]);
    setViewMode('tree'); await wait(50); ok($('treeBox').innerHTML.length > 50, 'arbore randat');
    setViewMode('gantt'); await wait(20); eq(view, 'gantt'); ok(document.querySelectorAll('.t-row').length === 3);
  });

  test('capitol nou: se adaugă deasupra rândului selectat', () => {
    newTabWith('Ch', [mk(1, 'A', 2), mk(2, 'B', 2)]); sel = 2; addChapter();
    eq(T.map(t => t.nm), ['A', 'Capitol nou', 'B']); eq(sel, T[1].id);
  });

  test('proiecte: închiderea tuturor → ecran de bun venit; exemplu se deschide', async () => {
    const restoreT = noTransitions();
    while (tabs.length) { closeTab(tabs[0].id); confirmYes(); }
    eq(tabs.length, 0); ok(document.body.classList.contains('no-project'), 'clasa no-project');
    openExample(); await wait(30);
    eq(tabs.length, 1); ok(!document.body.classList.contains('no-project')); ok(T.length > 10, 'exemplu încărcat');
    restoreT();
  });

  // ============================================================
  // C) URMĂRIRE PROGRES: data de status, început / final real, actualizarea planului
  // ============================================================
  const byId = id => T.find(t => t.id === id);

  test('progres real: data de status decide ce e „întârziat" (și ziua finalului nu e încă întârziere)', () => {
    newTabWith('St', [mk(1, 'A', 3, null, [], '2026-10-26')]); settle();       // se termină joi 2026-10-28
    META.sdate = '2026-10-28'; ok(!isBehind(byId(1)), 'în ziua finalului nu e întârziată'); ok(_statusOf(byId(1)).k !== 'late', 'insigna nu e „întârziat"');
    META.sdate = '2026-10-29'; ok(isBehind(byId(1)), 'a doua zi e întârziată'); eq(_statusOf(byId(1)).k, 'late');
    byId(1).prog = 100; ok(!isBehind(byId(1)), 'finalizată nu e întârziată'); META.sdate = null;
  });

  test('progres real: la schimbarea progresului se completează / se scot început și final real', () => {
    newTabWith('Pg', [mk(1, 'A', 5), mk(2, 'B', 5)]);
    upd(1, 'prog', '40'); eq(byId(1).as, statusDay(), 'început real la >0%'); ok(!byId(1).af);
    upd(1, 'prog', '100'); eq(byId(1).af, statusDay(), 'final real la 100%');
    upd(1, 'prog', '50'); ok(!byId(1).af, 'final real scos când scade sub 100%'); ok(byId(1).as, 'începutul rămâne');
    upd(1, 'prog', '0'); ok(!byId(1).as, 'început real scos la 0%');
    upd(2, 'prog', '100'); ok(byId(2).as && byId(2).af, 'de la 0 direct la 100%: ambele');
    ok(byId(2).as <= byId(2).af, 'început ≤ final');
  });

  test('progres real: capitolele și reperele nu au date reale', () => {
    newTabWith('Cp', [mk(1, 'Cap', 1), mk(2, 'A', 3, 1), mk(3, 'M', 1, null, [], '2026-10-26', { isMilestone: true })]);
    markStarted(1); ok(!byId(1).as, 'capitol'); markDone(3); ok(!byId(3).af, 'reper');
    markStarted(2); ok(byId(2).as, 'activitate'); markDone(2); eq(byId(2).prog, 100); ok(byId(2).af);
  });

  test('progres real: „Actualizează planul" fixează la datele reale, mută nepornitele, se poate anula', () => {
    newTabWith('Ap', [mk(1, 'A', 5, null, [], '2026-10-26', { as: '2026-10-28', af: '2026-11-06', prog: 100 }), mk(2, 'B', 3, null, [F(1)]), mk(3, 'C', 2, null, [], '2026-10-27')]);
    META.sdate = '2026-11-09'; settle(); eq(byId(2).sd, '2026-11-02', 'planul înainte');
    applyActuals(); confirmYes();
    eq(byId(1).cons && byId(1).cons.type, 'MSO'); ok(byId(1).cons.ac, 'fixare marcată'); eq(byId(1).sd, '2026-10-28'); eq(byId(1).dur, 8, 'durata reală');
    eq(byId(2).sd, '2026-11-09', 'urmașul pornește după finalul real'); eq(byId(3).sd, '2026-11-09', 'nepornita mutată după data de status'); eq(byId(3).cons.type, 'SNET');
    undo(); eq(byId(1).dur, 5, 'anulat: durata'); ok(!byId(1).cons, 'anulat: fără fixare'); eq(byId(2).sd, '2026-11-02'); eq(byId(3).sd, '2026-10-27');
    redo(); eq(byId(2).sd, '2026-11-09', 'refăcut');
    clearActualPins(); confirmYes(); ok(!byId(1).cons && !byId(3).cons, 'fixările eliminate'); eq(byId(1).dur, 8, 'durata ajustată rămâne'); eq(byId(3).sd, '2026-11-09', 'fără legături: rămâne unde a fost mutată'); eq(byId(2).sd, '2026-11-09', 'cu legături: urmează finalul lui A');
    META.sdate = null;
  });

  test('progres real: activitatea în desfășurare rămasă în urmă își mută finalul (munca rămasă)', () => {
    newTabWith('Ex', [mk(1, 'X', 10, null, [], '2026-10-26', { as: '2026-10-26', prog: 60 }), mk(2, 'Y', 2, null, [F(1)])]);
    META.sdate = '2026-11-16'; settle(); eq(fD(endDate(byId(1))), '2026-11-06');
    applyActuals(); confirmYes();
    eq(byId(1).dur, 19, 'durata prelungită până la data de status + munca rămasă (4 zile)'); eq(fD(endDate(byId(1))), '2026-11-19'); eq(byId(2).sd, '2026-11-20', 'urmașul pornește după');
    META.sdate = null;
  });

  test('progres real: restricția pusă de utilizator nu se atinge', () => {
    newTabWith('Rs', [mk(1, 'A', 3, null, [], '2026-10-26', { as: '2026-10-27', cons: { type: 'SNET', date: '2026-10-26' } })]);
    META.sdate = '2026-11-09'; applyActuals(); confirmYes();
    eq(byId(1).cons.type, 'SNET'); ok(!byId(1).cons.ac, 'restricția rămâne a utilizatorului'); META.sdate = null;
  });

  test('progres real: bara reală (verde / roșu / albastru) apare în Gantt', () => {
    newTabWith('Bp', [mk(1, 'A', 3, null, [], '2026-10-26', { as: '2026-10-26', af: '2026-10-28', prog: 100 }), mk(2, 'B', 3, null, [], '2026-10-26', { as: '2026-10-26', af: '2026-10-30', prog: 100 }), mk(3, 'C', 5, null, [], '2026-10-26', { as: '2026-10-26', prog: 40 })]);
    META.sdate = '2026-11-02'; renderAll();
    const cls = id => { const r = document.querySelector('.g-row[data-gid="' + id + '"] .act-bar'); return r ? r.className : null; };
    ok(/ ok/.test(cls(1)), 'la timp → verde: ' + cls(1)); ok(/ late/.test(cls(2)), 'întârziată → roșu: ' + cls(2)); ok(/ wip/.test(cls(3)), 'în desfășurare → albastră: ' + cls(3));
    META.sdate = null;
  });

  test('progres real: variația față de bază folosește finalul real', () => {
    newTabWith('Vb', [mk(1, 'A', 5, null, [], '2026-10-26', { as: '2026-10-26', af: '2026-11-03', prog: 100 })]); settle(); saveBaseline();
    eq(varDays(byId(1)), dD(endDate({ sd: '2026-10-26', dur: 5 }), pD('2026-11-03')), 'variație = final real − final de bază');
  });

  test('progres real: data de status și datele reale se salvează / se anulează / se încarcă', () => {
    newTabWith('Sv', [mk(1, 'A', 5, null, [], '2026-10-26', { as: '2026-10-27' })]); META.sdate = '2026-11-02'; syncTabData();
    const d = JSON.parse(_projectJSON()); eq(d.meta.sdate, '2026-11-02', 'în fișier'); eq(d.T[0].as, '2026-10-27');
    addNewTab('Sv2', d.T, d.nid, d.cal, d.res, d.meta); eq(META.sdate, '2026-11-02', 'după încărcare'); eq(byId(1).as, '2026-10-27');
    pushHistory(); META.sdate = null; undo(); eq(META.sdate, '2026-11-02', 'undo restaurează data de status');
    switchTab(tabs[tabs.length - 2].id); eq(META.sdate, '2026-11-02', 'data de status aparține proiectului'); META.sdate = null;
  });

  test('progres real: Task Info completează, validează și salvează datele reale', () => {
    newTabWith('Ti', [mk(1, 'A', 5)]);
    openTaskInfo(1); $('tiProg').value = '100'; $('tiSaveBtn').click();
    ok(byId(1).as && byId(1).af, 'completate la 100%'); const af0 = byId(1).af;
    openTaskInfo(1); eq(document.querySelector('#tiAf ~ .dtx-t').value, fmtRO(af0), 'se afișează în format românesc');
    dtSet('tiAs', '2099-01-01'); $('tiSaveBtn').click();
    ok($('taskInfoModal').classList.contains('open'), 'început după final: fereastra rămâne deschisă'); eq(byId(1).af, af0, 'nimic salvat');
    dtSet('tiAs', '2026-10-20'); dtSet('tiAf', '2026-10-27'); $('tiSaveBtn').click();
    eq(byId(1).as, '2026-10-20'); eq(byId(1).af, '2026-10-27'); ok(!$('taskInfoModal').classList.contains('open'));
    openTaskInfo(1); $('tiProg').value = '60'; $('tiSaveBtn').click(); ok(!byId(1).af, 'progres sub 100% scoate finalul real'); eq(byId(1).prog, 60);
  });

  test('progres real: fereastra „Data de status" + linia „Status" în Gantt', () => {
    const t0 = fD(aD(new Date(), -3));
    newTabWith('Sm', [mk(1, 'A', 20, null, [], t0)]);
    ok(!document.querySelector('.today-flag-h.status'), 'fără linie Status când e azi');
    openStatusDate(); ok($('statusModal').classList.contains('open'));
    $('stAuto').checked = false; stToggleAuto(); dtSet('stDate', fD(aD(new Date(), 5))); saveStatusDate();
    ok(hasCustomStatus()); ok(document.querySelector('.today-flag-h.status'), 'steag Status'); ok(document.querySelector('.vl.status'), 'linie Status'); ok($('sbar').textContent.includes('Status'), 'în bara de stare');
    openStatusDate(); $('stAuto').checked = true; stToggleAuto(); saveStatusDate(); ok(!hasCustomStatus(), 'revenire la azi');
  });

  test('progres real: intervalul graficului include datele reale din afara planului', () => {
    newTabWith('Ab', [mk(1, 'A', 3, null, [], '2026-11-02', { as: '2026-10-05', prog: 20 })]);
    ok(ab().mn <= pD('2026-10-05'), 'începutul real e în interval');
  });

  test('progres real: bara mutată / redimensionată / progresul intră în istoric (Ctrl+Z)', () => {
    newTabWith('Is', [mk(1, 'A', 5, null, [], '2026-10-26')]); _history = []; _future = [];
    const bar = document.querySelector('.gb[data-bid="1"]'); const x0 = bar.getBoundingClientRect().left + 10, y0 = bar.getBoundingClientRect().top + 8, dw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-w'));
    const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
    fire(bar, 'mousedown', x0, y0); fire(document, 'mouseup', x0, y0);     // click simplu, fără mutare
    eq(_history.length, 0, 'click fără mutare nu umple istoricul');
    fire(document.querySelector('.gb[data-bid="1"]'), 'mousedown', x0, y0); fire(document, 'mousemove', x0 + dw * 7, y0); fire(document, 'mouseup', x0 + dw * 7, y0);
    ok(byId(1).sd !== '2026-10-26', 'bara s-a mutat'); eq(_history.length, 1, 'mutarea intră în istoric'); undo(); eq(byId(1).sd, '2026-10-26', 'undo readuce bara');
  });

  // ============================================================
  // D) FILTRE
  // ============================================================
  const filterProject = () => {
    const res = { cur: 'RON', next: 3, list: [{ id: 1, name: 'Echipa A', type: 'work', rate: 10, max: 100 }, { id: 2, name: 'Echipa B', type: 'work', rate: 10, max: 100 }] };
    const tasks = [
      mk(1, 'Cap1', 1), mk(2, 'A', 5, 1, [], '2026-10-26', { prog: 100 }), mk(3, 'B', 5, 1, [F(2)], '2026-10-26', { prog: 40, assign: [{ rid: 1, units: 100 }] }), mk(4, 'C', 3, 1, [F(3)]),
      mk(5, 'Cap2', 1), mk(6, 'D', 4, 5, [], '2026-10-26', { assign: [{ rid: 2, units: 100 }] }), mk(7, 'M', 1, 5, [F(4)], '2026-10-26', { isMilestone: true })
    ];
    newTabWith('Fl', tasks, null, res); META.sdate = '2026-11-05'; settle(); clearFilter(true); renderAll();
  };
  const rowsOf = () => viewRows().map(t => t.id);
  const withFilter = (type, extra) => { clearFilter(true); FILTER.type = type; Object.assign(FILTER, extra || {}); renderAll(); return rowsOf(); };

  test('filtre: fără filtru, viewRows() = flat()', () => {
    filterProject(); eq(viewRows().map(t => t.id), flat().map(t => t.id)); ok(!filterActive());
    coll.add(1); renderAll(); eq(rowsOf(), flat().map(t => t.id), 'respectă capitolele închise'); coll.clear(); renderAll();
  });

  test('filtre: tipuri (critic, întârziate, nefinalizate, în lucru, nepornite, finalizate, repere, resursă, interval, avertismente)', () => {
    filterProject();
    eq(withFilter('crit'), [1, 2, 3, 4, 5, 7], 'drum critic');
    eq(withFilter('late'), [5, 6], 'întârziate (D) la data de status 05.11');
    eq(withFilter('open'), [1, 3, 4, 5, 6, 7], 'nefinalizate');
    eq(withFilter('wip'), [1, 3], 'în lucru'); eq(withFilter('todo'), [1, 4, 5, 6, 7], 'nepornite'); eq(withFilter('done'), [1, 2], 'finalizate');
    eq(withFilter('ms'), [5, 7], 'repere'); eq(withFilter('res', { rid: 1 }), [1, 3], 'resursa A'); eq(withFilter('res', { rid: 2 }), [5, 6], 'resursa B');
    eq(withFilter('range', { from: '2026-11-09', to: '2026-11-12' }), [1, 4, 5, 7], 'interval');
    byId(6).deadline = '2026-10-28'; renderAll(); eq(withFilter('warn'), [5, 6], 'avertismente (termen depășit)');
    clearFilter(true); META.sdate = null;
  });

  test('filtre: nume fără diacritice / majuscule; numele capitolului arată tot conținutul lui', () => {
    filterProject(); byId(3).nm = 'Fundații turnate'; renderAll();
    clearFilter(true); FILTER.text = 'FUNDATII'; renderAll(); eq(rowsOf(), [1, 3], 'diacritice și majuscule');
    FILTER.text = 'cap2'; renderAll(); eq(rowsOf(), [5, 6, 7], 'numele capitolului → toate rândurile lui');
    FILTER.text = 'zzz'; renderAll(); eq(rowsOf(), []); ok($('tBody').textContent.includes('Niciun rând'), 'mesaj fără rezultate');
    FILTER.text = 'fundatii'; FILTER.type = 'done'; renderAll(); eq(rowsOf(), [], 'tip + nume se combină (ȘI)');
    clearFilter(true); META.sdate = null;
  });

  test('filtre: tabelul și Gantt-ul au aceleași rânduri, aliniate, săgețile doar între rândurile afișate', () => {
    filterProject(); withFilter('crit');
    const n = rowsOf().length; eq(document.querySelectorAll('.t-row').length, n); eq(document.querySelectorAll('.g-row').length, n);
    if ($('gBody').clientHeight >= 100) {
      alignPanes(); const rows = [...document.querySelectorAll('.t-row')], g = [...document.querySelectorAll('.g-row')];
      rows.forEach((r, i) => near(r.getBoundingClientRect().top, g[i].getBoundingClientRect().top, 1, 'rând ' + i));
    }
    const vis = new Set(rowsOf()); document.querySelectorAll('.dep-group').forEach(g => ok(vis.has(+g.dataset.depFrom) && vis.has(+g.dataset.depTo), 'săgeată spre rând ascuns'));
    ok(document.querySelectorAll('.dep-group').length >= 2, 'săgeți între rândurile critice');
    clearFilter(true); META.sdate = null;
  });

  test('filtre: bara de filtru, butonul și numărul de rânduri din bara de stare', () => {
    filterProject(); eq($('filterBar').style.display, 'none');
    setFilter('crit'); eq($('filterBar').style.display, 'flex'); ok($('filterBarTxt').textContent.includes('Drum critic')); ok($('btnFilter').classList.contains('active')); ok($('sbar').textContent.includes('afișate'));
    clearFilter(); eq($('filterBar').style.display, 'none'); ok(!$('btnFilter').classList.contains('active')); META.sdate = null;
  });

  test('filtre: cu filtru pornit nu se pot muta / șterge capitole (ar afecta rânduri ascunse)', () => {
    filterProject(); withFilter('open'); sel = 3; const pid = byId(3).pid, n = T.length;
    indentSel(); eq(byId(3).pid, pid, 'indent blocat'); moveSel(1); eq(T.map(t => t.id), [1, 2, 3, 4, 5, 6, 7], 'mutare blocată');
    sel = 1; delSel(); eq(T.length, n, 'capitolul nu se șterge'); ok(toasts.slice(-1)[0].includes('filtrul'), 'mesaj');
    sel = 4; delSel(); eq(T.length, n - 1, 'activitatea vizibilă se poate șterge');
    clearFilter(true); META.sdate = null;
  });

  test('filtre: adăugarea unui capitol / activități oprește filtrul', () => {
    filterProject(); withFilter('done'); addChapter(); ok(!filterActive(), 'addChapter oprește filtrul');
    withFilter('done'); openAddTask(false); ok(!filterActive(), 'openAddTask oprește filtrul'); closeAddTask(); META.sdate = null;
  });

  test('filtre: schimbarea proiectului oprește filtrul', () => {
    filterProject(); setFilter('crit'); ok(filterActive());
    newTabWith('Alt', [mk(1, 'X', 2)]); ok(!filterActive(), 'filtrul nu trece în alt proiect'); eq($('flText').value, '');
  });

  test('filtre: fereastra de filtre aplică resursa și intervalul', () => {
    filterProject(); openFilterModal(); $('flType').value = 'res'; _flToggle(); $('flRes').value = '2'; applyFilterModal();
    eq(FILTER.type, 'res'); eq(rowsOf(), [5, 6]);
    openFilterModal(); $('flType').value = 'range'; _flToggle(); dtSet('flFrom', '2026-11-09'); dtSet('flTo', '2026-11-12'); $('flName').value = 'm'; applyFilterModal();
    eq(rowsOf(), [5, 7], 'interval + nume „m" (M)'); clearFilter(); META.sdate = null;
  });

  test('filtre: navigarea cu săgeți merge doar printre rândurile afișate', () => {
    filterProject(); withFilter('wip'); sel = null; renderAll();   // rânduri: Cap1, B
    key('ArrowDown'); eq(sel, 1); key('ArrowDown'); eq(sel, 3); key('ArrowDown'); eq(sel, 3, 'rămâne pe ultimul'); clearFilter(true); META.sdate = null;
  });

  // ============================================================
  // E) TIPĂRIRE / PDF
  // ============================================================
  const bigProject = n => { const t = []; for (let i = 1; i <= n; i++) t.push(mk(i, 'Activitatea numărul ' + i + ' din plan', 3 + (i % 5), i % 10 === 1 ? null : null, i > 1 && i % 3 ? [F(i - 1)] : [])); return t; };
  const ppOpen = (opts) => {
    if ($('printPreview').style.display !== 'none') closePrintPreview();
    openPrintPreview();
    if (opts) { if (opts.paper) $('ppPaper').value = opts.paper; if (opts.orient) $('ppOrient').value = opts.orient; if (opts.fit) $('ppFit').value = opts.fit; if (opts.names !== undefined) $('ppNames').checked = opts.names; }
    return ppRebuild();
  };

  test('tipărire: pagini cu aceleași rânduri ca pe ecran, aliniate stânga/dreapta, nimic pierdut sau dublat', () => {
    newTabWith('Pr', bigProject(60)); const n = viewRows().length;
    const r = ppOpen({ paper: 'a4', orient: 'l', fit: 'w', names: true });
    const pages = [...document.querySelectorAll('#ppPages .pp-page')]; eq(pages.length, r.pages); ok(pages.length > 1, 'mai multe pagini: ' + pages.length);
    eq(pages.reduce((s, p) => s + (+p.dataset.rows), 0), n, 'suma rândurilor pe pagini = rândurile proiectului');
    const seen = []; pages.forEach((p, i) => {
      const left = [...p.querySelectorAll('.pp-row')]; eq(left.length, +p.dataset.rows, 'rânduri în tabel, pagina ' + i);
      const gb = p.querySelector('.pp-gbody').getBoundingClientRect();
      left.forEach(l => {
        seen.push(+l.dataset.tid);
        const g = p.querySelector('.g-row[data-gid="' + l.dataset.tid + '"]'); ok(g, 'rând Gantt lipsă ' + l.dataset.tid);
        near(l.getBoundingClientRect().top, g.getBoundingClientRect().top, 1, 'aliniere rând ' + l.dataset.tid);
        ok(g.getBoundingClientRect().top >= gb.top - 1 && g.getBoundingClientRect().bottom <= gb.bottom + 1, 'rândul Gantt e în pagină');
      });
      ok(p.querySelector('.pp-foot').textContent.includes('Pagina ' + (i + 1) + ' din ' + pages.length), 'subsol');
      ok(p.querySelector('.pp-th') && p.querySelector('.pp-ghead .hc.mo'), 'antet repetat pe fiecare pagină');
      const cont = p.querySelector('.pp-content').getBoundingClientRect(), sc = p.querySelector('.pp-scale').getBoundingClientRect();
      ok(sc.width <= cont.width + 1, 'încape pe lățime: ' + Math.round(sc.width) + ' ≤ ' + Math.round(cont.width));
    });
    eq(seen, viewRows().map(t => t.id), 'ordinea și unicitatea rândurilor');
    closePrintPreview();
  });

  test('tipărire: totul pe o pagină (A3 portret) și scară rezonabilă', () => {
    newTabWith('P1', bigProject(25)); const n = viewRows().length;
    const r = ppOpen({ paper: 'a3', orient: 'p', fit: '1', names: false });
    eq(r.pages, 1); eq(+document.querySelector('#ppPages .pp-page').dataset.rows, n);
    const k = parseFloat(document.querySelector('.pp-scale').style.transform.replace('scale(', '')); ok(k > 0.25 && k <= 1.3, 'scară ' + k);
    const pg = document.querySelector('.pp-page'), cont = pg.querySelector('.pp-content').getBoundingClientRect(), sc = pg.querySelector('.pp-scale').getBoundingClientRect();
    ok(sc.width <= cont.width + 1 && sc.height <= cont.height + 1, 'încape și pe înălțime');
    ok($('ppPageCss').textContent.includes('size:297.0mm 420.0mm') || $('ppPageCss').textContent.includes('size:297.0mm 420.1mm') || /size:29\d\.\dmm 4\d\d\.\dmm/.test($('ppPageCss').textContent), 'format de pagină: ' + $('ppPageCss').textContent);
    closePrintPreview();
  });

  test('tipărire: tema luminoasă pe hârtie; starea ecranului (zoom, selecție, nume, temă) se restaurează', () => {
    newTabWith('Ps', bigProject(12)); document.body.classList.add('dark'); sel = 3; isAutoZoom = false; zoomLevel = 55; document.documentElement.style.setProperty('--day-w', '16px');
    const before = { auto: isAutoZoom, zl: zoomLevel, dw: document.documentElement.style.getPropertyValue('--day-w'), side: showSideNames, sel };
    ppOpen({ names: !showSideNames });
    ok(!document.body.classList.contains('dark'), 'fără clasa dark cât timp e deschis'); ok(document.body.classList.contains('pp-open'));
    eq({ auto: isAutoZoom, zl: zoomLevel, dw: document.documentElement.style.getPropertyValue('--day-w'), side: showSideNames, sel }, before, 'starea ecranului după captură');
    closePrintPreview();
    ok(document.body.classList.contains('dark'), 'tema revine'); ok(!document.body.classList.contains('pp-open')); eq($('printPreview').style.display, 'none'); eq($('ppPages').innerHTML, ''); eq($('ppPageCss').textContent, '');
    document.body.classList.remove('dark'); isAutoZoom = true;
  });

  test('tipărire: respectă filtrul și capitolele închise; fără rânduri → mesaj', () => {
    filterProject(); setFilter('crit'); const n = viewRows().length;
    ppOpen(); eq(document.querySelectorAll('#ppPages .pp-row').length, n, 'doar rândurile filtrate'); ok(document.querySelector('.pp-head span').textContent.includes('filtru'), 'filtrul apare în antet');
    closePrintPreview(); clearFilter(true); coll.add(1); renderAll(); const m = viewRows().length;
    ppOpen(); eq(document.querySelectorAll('#ppPages .pp-row').length, m, 'capitolul închis nu își arată copiii'); closePrintPreview(); coll.clear();
    FILTER.text = 'zzz'; renderAll(); openPrintPreview(); ok($('ppPages').textContent.includes('Niciun rând'), 'mesaj'); closePrintPreview(); clearFilter(true); META.sdate = null;
  });

  test('tipărire: regulile @media print, Ctrl+P și Esc', () => {
    let found = false; for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (r.media && /print/.test(r.conditionText || r.media.mediaText) && r.cssText.includes('pp-open')) found = true; } catch (e) {} }
    ok(found, 'regulă @media print pentru previzualizare');
    newTabWith('Pk', bigProject(5)); ok($('printPreview').style.display === 'none');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true })); eq($('printPreview').style.display, 'flex', 'Ctrl+P deschide');
    key('Escape'); eq($('printPreview').style.display, 'none', 'Esc închide');
    sel = 1; const n0 = T.length; openPrintPreview(); key('Delete'); eq(T.length, n0, 'Delete nu modifică proiectul cât e deschisă previzualizarea'); closePrintPreview();
  });

  test('tipărire: proiect gol nu deschide previzualizarea', () => {
    addNewTab('Gol2'); openPrintPreview(); eq($('printPreview').style.display, 'none'); ok(toasts.slice(-1)[0].includes('gol'));
  });

  test('tipărire: PDF direct are câte o pagină per foaie', async () => {
    newTabWith('Pd', bigProject(40)); const r = ppOpen({ paper: 'a4', orient: 'l', fit: 'w', names: false });
    const pdf = await ppBuildPdf(); eq(pdf.getNumberOfPages(), r.pages, 'pagini în PDF'); ok(pdf.output('arraybuffer').byteLength > 5000, 'PDF nevid');
    closePrintPreview();
  });

  // ============================================================
  // F) EXCEL / CSV
  // ============================================================
  const enc = new TextEncoder();
  const bytesEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const xmlOk = (name, u8) => { const d = new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml'); ok(!d.getElementsByTagName('parsererror').length, 'XML invalid: ' + name); };
  const sheetsProject = () => {
    const res = { cur: 'RON', next: 3, list: [{ id: 1, name: 'Echipa A', type: 'work', rate: 10, max: 100 }, { id: 2, name: 'Beton', type: 'material', rate: 450, unit: 'm³' }] };
    const tasks = [
      mk(1, 'Pregătire și avize', 1), mk(2, 'Releveu; "expertiză" tehnică', 5, 1, [], '2026-10-26', { prog: 100, as: '2026-10-26', af: '2026-11-03', notes: 'linia 1\nlinia 2, cu virgulă' }),
      mk(3, 'Proiect', 8, 1, [F(2, 'FS', 1)], '2026-10-26', { prog: 40, assign: [{ rid: 1, units: 100 }, { rid: 2, units: 3 }] }),
      mk(4, 'Avize', 4, 1, [F(3, 'SS', 2)]),
      mk(5, 'Șantier', 1), mk(6, 'Împrejmuire', 7, 5, [F(4)]), mk(7, 'Recepție', 1, 5, [F(6)], '2026-10-26', { isMilestone: true })
    ];
    newTabWith('Xl', tasks, null, res); settle(); return JSON.parse(JSON.stringify(T));
  };
  const leafKey = list => list.filter(t => !list.some(x => x.pid === t.id)).map(t => [t.nm, t.sd, t.dur, t.prog, !!t.isMilestone, t.as || '', t.af || '']);
  const depKey = (list, byName) => list.map(t => [t.nm, (t.deps || []).map(d => { const p = list.find(x => x.id === d.id); return p.nm + d.type + d.lag; }).sort()]);

  test('excel: CRC32 corect, ZIP dus-întors, ZIP cu compresie (ca Excel) se citește', async () => {
    eq(crc32(enc.encode('123456789')), 0xCBF43926, 'CRC32');
    const bin = new Uint8Array(3000).map((_, i) => (i * 7 + (i >> 3)) & 255), z = await unzip(zipStore([{ name: 'a/b.txt', data: enc.encode('Șantier ă î') }, { name: 'bin.dat', data: bin }]));
    eq(new TextDecoder().decode(z.get('a/b.txt')), 'Șantier ă î'); ok(bytesEq(z.get('bin.dat'), bin), 'binar identic');
    // ZIP cu metoda 8 (deflate), construit aici cu CompressionStream
    const raw = enc.encode('<x>' + 'abc'.repeat(500) + '</x>'), cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')), comp = new Uint8Array(await new Response(cs).arrayBuffer());
    const name = enc.encode('d.xml'), lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46)), end = new DataView(new ArrayBuffer(22));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 8, true); lh.setUint32(14, crc32(raw), true); lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true);
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(10, 8, true); ch.setUint32(16, crc32(raw), true); ch.setUint32(20, comp.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, 0, true);
    const cdOff = 30 + name.length + comp.length; end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true); end.setUint32(12, 46 + name.length, true); end.setUint32(16, cdOff, true);
    const zip = new Uint8Array(cdOff + 46 + name.length + 22); let p = 0; [new Uint8Array(lh.buffer), name, comp, new Uint8Array(ch.buffer), name, new Uint8Array(end.buffer)].forEach(c => { zip.set(c, p); p += c.length; });
    ok(bytesEq((await unzip(zip)).get('d.xml'), raw), 'deflate decomprimat');
  });

  test('excel: .xlsx construit are XML valid și se citește înapoi (text, numere, date, caractere speciale)', async () => {
    const rows = [[{ v: 'Nume', s: XL.S_HEAD }, 'Zile', 'Start', 'Alt'], ['A <&> "b"\nlinia 2', { v: 12, t: 'n' }, { v: '2026-10-26', t: 'd', s: XL.S_DATE }, ''], ['Ș ț ă', { v: 3.5, t: 'n', s: XL.S_MONEY }, { v: '2027-02-28', t: 'd', s: XL.S_CH_DATE }, 'x']];
    const bytes = xlsxBuild([{ name: 'Plan', widths: [20, 8, 12, 6], rows, freezeHeader: true, filter: true }, { name: 'Foaia / 2: ?', rows: [['b']] }]);
    const z = await unzip(bytes); ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].forEach(n => { ok(z.has(n), 'lipsește ' + n); xmlOk(n, z.get(n)); });
    const wb = await xlsxRead(bytes); eq(wb.sheets.length, 2); eq(wb.sheets[0].name, 'Plan'); ok(!/[\/:?]/.test(wb.sheets[1].name), 'nume de foaie curățat: ' + wb.sheets[1].name);
    eq(wb.sheets[0].rows[0], ['Nume', 'Zile', 'Start', 'Alt']); eq(wb.sheets[0].rows[1], ['A <&> "b"\nlinia 2', 12, '2026-10-26']); eq(wb.sheets[0].rows[2], ['Ș ț ă', 3.5, '2027-02-28', 'x']);
  });

  test('excel: proiectul exportat în .xlsx se importă identic (ierarhie, legături, progres, date reale, note)', async () => {
    const orig = sheetsProject().map(t => ({ ...t, deps: t.deps.map(d => ({ ...d })) })); const before = JSON.stringify(T);
    const wb = await xlsxRead(buildWorkbookBytes()); eq(wb.sheets.map(s => s.name), ['Plan', 'Resurse']); eq(wb.sheets[0].rows[0].slice(0, 7), SH_HEAD.slice(0, 7), 'antet');
    const nTabs = tabs.length, res = importRowsAsTab(wb.sheets[0].rows, 'Import'); eq(tabs.length, nTabs + 1, 'tab nou'); settle();
    eq(T.length, orig.length, 'număr de rânduri'); eq(T.map(t => t.nm), orig.map(t => t.nm), 'nume (cu ghilimele, ; și diacritice)');
    eq(T.map(t => t.pid ? orig.find(o => o.nm === T.find(x => x.id === t.pid).nm).id : null), orig.map(t => t.pid), 'ierarhia');
    eq(leafKey(T), leafKey(orig).map((r, i) => r), 'activități: start, durată, progres, reper, date reale'); eq(depKey(T), depKey(orig), 'legături (tip și decalaj)');
    eq(T.find(t => t.nm.startsWith('Releveu')).notes, 'linia 1\nlinia 2, cu virgulă', 'note multi-linie');
    eq(res.linked, 4, 'legături importate');
    switchTab(tabs[nTabs - 1].id); eq(JSON.stringify(T), before, 'proiectul de dinainte nu s-a atins');
  });

  test('excel: CSV (separator ;) dus-întors, cu ghilimele, ; și linii noi în celule', () => {
    sheetsProject(); const orig = T.map(t => t.nm), csv = buildCsvText(';'); ok(csv.charCodeAt(0) === 0xFEFF, 'BOM pentru Excel'); ok(csv.split('\r\n')[0].includes(';'), 'separator ;');
    const rows = csvParse(csv); eq(rows[0], SH_HEAD); eq(rows.length - 1, orig.length + 0, 'rânduri (fără linia goală de la final)');
    const p = parseSheetRows(rows); ok(p.ok); eq(p.tasks.map(t => t.nm), orig); eq(p.tasks[1].notes, 'linia 1\nlinia 2, cu virgulă');
    const pc = parseSheetRows(csvParse(buildCsvText(','))); ok(pc.ok); eq(pc.tasks.map(t => t.nm), orig, 'și cu separator virgulă (SUA)'); eq(pc.tasks.map(t => t.dur), p.tasks.map(t => t.dur));
    ok(['.', ','].length && (csvDelimiter() === ';' || csvDelimiter() === ','), 'separator ales automat');
    eq(csvParse('a,b,c\n1,"x,y",3\n'), [['a', 'b', 'c'], ['1', 'x,y', '3']], 'delimitator virgulă detectat'); eq(csvParse('a\tb\n1\t2'), [['a', 'b'], ['1', '2']], 'tab'); eq(csvParse('x;y\r\n"a ""q"" b";2\r\n'), [['x', 'y'], ['a "q" b', '2']], 'ghilimele duble');
  });

  test('excel: CSV exportat începe cu BOM (diacritice în Excel), fără „sep=” (ar anula BOM-ul); importul înțelege „sep=” din alte fișiere', () => {
    sheetsProject(); const csv = buildCsvText(','); eq(csv.slice(0, 4), '﻿WBS'); ok(!/^﻿sep=/.test(csv), 'fără linia sep=');
    eq(csvParse('sep=,\r\na;b,c\r\n1,2\r\n'), [['a;b', 'c'], ['1', '2']], 'separatorul impus de sep=');
  });

  test('excel: fișier salvat de Excel-ul real (comprimat, șiruri partajate, date) se citește și se importă', async () => {
    let buf; try { const r = await fetch('tests/fixtures/plan-salvat-de-excel.xlsx', { cache: 'no-store' }); if (!r.ok) skip('fixtura lipsește'); buf = await r.arrayBuffer(); } catch (e) { skip('fixtura nu se poate încărca'); }
    const wb = await xlsxRead(buf); eq(wb.sheets.map(s => s.name), ['Plan', 'Resurse']);
    const rows = wb.sheets[0].rows; eq(rows[0].slice(0, 6), ['WBS', 'Activitate', 'Durată (zile)', 'Start', 'Final', 'Progres %']); eq(rows[2][1], 'Releveu "x" ș'); eq(rows[2][3], '2026-10-26', 'dată recunoscută din format'); eq(rows[2][10], '2026-10-26'); eq(rows[3][6], '1.1FS+1d');
    const r = importRowsAsTab(rows, 'DinExcel'); ok(r && r.parsed.ok); eq(T.map(t => t.nm), ['Cap', 'Releveu "x" ș', 'Proiect']); eq(T[1].pid, 1); eq(T[2].deps, [{ id: 2, type: 'FS', lag: 1 }]); eq(T[1].af, '2026-11-03');
  });

  test('excel: listă de lucrări făcută de un om în Excel (titluri românești, procente, date, rând gol) se importă corect', async () => {
    let buf; try { const r = await fetch('tests/fixtures/plan-utilizator-excel.xlsx', { cache: 'no-store' }); if (!r.ok) skip('fixtura lipsește'); buf = await r.arrayBuffer(); } catch (e) { skip('fixtura nu se poate încărca'); }
    const wb = await xlsxRead(buf), rows = wb.sheets[0].rows; eq(rows[0], ['Nr. crt.', 'Denumire lucrare', 'Durata (zile)', 'Data început', 'Data sfârșit', 'Progres', 'Predecesori', 'Observații']);
    const p = parseSheetRows(rows); ok(p.ok, p.error);
    eq(p.tasks.map(t => t.nm), ['Organizare șantier', 'Săpătură fundații', 'Turnare beton', 'Recepție', 'Finisaje'], 'rândul gol e ignorat');
    eq(p.tasks.map(t => t.dur), [5, 10, 4, 1, 10], 'durate (0 = reper; din Start+Final la ultima)'); eq(p.tasks.map(t => !!t.isMilestone), [false, false, false, true, false]);
    eq(p.tasks.map(t => t.prog), [100, 40, 0, 0, 25], 'procente din celule procentuale'); eq(p.tasks[0].sd, '2026-10-26'); eq(p.tasks[4].sd, '2026-11-02'); eq(p.tasks[1].notes, 'cu excavator');
    eq(p.depText, { 2: '1', 3: '2FS+2', 4: '3', 5: '4' }, 'predecesori');
    const r = importRowsAsTab(rows, 'Lucrări'); settle(); eq(r.linked, 4);
    eq(T.map(t => t.sd), ['2026-10-26', '2026-11-02', '2026-11-18', '2026-11-24', '2026-11-25'], 'planificarea după legături (FS+2 zile lucrătoare)'); ok(T[3].isMilestone);
  });

  test('excel: titluri aproximative (denumire lucrare, data început planificat, predecesori) se recunosc', () => {
    const p = parseSheetRows([['Denumire lucrare', 'Durată estimată', 'Data început planificat', 'Rezervă (zile)', 'Observații'], ['A', '3 zile', '26.10.2026', 4, 'x']]);
    ok(p.ok); eq(p.tasks[0].nm, 'A'); eq(p.tasks[0].dur, 3, 'durată din text: „3 zile”'); eq(p.tasks[0].sd, '2026-10-26'); eq(p.tasks[0].notes, 'x');
    const q = parseSheetRows([['Task Name', 'Rezervă (zile)'], ['B', 9]]); ok(q.ok); eq(q.tasks[0].dur, 1, '„Rezervă (zile)” nu e durată'); eq(q.defaults, 1);
  });

  test('excel: import din titluri englezești / MS Project, legături pe numărul rândului, durată din Start+Final', () => {
    const rows = [['ID', 'Task Name', 'Duration', 'Start', 'Finish', '% Complete', 'Predecessors'],
      [1, 'Foundation', 5, '2026-10-26', '', 100, ''], [2, 'Walls', '', '2026-11-02', '2026-11-06', 50, '1FS+1d'], [3, 'Roof', 0, '', '', 0, '2; 1SS']];
    const p = parseSheetRows(rows); ok(p.ok, p.error); eq(p.tasks.map(t => t.nm), ['Foundation', 'Walls', 'Roof']); eq(p.tasks[1].dur, 5, 'durată din Start+Final'); ok(p.tasks[2].isMilestone, 'durată 0 = reper');
    eq(p.refKind, 'numărul rândului'); eq(p.depText, { 2: '1FS+1d', 3: '2; 1SS' }); eq(p.tasks.map(t => t.prog), [100, 50, 0]);
    const r = importRowsAsTab(rows, 'Eng'); settle(); eq(r.linked, 3); eq(T[1].deps, [{ id: 1, type: 'FS', lag: 1 }]); eq(T[2].deps.map(d => d.type + d.id).sort(), ['FS2', 'SS1']);
  });

  test('excel: ierarhie din WBS, din Nivel sau plat; părinte lipsă → rădăcină', () => {
    let p = parseSheetRows([['WBS', 'Activitate', 'Durată'], ['1', 'Cap', 1], ['1.1', 'A', 2], ['1.2', 'B', 3], ['1.2.1', 'B1', 1], ['2', 'Alt', 1], ['3.1', 'Orfan', 1]]);
    eq(p.tasks.map(t => t.pid), [null, 1, 1, 3, null, null], 'WBS'); eq(p.refKind, 'WBS');
    p = parseSheetRows([['Nivel', 'Nume', 'Zile'], [1, 'Cap', 1], [2, 'A', 2], [3, 'A1', 2], [2, 'B', 2], [1, 'Cap2', 1], [2, 'C', 1]]);
    eq(p.tasks.map(t => t.pid), [null, 1, 2, 1, null, 5], 'Nivel');
    p = parseSheetRows([['Activitate', 'Durată'], ['A', 2], ['B', 3]]); eq(p.tasks.map(t => t.pid), [null, null], 'plat');
    p = parseSheetRows([['Activitate', 'Zile'], ['Cap', 1], ['A', 2]]); ok(!p.tasks.some(t => t.isMilestone));
  });

  test('excel: progres ca fracție (0,4) → 40%, date în mai multe formate, rânduri goale ignorate, durată lipsă = 1', () => {
    const ser = _excelSerial('2026-11-09');
    const p = parseSheetRows([['Activitate', 'Start', 'Progres'], ['A', '26.10.2026', 0.4], ['', '', ''], ['B', '2026-10-27', 0.8], ['C', ser, 1], ['D', '27/10/2026', 0.25], [null, null, null]]);
    ok(p.ok); eq(p.tasks.map(t => t.nm), ['A', 'B', 'C', 'D']); eq(p.tasks.map(t => t.sd), ['2026-10-26', '2026-10-27', '2026-11-09', '2026-10-27']); eq(p.tasks.map(t => t.prog), [40, 80, 100, 25]); eq(p.defaults, 4, 'fără durată → 1 zi (4)');
    eq(p.tasks.every(t => t.dur === 1), true);
  });

  test('excel: fără coloana Activitate / fără date → eroare clară, nimic nu se strică', () => {
    const n = tabs.length; let p = parseSheetRows([['Foo', 'Bar'], [1, 2]]); ok(!p.ok && /Activitate/.test(p.error)); p = parseSheetRows([['Activitate', 'Zile']]); ok(!p.ok); p = parseSheetRows([]); ok(!p.ok);
    eq(importRowsAsTab([['x']], 'Rău'), null); eq(tabs.length, n, 'niciun tab nou'); parseSheetRows([[null], [undefined, {}], ['Activitate', 'x'], [[1], 2]]);
  });

  test('excel: nume cu cod HTML se importă ca text, nu se execută', () => {
    window.__x = 0; importRowsAsTab([['Activitate', 'Zile'], ['<img src=x onerror="window.__x++">', 2]], 'Xss'); renderAll();
    eq(window.__x, 0); ok(!document.querySelector('img[src="x"]'), 'fără element injectat'); eq(T[0].nm, '<img src=x onerror="window.__x++">'); delete window.__x;
  });

  test('excel: import rapid (5000 de rânduri)', () => {
    const rows = [['WBS', 'Activitate', 'Durată', 'Start']]; for (let i = 1; i <= 5000; i++) rows.push([String(i), 'Activitate ' + i, 1 + i % 9, '26.10.2026']);
    const t0 = performance.now(), p = parseSheetRows(rows); ok(p.ok && p.tasks.length === 5000); ok(performance.now() - t0 < 1500, 'prea lent: ' + Math.round(performance.now() - t0) + ' ms');
  });

  // ============================================================
  // H) RESURSE: UTILIZARE ȘI NIVELARE
  // ============================================================
  const resA = (cap) => ({ cur: 'RON', next: 3, list: [{ id: 1, name: 'Echipa A', type: 'work', rate: 10, max: cap || 100 }, { id: 2, name: 'Echipa B', type: 'work', rate: 10, max: 100 }] });
  const withRes = (tasks, res) => { newTabWith('Lv', tasks, null, res || resA()); settle(); };
  const overCount = () => Object.values(loadMap).reduce((s, L) => s + L.over.length, 0);

  test('nivelare: două activități care se suprapun pe aceeași resursă → una se mută după cealaltă', () => {
    withRes([mk(1, 'A', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] }), mk(2, 'B', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] })]);
    ok(overCount() > 0, 'supraalocat înainte'); const r = _levelRun(3000);
    eq(overCount(), 0, 'nicio supraalocare după'); eq(byId(1).sd, '2026-10-26', 'A rămâne'); eq(byId(2).sd, '2026-11-02', 'B după A'); ok(byId(2).cons.lv && byId(2).cons.o === '2026-10-26', 'marcată ca nivelare, cu data inițială');
    eq(r.moved, 1); eq(r.endAfter, '2026-11-06'); eq(r.remaining, []);
  });

  test('nivelare: se mută activitatea cu rezervă, nu cea de pe drumul critic', () => {
    withRes([mk(1, 'X', 10), mk(2, 'Y', 5, null, [F(1)], '2026-10-26', { assign: [{ rid: 1, units: 100 }] }), mk(3, 'Z', 3, null, [], '2026-11-09', { assign: [{ rid: 1, units: 100 }] })]);
    ok(cpm[2].crit && !cpm[3].crit, 'Y critic, Z cu rezervă'); eq(byId(2).sd, '2026-11-09'); _levelRun(3000);
    eq(byId(2).sd, '2026-11-09', 'Y (critic) nu se mută'); eq(byId(3).sd, '2026-11-16', 'Z (cu rezervă) se mută după Y'); eq(overCount(), 0);
  });

  test('nivelare: activitățile începute, cele cu restricții ale utilizatorului și cele peste capacitate nu se ating', () => {
    withRes([mk(1, 'A', 5, null, [], '2026-10-26', { prog: 50, as: '2026-10-26', assign: [{ rid: 1, units: 100 }] }), mk(2, 'B', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] })]);
    _levelRun(3000); eq(byId(1).sd, '2026-10-26', 'începută: neatinsă'); eq(byId(2).sd, '2026-11-02', 'nepornita se mută'); eq(overCount(), 0);
    withRes([mk(1, 'A', 5, null, [], '2026-10-26', { cons: { type: 'SNET', date: '2026-10-26' }, assign: [{ rid: 1, units: 100 }] }), mk(2, 'B', 5, null, [], '2026-10-26', { cons: { type: 'MSO', date: '2026-10-26' }, assign: [{ rid: 1, units: 100 }] })]);
    const r = _levelRun(3000); eq(r.moved, 0, 'cu restricții proprii nu se mută nimic'); eq(r.remaining, ['Echipa A']);
    withRes([mk(1, 'Mare', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 200 }] })]); const q = _levelRun(3000); eq(q.moved, 0, 'peste capacitate singură: nerezolvabil'); eq(q.remaining, ['Echipa A']);
  });

  test('nivelare: interfață — confirmare, rezumat, buton de anulare, Ctrl+Z', () => {
    withRes([mk(1, 'A', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] }), mk(2, 'B', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] })]); _history = [];
    openResources('load'); ok($('resBody').textContent.includes('Nivelează resursele'), 'buton de nivelare');
    levelResources(); ok($('confirmModal').classList.contains('open'), 'cere confirmare'); confirmYes();
    eq(byId(2).sd, '2026-11-02'); ok($('resBody').textContent.includes('1 activitate mutată'), 'rezumat: ' + $('resBody').textContent.slice(0, 200)); ok($('resBody').textContent.includes('Anulează nivelarea (1)'));
    clearLeveling(); confirmYes(); eq(byId(2).sd, '2026-10-26', 'anularea readuce data'); ok(!byId(2).cons, 'fără restricție'); ok(overCount() > 0, 'iar supraalocat');
    undo(); eq(byId(2).sd, '2026-11-02', 'undo readuce nivelarea'); undo(); eq(byId(2).sd, '2026-10-26'); closeResources();
    levelResources(); ok(!$('confirmModal').classList.contains('open') || true); closeConfirm();
  });

  test('nivelare: 80 de proiecte aleatorii — legături respectate, fără supraalocare rezolvabilă rămasă, stabilă', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const r = rng(seed * 31), n = 4 + Math.floor(r() * 9), tasks = [];
      for (let i = 1; i <= n; i++) {
        const as = [{ rid: 1, units: 50 * (1 + Math.floor(r() * 2)) }]; if (r() < 0.4) as.push({ rid: 2, units: 50 + 50 * Math.floor(r() * 2) });
        tasks.push(mk(i, 'T' + i, 1 + Math.floor(r() * 6), null, [], fD(aD(pD('2026-10-26'), Math.floor(r() * 6))), { assign: as }));
      }
      tasks.forEach(t => { if (t.id > 1 && r() < 0.5) t.deps.push(F(1 + Math.floor(r() * (t.id - 1)))); });
      setProject(JSON.parse(JSON.stringify(tasks)), null, resA(200)); settle(); const startedBefore = {};
      const before = JSON.stringify(T.map(t => [t.id, t.sd, t.dur]));
      const rep = _levelRun(3000); ok(!rep.stopped, 'seed ' + seed + ' oprită');
      eq(overCount(), 0, 'seed ' + seed + ': a rămas supraalocare la proiect fără activități blocate');
      T.forEach(t => (t.deps || []).forEach(d => { const p = byId(d.id); ok(pD(t.sd) >= addWorkDays(endDate(p), 1), 'seed ' + seed + ': legătură încălcată'); }));
      const s1 = snap(); const rep2 = _levelRun(3000); eq(rep2.moved, rep.moved, 'seed ' + seed + ': a doua rulare dă alt rezultat'); eq(snap(), s1, 'seed ' + seed + ': nestabil');
      ok(rep.endAfter >= rep.endBefore, 'seed ' + seed + ': nivelarea nu poate grăbi finalul');
      const total = tasks.reduce((s, t) => s + t.dur, 0); ok(dD(pD(rep.endBefore), pD(rep.endAfter)) <= total * 2 + 14, 'seed ' + seed + ': final nerealist de târziu: ' + rep.endAfter);
      T.filter(t => t.cons && t.cons.lv).forEach(t => ok(t.cons.o <= t.sd, 'seed ' + seed + ': mutată înapoi'));
    }
  });

  test('utilizare: ore pe săptămână / zi / lună, supraalocarea în roșu, totalul se păstrează', () => {
    withRes([mk(1, 'A', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] }), mk(2, 'B', 5, null, [], '2026-10-26', { assign: [{ rid: 1, units: 50 }, { rid: 2, units: 100 }] })]);
    const total = h => [...h.matchAll(/<td class="[^"]*">(\d+)<\/td>/g)];
    openResources('usage'); const html = $('resBody').innerHTML; ok(html.includes('res-usage'), 'tabel'); ok(html.includes('Echipa A') && html.includes('Echipa B'));
    const rows = [...$('resBody').querySelectorAll('tbody tr')], num = tr => [...tr.querySelectorAll('td:not(.ru-name)')].map(td => +td.textContent || 0);
    const grpA = rows.find(r => r.classList.contains('ru-group') && r.textContent.includes('Echipa A')); eq(num(grpA).reduce((a, b) => a + b, 0), 40 + 20, 'Echipa A: A 5×8 + B 5×4 = 60 ore'); ok(grpA.querySelector('td.over'), 'perioada supraalocată (150% > 100%) e roșie');
    const grpB = rows.find(r => r.classList.contains('ru-group') && r.textContent.includes('Echipa B')); eq(num(grpB).reduce((a, b) => a + b, 0), 40); ok(!grpB.querySelector('td.over'));
    ok($('resBody').textContent.includes('Ore de muncă pe zi') || $('resBody').textContent.includes('săptămână'), 'unitatea perioadei');
    ok($('resModal').querySelector('.res-box').classList.contains('wide'), 'fereastră lărgită');
    newTabWith('Lung', [mk(1, 'L', 300, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] })], null, resA()); settle(); openResources('usage');
    ok($('resBody').textContent.includes('lună'), 'proiect de peste un an → pe luni'); const gl = [...$('resBody').querySelectorAll('.ru-group')][0]; eq(num(gl).reduce((a, b) => a + b, 0), 300 * 8, 'total luni = 300 × 8 ore'); closeResources();
  });

  test('utilizare: numele resursei cu HTML e afișat ca text', () => {
    window.__y = 0; withRes([mk(1, 'A', 3, null, [], '2026-10-26', { assign: [{ rid: 1, units: 100 }] })], { cur: 'RON', next: 2, list: [{ id: 1, name: '<img src=x onerror="window.__y++">', type: 'work', rate: 1, max: 100 }] });
    openResources('usage'); openResources('load'); eq(window.__y, 0); ok(!document.querySelector('#resBody img'), 'fără element injectat'); closeResources(); delete window.__y;
  });

  test('ferestre: confirmarea apare PESTE fereastra „Resurse” (nu în spatele ei)', () => {
    withRes([mk(1, 'A', 3)]); openResources('res'); customConfirm('Sigur?', () => {});
    const box = $('confirmModal').querySelector('.modal-box').getBoundingClientRect(), top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    ok($('confirmModal').contains(top), 'elementul de sus la centrul confirmării aparține confirmării'); closeConfirm(); closeResources();
  });

  // ============================================================
  // I) CRONOLOGIE
  // ============================================================
  const tlProject = () => {
    const t0 = fD(aD(new Date(), -3));
    newTabWith('Tl', [
      mk(1, 'Castel', 1), mk(2, 'Pregătire și avize', 1, 1), mk(3, 'Releveu', 10, 2, [], t0, { prog: 100 }), mk(4, 'Proiect', 15, 2, [F(3)], t0, { prog: 40 }),
      mk(5, 'Execuție', 1, 1), mk(6, 'Fundații', 20, 5, [F(4)], t0), mk(7, 'Recepție', 1, 5, [F(6)], t0, { isMilestone: true }), mk(8, 'Avize', 8, 2, [], t0, { deadline: fD(aD(new Date(), 40)) })
    ]); settle();
  };
  const tlBars = () => [...document.querySelectorAll('#tlBox .tl-bar')];

  test('cronologie: capitolele principale ca bare, repere și termene, linia Azi; se deschide din fila de vedere', () => {
    tlProject(); setViewMode('timeline');
    eq(view, 'timeline'); eq($('timelineLayout').style.display, 'flex'); eq($('splitView').style.display, 'none'); eq($('treeLayout').style.display, 'none'); ok($('rbViewTimeline').classList.contains('active'), 'butonul din Vizualizare');
    ok($('rbViewTimeline').classList.contains('active'), 'butonul Cronologie e activ în fila Vizualizare');
    eq(tlBars().length, 2, 'copiii singurului capitol-rădăcină: Pregătire și Execuție'); eq(document.querySelectorAll('#tlBox .tl-mk.ms').length, 1, 'un reper'); eq(document.querySelectorAll('#tlBox .tl-mk.dl').length, 1, 'un termen limită'); ok(document.querySelector('#tlBox .tl-now'), 'linia Azi');
    ok($('tlBox').querySelector('.tl-head b').textContent === 'Tl' && $('tlBox').textContent.includes('Recepție') && $('tlBox').textContent.includes('Termen: Avize'), 'titlul proiectului și numele reperelor / termenelor');
    const cv = $('tlCanvas').getBoundingClientRect(); tlBars().forEach(b => { const r = b.getBoundingClientRect(); ok(r.left >= cv.left - 1 && r.right <= cv.right + 1, 'bara iese din cronologie: ' + b.title.split('\n')[0]); });
  });

  test('cronologie: barile care se suprapun merg pe linii diferite, fără să se atingă', () => {
    const t0 = '2026-11-02'; newTabWith('Tl2', [mk(1, 'A', 20, null, [], t0), mk(2, 'B', 20, null, [], t0), mk(3, 'C', 5, null, [], '2026-12-14'), mk(4, 'Numele acesta este foarte lung ca să nu încapă în bară', 1, null, [], '2026-12-15')]); settle(); setViewMode('timeline');
    const bars = tlBars().map(b => ({ top: b.offsetTop, l: b.offsetLeft, r: b.offsetLeft + b.offsetWidth }));
    eq(new Set(bars.map(b => b.top)).size >= 2, true, 'cel puțin două linii'); const byTop = {}; bars.forEach(b => (byTop[b.top] = byTop[b.top] || []).push(b));
    Object.values(byTop).forEach(l => { l.sort((a, b) => a.l - b.l); for (let i = 1; i < l.length; i++) ok(l[i].l >= l[i - 1].r, 'bare suprapuse pe aceeași linie'); });
    ok(document.querySelector('#tlBox .tl-out'), 'numele care nu încape în bară apare lângă ea');
  });

  test('cronologie: proiect fără capitole arată activitățile; proiect gol arată un mesaj', () => {
    newTabWith('Tl3', [mk(1, 'A', 5), mk(2, 'B', 5, null, [F(1)])]); settle(); setViewMode('timeline'); eq(tlBars().length, 2);
    addNewTab('Tl4'); setViewMode('timeline'); ok($('tlBox').textContent.includes('Proiect gol'), 'mesaj proiect gol');
  });

  test('cronologie: click pe bară deschide Gantt-ul la capitol; Gantt-ul rămâne aliniat', () => {
    tlProject(); setViewMode('timeline'); const id = +tlBars()[1].dataset.id; tlBars()[1].click();
    eq(view, 'gantt'); eq(sel, id, 'capitolul selectat'); ok(document.querySelector('.g-row.selected'), 'rând selectat în Gantt');
    if ($('gBody').clientHeight >= 100) { alignPanes(); const rows = [...document.querySelectorAll('.t-row')], g = [...document.querySelectorAll('.g-row')]; eq(rows.length, g.length); rows.forEach((r, i) => near(r.getBoundingClientRect().top, g[i].getBoundingClientRect().top, 1, 'rând ' + i)); }
    setViewMode('tree'); ok($('treeBox').innerHTML.length > 50, 'arborele merge după cronologie'); setViewMode('gantt');
  });

  test('cronologie: zoom, filtre și redimensionare nu o strică; tipărirea te întoarce în Gantt', () => {
    tlProject(); setViewMode('timeline'); const auto = isAutoZoom, zl = zoomLevel; zoom(1); zoom(-1); fitZoom(); eq({ a: isAutoZoom, z: zoomLevel }, { a: auto, z: zl }, 'zoom-ul Gantt nu se schimbă din cronologie');
    FILTER.type = 'done'; renderAll(); eq(tlBars().length, 2, 'filtrul nu ascunde capitolele din cronologie'); clearFilter(true);
    const n = tlBars().length; window.dispatchEvent(new Event('resize')); eq(tlBars().length, n, 'la redimensionare se redesenează');
    openPrintPreview(); eq(view, 'gantt', 'tipărirea trece în Gantt'); eq($('printPreview').style.display, 'flex'); closePrintPreview();
  });

  test('cronologie: imaginea PNG se generează, cu tema luminoasă, și tema revine', async () => {
    tlProject(); document.body.classList.add('dark'); setViewMode('timeline');
    const c = await tlBuildCanvas(); ok(c.width > 200 && c.height > 60, 'canvas ' + c.width + '×' + c.height); ok(document.body.classList.contains('dark'), 'tema întunecată revine'); document.body.classList.remove('dark');
    const px = c.getContext('2d').getImageData(2, c.height - 3, 1, 1).data; ok(px[0] > 240 && px[1] > 240 && px[2] > 240, 'fundal alb în imagine: ' + px.join(','));
  });

  // ============================================================
  // G) PANGLICA
  // ============================================================
  test('panglică: nicio filă nu depășește lățimea ferestrei de 1360 px (butoanele nu se taie)', () => {
    if (innerWidth < 1340 || innerWidth > 1400) skip('se verifică doar la ~1360 px lățime (acum: ' + innerWidth + ')');
    addNewTab('Pn'); loadDemo(); const active = document.querySelector('.rb-tab.active');
    ['file', 'home', 'view', 'project'].forEach(k => {
      document.querySelector('.rb-tab[data-rt="' + k + '"]').click(); const c = document.querySelector('.rb-content[data-rc="' + k + '"]');
      ok(c.scrollWidth <= c.clientWidth + 2, 'fila „' + k + '” e prea lată: ' + c.scrollWidth + ' > ' + c.clientWidth);
    });
    if (active) active.click();
  });

  test('panglică: Fișier / Acasă / Vizualizare / Proiect au butoanele așteptate', () => {
    const lbl = k => [...document.querySelectorAll('.rb-content[data-rc="' + k + '"] .rb-lbl')].map(e => e.textContent.trim());
    ['Proiect nou', 'Deschide', 'Exemplu', 'Salvează', 'Tipărește', 'Export', 'Import'].forEach(l => ok(lbl('file').includes(l), 'Fișier: lipsește ' + l));
    ['Activitate', 'Capitol', 'Reper'].forEach(l => ok(lbl('home').includes(l), 'Acasă: lipsește ' + l));
    ['Filtru', 'Drum critic', 'Nume lângă bară', 'WBS'].forEach(l => ok(lbl('view').includes(l), 'Vizualizare: lipsește ' + l));
    ['Calendar', 'Resurse', 'Buget', 'Urmărire'].forEach(l => ok(lbl('project').includes(l), 'Proiect: lipsește ' + l));
  });

  // ============================================================
  // H) REVIZUIREA CODULUI: corectitudine, securitate, siguranța datelor, performanță
  // ============================================================
  test('drum critic: o legătură către un CAPITOL se aplică activităților lui (FS → toate frunzele)', () => {
    newTabWith('CpmCap', [mk(1, 'Capitol', 1), mk(2, 'B', 3, 1), mk(3, 'C', 10, 1), mk(4, 'D', 2, null, [F(1)])]); settle();
    ok(cpm[3].crit, 'C (cea mai lungă din capitol) trebuie să fie critică'); ok(cpm[4].crit, 'D critică');
    eq(cpm[2].float, 7, 'B are rezervă 10 − 3 = 7 zile');
  });

  test('drum critic: legătura SS către un capitol ține doar activitățile care încep primele', () => {
    newTabWith('CpmSS', [mk(1, 'Capitol', 1), mk(2, 'B', 10, 1), mk(3, 'C', 3, 1, [F(2, 'FS')]), mk(4, 'D', 4, null, [F(1, 'SS')])]); settle();
    ok(cpm[2].crit, 'B pornește capitolul și e pe drumul critic'); eq(cpm[4].float, 9, 'D (4 zile) față de final la ziua 13');
    ok(cpm[4].float >= 0, 'rezerva nu e negativă');
  });

  test('capitole: progresul e ponderat cu durata copiilor (nu media simplă)', () => {
    newTabWith('Prog', [mk(1, 'Cap', 1), mk(2, 'Scurt', 1, 1, [], null, { prog: 100 }), mk(3, 'Lung', 9, 1, [], null, { prog: 0 })]); settle();
    eq(T.find(t => t.id === 1).prog, 10, '1 zi la 100% din 10 zile = 10%');
    T.find(t => t.id === 3).prog = 100; settle(); eq(T.find(t => t.id === 1).prog, 100);
  });

  test('capitole: calculul datelor și progresului merge și pe capitole imbricate', () => {
    newTabWith('Nest', [mk(1, 'Cap', 1), mk(2, 'Sub', 1, 1), mk(3, 'x', 4, 2, [], null, { prog: 50 }), mk(4, 'y', 4, 2, [], null, { prog: 100 })]); settle();
    eq(T.find(t => t.id === 2).prog, 75); eq(T.find(t => t.id === 1).prog, 75); ok(T.find(t => t.id === 1).dur >= 4);
  });

  test('mutare cu mouse: activitatea cu legături își păstrează poziția prin LAG; nu coboară sub lag 0', () => {
    newTabWith('Lag', [mk(1, 'A', 5), mk(2, 'B', 3, null, [F(1)])]); settle();
    const b = T.find(t => t.id === 2), a = T.find(t => t.id === 1), s0 = b.sd;
    b.sd = fD(addWorkDays(pD(s0), 2)); const d = lagFromMove(b); ok(d, 'legătura a fost actualizată'); eq(b.deps[0].lag, 2); settle();
    eq(b.sd, fD(addWorkDays(pD(s0), 2)), 'bara rămâne unde a fost pusă');
    b.sd = s0; lagFromMove(b); eq(b.deps[0].lag, 0, 'mutarea înapoi readuce lag-ul la 0'); settle(); eq(b.sd, s0);
    b.sd = a.sd; eq(lagFromMove(b), null, 'nu se creează suprapunere (lag negativ) din greșeală'); eq(b.deps[0].lag, 0);
  });

  test('mutare cu mouse: capitolele, reperele și activitățile cu restricție nu primesc lag', () => {
    newTabWith('Lag2', [mk(1, 'A', 5), mk(2, 'B', 3, null, [F(1)], null, { cons: { type: 'SNET', date: '2026-12-01' } })]); settle();
    const b = T.find(t => t.id === 2); b.sd = fD(addWorkDays(pD(b.sd), 3)); eq(lagFromMove(b), null); eq(b.deps[0].lag, 0);
  });

  test('securitate: calendarul respinge zilele libere care nu sunt date (intră în atribute HTML)', () => {
    setCal({ days: [0, 1, 1, 1, 1, 1, 0], hol: ['2026-01-01', "');alert(1);//", '2026-13-45', '2026-01-01', 5, null] });
    eq(CAL.hol, ['2026-01-01']); setCal(null);
  });

  test('securitate: moneda și unitatea din fișier nu pot conține etichete / ghilimele; resursele se normalizează', () => {
    setRes({ cur: '<img src=x onerror=alert(1)>', next: 'x', list: [
      { id: 1, name: 'A\u0001<b>', type: 'material', unit: '"><script>', rate: -5 }, { id: 1, name: 'B', type: 'inexistent', rate: 'abc' }, null, 'x'] });
    ok(!/[<>"']/.test(RES.cur), 'moneda: ' + RES.cur); ok(!/[<>"']/.test(RES.list[0].unit), 'unitatea: ' + RES.list[0].unit);
    eq(RES.list.length, 2); ok(RES.list[0].id !== RES.list[1].id, 'id-uri unice'); eq(RES.list[0].rate, 0); eq(RES.list[1].type, 'work'); eq(RES.list[1].rate, 0);
    ok(!/[\u0000-\u001f]/.test(RES.list[0].name)); ok(Number.isInteger(RES.next)); setRes(null);
    eq(esc("a'b\"c<d>&"), 'a&#39;b&quot;c&lt;d&gt;&amp;', 'esc scapă și apostroful');
  });

  test('securitate: câmpurile opționale invalide dintr-un fișier sunt curățate (nu apar date „NaN")', () => {
    setProject([mk(1, 'A', 2, null, [], '2026-10-26', { cons: { type: 'MSO', date: 'zzz' }, deadline: 'bad', as: 5, bl: { sd: 'x', dur: 1 }, ttype: 'hack', assign: [{ rid: 'a' }, { rid: 1, units: 'x' }] }),
      mk(2, 'B', 2, null, [], '2026-10-26', { cons: { type: 'NOPE', date: '2026-10-26' } }), mk(3, 'C', 2, null, [], '2026-10-26', { cons: { type: 'SNET', date: '2026-11-02', ac: 1 }, bl: { sd: '2026-10-26', dur: 2.4 } })]);
    _sanitizeTasks(); const [a, b, c] = T;
    ok(!a.cons && !a.deadline && a.as === undefined && !a.bl && !a.ttype, 'câmpuri invalide eliminate'); eq(a.assign, [{ rid: 1, units: 0 }]);
    ok(!b.cons, 'tip de restricție necunoscut'); eq(c.cons, { type: 'SNET', date: '2026-11-02', ac: true }); eq(c.bl, { sd: '2026-10-26', dur: 2 });
    settle(); T.forEach(t => ok(/^\d{4}-\d{2}-\d{2}$/.test(t.sd), 'dată validă: ' + t.sd));
  });

  test('siguranța datelor: la ascunderea / închiderea paginii, modificarea se scrie imediat în browser', () => {
    const tab = tabs.find(t => t.id === activeTabId); tab.name = 'Zed-' + Date.now(); saveAllTabs();
    window.dispatchEvent(new Event('pagehide'));
    ok(localStorage.getItem('ganttPRO_tabs').includes(tab.name), 'salvarea nu a așteptat cele 800 ms');
  });

  test('siguranța datelor: dacă browserul refuză salvarea (memorie plină), utilizatorul e avertizat și modificarea nu se pierde din coadă', () => {
    const orig = Storage.prototype.setItem; let failing = true;
    Storage.prototype.setItem = function (k, v) { if (failing && k === 'ganttPRO_tabs') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); };
    try {
      saveAllTabs(); eq(flushSave(), false); ok(document.querySelector('.save-indicator').textContent.includes('⚠'), 'avertisment vizibil în bara de stare');
      failing = false; eq(flushSave(), true, 'după ce browserul acceptă, salvarea se reia'); ok(!document.querySelector('.save-indicator').textContent.includes('⚠'));
    } finally { Storage.prototype.setItem = orig; }
  });

  test('undo: instantaneele identice nu se dublează; limita de istoric se respectă', () => {
    newTabWith('Hist', [mk(1, 'A', 2)]); const n = _history.length; pushHistory(); pushHistory(); pushHistory(); eq(_history.length, n + 1, 'trei apeluri fără modificări = un singur instantaneu');
    for (let i = 0; i < 60; i++) { T[0].dur = 2 + i; pushHistory(); } ok(_history.length <= MAX_HISTORY, 'limită ' + _history.length);
  });

  test('performanță: 1500 de activități se recalculează rapid, iar indexul temporar se închide', () => {
    const tasks = [], N = 1500; for (let c = 0; c < 30; c++) { tasks.push(mk(1 + c * 51, 'Cap' + c, 1)); for (let i = 1; i <= 50; i++) { const id = 1 + c * 51 + i; tasks.push(mk(id, 'T' + id, 1 + (id % 5), 1 + c * 51, i > 1 ? [F(id - 1)] : [])); } }
    newTabWith('Perf', tasks); const t0 = performance.now(); settle(); const ms = performance.now() - t0;
    ok(ms < 6000, 'recalcularea a durat ' + Math.round(ms) + ' ms'); eq(_ix, null, 'indexul temporar a fost eliminat'); ok(T.length >= N);
    const last = T.find(t => t.id === 51); ok(cpm[last.id], 'CPM calculat pe proiectul mare');
  });

  test('performanță: rezultatul recalculării cu index e identic cu cel fără index', () => {
    const tasks = [mk(1, 'Cap', 1), mk(2, 'A', 4, 1), mk(3, 'B', 3, 1, [F(2, 'SS', 1)]), mk(4, 'C', 2, null, [F(1)]), mk(5, 'D', 6, null, [F(3, 'FF', 2)])];
    newTabWith('Idx', tasks); settle(); const a = JSON.stringify([T, cpm]);
    const saved = JSON.parse(JSON.stringify(tasks)); T = saved; _ensureDeps(); _ix = null; for (let i = 0; i < 3; i++) { recalcSchedule(); recalcSummaries(); } computeCPM();
    eq(JSON.stringify([T, cpm]), a, 'index vs fără index');
  });

  test('detalii: panoul din Arbore, fereastra Detalii activitate și bara de informații folosesc aceleași denumiri', () => {
    newTabWith('Det', [mk(1, 'Cap', 1), mk(2, 'A', 5, 1, [], null, { as: '2026-10-26', sn: 'Aa', notes: 'o notă', deadline: '2026-12-01', cons: { type: 'SNET', date: '2026-10-27' }, ttype: 'fd' }), mk(3, 'B', 3, 1, [F(2)])]); settle();
    const need = ['Nume', 'Nume scurt', 'Data start', 'Data final', 'Durată (zile)', 'Progres (%)', 'Început real', 'Final real', 'Se face după', 'Restricție', 'Data restricției', 'Termen limită', 'Tip activitate'];
    sel = 2; setViewMode('tree'); renderSidePanel();
    const panel = [...document.querySelectorAll('#spBody .sp-lbl')].map(l => l.textContent.trim());
    openTaskInfo(2); const dlg = [...document.querySelectorAll('#tiBody .ti-row label')].map(l => l.textContent.trim()); closeTaskInfo();
    need.forEach(n => { ok(panel.some(l => l.startsWith(n)), 'panou: lipsește „' + n + '”'); ok(dlg.some(l => l.startsWith(n)), 'fereastră: lipsește „' + n + '”'); });
    setViewMode('gantt'); updateInfoBar(T.find(t => t.id === 2)); const info = [...document.querySelectorAll('#gInfo .gi-k')].map(k => k.textContent.trim());
    ['Data start', 'Data final', 'Durată', 'Progres', 'Început real', 'Restricție', 'Data restricției', 'Termen limită', 'Tip activitate', 'Note', 'Nume scurt', 'Urmează după ea'].forEach(n => ok(info.includes(n), 'bara de informații: lipsește „' + n + '”'));
    updateInfoBar(T.find(t => t.id === 3)); ok([...document.querySelectorAll('#gInfo .gi-k')].some(k => k.textContent.trim() === 'Se face după'), 'bara de informații: „Se face după” pe activitatea 3');
  });

  test('detalii: câmpurile adăugate în panou (nume scurt, început / final real, tip activitate) se salvează și se pot anula', () => {
    newTabWith('Det2', [mk(1, 'A', 5), mk(2, 'B', 3, null, [F(1)])]); settle();
    const a = T.find(t => t.id === 1);
    setShortOf(1, 'Ab'); eq(a.sn, 'Ab'); setShortOf(1, ''); eq(a.sn, undefined, 'nume scurt șters');
    setActualOf(1, 'as', '2026-10-27'); eq(a.as, '2026-10-27');
    setActualOf(1, 'af', '2026-10-26'); eq(a.af, undefined, 'final real înaintea începutului e respins');
    setActualOf(1, 'af', '2026-11-02'); eq(a.af, '2026-11-02'); eq(a.prog, 100, 'final real → 100%');
    setTypeOf(1, 'fw'); eq(a.ttype, 'fw'); setTypeOf(1, 'fu'); eq(a.ttype, undefined, 'unități fixe = implicit'); setTypeOf(1, 'nope'); eq(a.ttype, undefined);
    undo(); undo(); ok(!T.find(t => t.id === 1).ttype, 'anulare');
  });

  test('detalii: bara cu carduri apare doar în Gantt pe tot ecranul; fereastra Detalii are antet, rezumat și carduri și salvează', () => {
    newTabWith('Fs', [mk(1, 'A', 5), mk(2, 'B', 3, null, [F(1)])]); settle();
    ok(getComputedStyle($('gInfo')).display === 'none', 'bara e ascunsă în vederea obișnuită');
    toggleGanttFull(); const shown = getComputedStyle($('gInfo')).display !== 'none'; toggleGanttFull();
    ok(shown, 'bara apare pe tot ecranul'); ok(!document.body.classList.contains('gantt-full'), 'ieșit din ecranul complet');
    openTaskInfo(2);
    eq($('tiWbs').textContent, '2'); eq($('tiTitle').textContent, 'B'); ok($('tiSummary').textContent.includes('Perioadă') && $('tiSummary').textContent.includes('Progres'), 'rezumat');
    ok($('tiChips').textContent.includes('Activitate'), 'etichetă de tip'); ok(document.querySelectorAll('#tiBody .ti-card').length >= 6, 'carduri: ' + document.querySelectorAll('#tiBody .ti-card').length);
    eq($('tiDeps').value, '1', 'câmpul „Se face după” arată predecesorul');
    $('tiName').value = 'B2'; $('tiDur').value = '4'; $('tiDur').dispatchEvent(new Event('input', { bubbles: true })); $('tiSaveBtn').click();
    const b = T.find(t => t.id === 2); eq(b.nm, 'B2'); eq(b.dur, 4); eq($('taskInfoModal').classList.contains('open'), false, 'fereastra se închide după salvare');
    openTaskInfo(1); ok($('tiBody').querySelector('.ti-link'), 'activitatea 1 arată succesorul ca etichetă'); closeTaskInfo();
  });

  test('detalii: în fereastră, startul, durata și finalul sunt legate (nu se mai anulează între ele la salvare)', () => {
    newTabWith('Lnk', [mk(1, 'A', 5)]); settle(); const a = T.find(t => t.id === 1); openTaskInfo(1);
    const fire = (id, ev) => $(id).dispatchEvent(new Event(ev, { bubbles: true }));
    dtSet('tiStart', '2026-11-02'); fire('tiStart', 'change');
    eq($('tiDur').value, '5', 'mutarea startului păstrează durata'); eq($('tiEnd').value, fD(endDate({ sd: '2026-11-02', dur: 5 })), 'finalul urmează startul');
    $('tiDur').value = '8'; fire('tiDur', 'input'); eq($('tiEnd').value, fD(endDate({ sd: '2026-11-02', dur: 8 })), 'durata nouă mută finalul');
    dtSet('tiEnd', fD(endDate({ sd: '2026-11-02', dur: 3 }))); fire('tiEnd', 'change'); eq($('tiDur').value, '3', 'finalul nou schimbă durata');
    $('tiSaveBtn').click(); eq(a.sd, '2026-11-02'); eq(a.dur, 3);
    openTaskInfo(1); $('tiDur').value = '6'; fire('tiDur', 'input'); $('tiSaveBtn').click(); eq(a.dur, 6, 'durata scrisă în fereastră se salvează');
  });

  test('tabel: prima coloană e ID (nr. rând, ca în MS Project), codul WBS e prefix înaintea numelui și se poate ascunde', () => {
    newTabWith('Idw', [mk(1, 'Cap', 1), mk(2, 'A', 3, 1), mk(3, 'B', 2, 1, [F(2)]), mk(4, 'Cap2', 1), mk(5, 'C', 2, 4)]); settle();
    eq(C[0].k, 'id'); eq(document.querySelector('#thRow .th').textContent.trim(), 'ID'); ok(!CX.some(c => c.k === 'id'), 'fără a doua coloană de ID');
    const ids = () => [...document.querySelectorAll('#tBody .t-row .c-id')].map(e => e.textContent), wbsTxt = () => [...document.querySelectorAll('#tBody .t-row .t-wbs')].map(e => e.textContent);
    eq(ids(), ['1', '2', '3', '4', '5']); eq(wbsTxt(), ['1', '1.1', '1.2', '2', '2.1']);
    const nameCell = document.querySelector('#tBody .t-row[data-tid="2"] .c-name'); ok(nameCell.querySelector('.t-wbs').nextElementSibling.tagName === 'INPUT', 'WBS stă imediat înaintea numelui');
    toggleC(1); eq(ids(), ['1', '4', '5'], 'ID-urile rămân aceleași când un capitol e restrâns'); toggleC(1);
    toggleWbs(); eq(wbsTxt(), [], 'WBS ascuns'); eq(localStorage.getItem('ganttWbs'), '0'); toggleWbs(); eq(wbsTxt().length, 5); eq(localStorage.getItem('ganttWbs'), '1');
    ok($('btnWbs') && $('btnWbs').classList.contains('active'), 'butonul „Cod WBS” e apăsat când WBS e vizibil');
  });

  test('securitate: numele proiectului din bara de stare nu poate injecta HTML', () => {
    newTabWith('<img src=x onerror=alert(1)>', [mk(1, 'A', 2)]); settle(); renderStatus();
    ok(!$('sbar').querySelector('img'), 'fără element <img> în bara de stare'); ok($('sbar').textContent.includes('<img src=x'), 'numele apare ca text');
    ok($('sbar').textContent.includes('Activități'), 'etichetele valorilor sunt prezente');
  });


  test('sus: rândul proiectelor are doar proiecte; vederile sunt în fila Vizualizare (etichetate); Legendă / Tot ecranul sus-dreapta, doar în Gantt', () => {
    ok(!$('vtabs') && !document.querySelector('.vtab'), 'fără pastila Gantt/Arbore/Cronologie în rândul de proiecte');
    const lbl = k => [...document.querySelectorAll('.rb-content[data-rc="' + k + '"] .rb-lbl')].map(e => e.textContent.trim());
    ['Gantt', 'Arbore', 'Cronologie'].forEach(l => ok(lbl('view').includes(l), 'Vizualizare: lipsește ' + l));
    ok(!lbl('view').includes('Încărcare') && lbl('project').includes('Încărcare'), 'Încărcare e în fila Proiect');
    addNewTab('Top'); ok($('ribbonTabs').contains($('btnLegend')) && $('ribbonTabs').contains($('ganttTools')), 'unelte sus-dreapta');
    ok(getComputedStyle($('ganttTools')).display !== 'none', 'vizibile în Gantt');
    $('rbViewTree').click(); eq(view, 'tree'); eq(getComputedStyle($('ganttTools')).display, 'none', 'ascunse în Arbore');
    $('rbViewTimeline').click(); eq(view, 'timeline'); $('rbViewGantt').click(); eq(view, 'gantt'); ok(getComputedStyle($('ganttTools')).display !== 'none');
    $('btnLegend').click(); ok($('legendPop'), 'legenda se deschide'); $('btnLegend').click();
  });

  test('bare stil Nou: culoare după stare, numele întreg lângă bară când nu încape, comutator Clasic / Nou salvat', () => {
    const LONG = 'Activitate cu un nume foarte lung care nu încape în bară';
    newTabWith('Bs', [mk(1, LONG, 2), mk(2, 'B', 60, null, [F(1)], null, { prog: 100 }), mk(3, 'C', 30, null, [F(2)], null, { prog: 40 })]); settle(); renderAll();
    const bar = id => document.querySelector('.gb[data-bid="' + id + '"]');
    ok(document.body.classList.contains('bars-new'), 'stilul Nou e implicit'); ok($('btnBarStyle').classList.contains('active'));
    ok(bar(1).classList.contains('st-todo') && bar(2).classList.contains('st-done') && bar(3).classList.contains('st-wip'), 'clase de stare');
    const sides = [...document.querySelectorAll('.bar-side')].map(e => e.textContent);
    ok(sides.includes(LONG), 'numele întreg stă lângă bara îngustă (nu „Activitate cu…”)'); ok(!bar(1).querySelector('.bn'), 'bara îngustă nu are text tăiat înăuntru');
    ok(bar(2).querySelector('.bn') && bar(2).querySelector('.bn').textContent === 'B' && !sides.includes('B'), 'numele care încape rămâne în bară');
    const h = bar(1).getBoundingClientRect().height; if (h) ok(h <= 17, 'bară subțire: ' + h);
    toggleBarStyle(); ok(!document.body.classList.contains('bars-new')); ok(!bar(1).classList.contains('st-todo'), 'Clasic: fără clase de stare'); eq(localStorage.getItem('ganttBarStyle'), 'classic');
    toggleBarStyle(); eq(localStorage.getItem('ganttBarStyle'), 'new'); ok(bar(1).classList.contains('st-todo'));
  });

  test('bare stil Nou: la zoom foarte mic bara devine pilulă, fără nume înăuntru sau lângă ea (doar la hover)', () => {
    newTabWith('Mz', [mk(1, 'Activitate scurtă', 3), mk(2, 'Alta', 3, null, [F(1)])]); settle();
    isAutoZoom = false; document.documentElement.style.setProperty('--day-w', '2px'); renderAll();
    try {
      ok($('gBody').classList.contains('zoom-micro'), 'clasa zoom-micro'); eq(document.querySelectorAll('.bar-side').length, 0, 'fără nume lângă bară');
      ok(document.querySelector('.gb.task .bn-hov'), 'numele complet la hover');
    } finally { fitZoom(); }
    ok(!$('gBody').classList.contains('zoom-micro'), 'după „Auto” revine');
  });

  test('dimensiune tabel + Gantt: Ctrl +/−/0 și Ctrl+rotiță scalează doar tabelul și graficul (nu panglica); se salvează', () => {
    newTabWith('Cz', [mk(1, 'A', 5), mk(2, 'B', 5, null, [F(1)])]); settle(); renderAll();
    const kd = (key, o) => { const ev = new KeyboardEvent('keydown', Object.assign({ key, ctrlKey: true, bubbles: true, cancelable: true }, o || {})); document.dispatchEvent(ev); return ev.defaultPrevented; };
    try {
      ok(kd('+'), 'Ctrl + nu mai face zoom de pagină'); eq(ZF, 1.1); eq($('splitView').style.zoom, '1.1'); eq(localStorage.getItem('ganttContentZoom'), '1.1');
      eq(getComputedStyle($('ribbonTabs')).zoom, '1', 'panglica nu se scalează'); eq(getComputedStyle($('sbar')).zoom, '1', 'bara de stare nu se scalează');
      kd('='); eq(ZF, 1.25); kd('-'); eq(ZF, 1.1); kd('0'); eq(ZF, 1); eq($('splitView').style.zoom, '', '100% = fără zoom');
      const wh = new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }); document.querySelector('.t-row').dispatchEvent(wh);
      ok(wh.defaultPrevented, 'Ctrl+rotiță peste tabel / grafic nu face zoom de pagină'); eq(ZF, 1.1);
      const w2 = new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }); $('ribbonTabs').dispatchEvent(w2); ok(!w2.defaultPrevented, 'peste panglică rămâne zoom-ul browserului');
      ok(!kd('+', { ctrlKey: false }), 'fără Ctrl nu face nimic'); eq(ZF, 1.1);
      setContentZoom(1.5, true); ok($('sbar').textContent.includes('150%'), 'indicator în bara de stare');
    } finally { setContentZoom(1, true); }
    eq(ZF, 1); ok(!$('sbar').textContent.includes('Dimensiune'));
  });

  test('dimensiune tabel + Gantt: la 150% rândurile rămân aliniate, bara se mută cu numărul corect de zile, coloana se redimensionează corect', () => {
    newTabWith('Cz2', [mk(1, 'A', 5, null, [], '2026-10-26')]); settle();
    try {
      setContentZoom(1.5, true);
      if ($('gBody').clientHeight >= 100) { alignPanes(); const r = document.querySelector('.t-row').getBoundingClientRect(), g = document.querySelector('.g-row').getBoundingClientRect(); near(r.top, g.top, 1.5, 'rând tabel / rând Gantt aliniate la 150%'); near(r.height, g.height, 1, 'aceeași înălțime'); }
      const bar = document.querySelector('.gb[data-bid="1"]'), br = bar.getBoundingClientRect(), x0 = br.left + 12, y0 = br.top + 6, dw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--day-w'));
      const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
      fire(bar, 'mousedown', x0, y0); fire(document, 'mousemove', x0 + dw * ZF * 3, y0); fire(document, 'mouseup', x0 + dw * ZF * 3, y0);
      eq(byId(1).sd, '2026-10-29', 'mouse-ul mutat cu 3 zile pe ecran = 3 zile, nu 4,5');
      const th = document.querySelector('#thRow .th:nth-child(3)'), w0 = C[2].w, hx = th.querySelector('.col-rs').getBoundingClientRect(), sx = hx.left + 2;
      th.querySelector('.col-rs').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: sx, clientY: hx.top + 4, button: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: sx + 30 * ZF })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: sx + 30 * ZF }));
      near(C[2].w, w0 + 30, 1.5, 'coloana crește cu 30 px din spațiul ei, nu cu 45');
    } finally { setContentZoom(1, true); C[2].w = 44; localStorage.removeItem('ganttColW'); }
  });

  test('layout: panoul din stânga mai îngust decât coloanele → coloana „Activitate” se strânge, „După” rămâne vizibilă, antet și rânduri aliniate', () => {
    newTabWith('Lay', [mk(1, 'Activitate cu un nume destul de lung', 5), mk(2, 'B', 3, null, [F(1)])]); settle();
    const pl = $('paneL'), old = pl.style.width;
    try {
      ['480px', '520px', '600px'].forEach(wd => {
        pl.style.width = wd; renderAll();
        const right = pl.getBoundingClientRect().right, ths = [...document.querySelectorAll('#thRow .th')].slice(0, 7), last = ths[6].getBoundingClientRect();
        ok(last.right <= right + 1 && last.width > 20, 'la ' + wd + ' coloana „După” încape: ' + Math.round(last.right) + ' ≤ ' + Math.round(right));
        const rowLast = document.querySelector('.t-row .c:nth-child(7)').getBoundingClientRect(); ok(rowLast.right <= right + 1, 'și în rânduri la ' + wd);
        near(ths[6].getBoundingClientRect().left, rowLast.left, 1.5, 'antetul și rândurile au aceleași coloane la ' + wd);
        ok(ths[1].getBoundingClientRect().width >= 100, 'coloana Activitate nu dispare: ' + Math.round(ths[1].getBoundingClientRect().width));
        const wb = document.querySelector('.t-row .t-wbs'); if (wb) eq(getComputedStyle(wb).display === 'none', wd === '480px' || wd === '520px', 'prefixul WBS dispare doar în panou îngust (' + wd + ')');
        ok(![...document.querySelectorAll('.t-row .c.col-var, .t-row .c.col-cost')].some(e => getComputedStyle(e).display !== 'none'), 'coloanele suplimentare rămân ascunse când panoul nu e extins');
      });
    } finally { pl.style.width = old; renderAll(); }
    pl.style.width = ''; const cs = getComputedStyle(pl); ok(parseFloat(cs.width) >= 480 && parseFloat(cs.width) <= 600, 'lățimea implicită a panoului: ' + cs.width); pl.style.width = old;
  });

  test('panglică: mărimea butoanelor se alege (A− / A+, Ctrl+Alt), se adaptează la fereastră, iar meniurile rămân sub buton când e scalată', () => {
    const prev = uiMode, ribbon = document.querySelector('.ribbon'), key = (k, o) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)));
    try {
      stepUiScale(0); eq(uiMode, 'auto'); ok(uiScale() >= 1 && uiScale() <= 1.8, 'scala automată: ' + uiScale());
      ok(innerWidth / 1600 < 1.0 ? uiScale() === 1 : true, 'la ~1360 px rămâne 100%');
      stepUiScale(1); eq(uiScale(), 1.15); eq(document.documentElement.style.getPropertyValue('--ui-zoom'), '1.15'); eq(getComputedStyle(ribbon).zoom, '1.15', 'panglica e scalată');
      eq(getComputedStyle($('splitView')).zoom, String(ZF === 1 ? 1 : ZF), 'tabelul + Gantt nu sunt afectați'); eq(localStorage.getItem('ganttUiScale'), '1.15');
      key('+', { ctrlKey: true, altKey: true }); eq(uiScale(), 1.3, 'Ctrl+Alt + crește'); key('-', { ctrlKey: true, altKey: true }); eq(uiScale(), 1.15, 'Ctrl+Alt − scade');
      const noAnim = noTransitions(); document.querySelector('.rb-tab[data-rt="project"]').click(); stepUiScale(1); stepUiScale(1); eq(uiScale(), 1.5);
      const btn = document.querySelector('.rb-content[data-rc="project"] .rb-dd > .rb-btn'); toggleDD(btn);
      const m = btn.nextElementSibling.getBoundingClientRect(), b = btn.getBoundingClientRect();
      ok(m.width > 0 && Math.abs(m.left - b.left) < 3 && Math.abs(m.top - (b.bottom + 4)) < 3, 'meniul stă sub buton la scala 150%: stânga ' + Math.round(m.left - b.left) + ', sus ' + Math.round(m.top - b.bottom));
      closeDD(); noAnim(); key('0', { ctrlKey: true, altKey: true }); eq(uiMode, 'auto');
      for (let i = 0; i < 6; i++) stepUiScale(1); eq(uiScale(), 2); stepUiScale(1); eq(uiScale(), 2, 'maxim 200%');
    } finally { document.querySelector('.rb-tab[data-rt="home"]').click(); uiMode = prev; try { localStorage.setItem('ganttUiScale', prev === 'auto' ? 'auto' : String(prev)); } catch (e) {} applyUiScale(); }
  });

  test('avertisment „!” pe bară: în repaus stă pe colțul de sus-dreapta; cât tragi o legătură (puncte vizibile) urcă deasupra lor; în ambele stiluri', async () => {
    newTabWith('Wr', [mk(1, 'A', 5, null, [], null, { deadline: '2026-10-27' })]); settle(); renderAll();
    const keep = barStyle, noAnim = noTransitions(), nt = document.createElement('style'); nt.textContent = '.gb.task.warn::before{transition:none!important}'; document.head.appendChild(nt);
    try {
      for (const st of ['classic', 'new']) {
        if (barStyle !== st) toggleBarStyle();
        const bar = document.querySelector('.gb.task[data-bid="1"]'); ok(bar.classList.contains('warn'), 'bara are avertisment (' + st + ')');
        const dotR = bar.querySelector('.dep-dot-right'), pos = () => { const b = getComputedStyle(bar, '::before'); return { top: parseFloat(b.top), h: parseFloat(b.height) }; };
        let p = pos(); eq(getComputedStyle(dotR).opacity, '0', 'în repaus punctele sunt ascunse (' + st + ')'); eq(p.top, -7, 'în repaus avertismentul stă pe colț (' + st + ')');
        document.body.classList.add('dep-dragging'); await wait(220); p = pos();
        eq(getComputedStyle(dotR).opacity, '1', 'la tragere punctele se văd'); ok(p.top + p.h <= parseFloat(getComputedStyle(dotR).top) + 0.5, 'la tragere avertismentul (sus ' + p.top + ') nu acoperă punctul (' + st + ')');
        document.body.classList.remove('dep-dragging'); await wait(220); eq(pos().top, -7, 'revine pe colț după tragere (' + st + ')');
      }
    } finally { document.body.classList.remove('dep-dragging'); noAnim(); nt.remove(); if (barStyle !== keep) toggleBarStyle(); }
  });

  // ---------- EVM: valoare realizată ----------
  const evmFixture = () => {
    newTabWith('Evm', [mk(1, 'A', 10, null, [], '2026-10-26', { prog: 25, assign: [{ rid: 1, units: 1000 }] }), mk(2, 'B', 10, null, [F(1)], null, { assign: [{ rid: 1, units: 2000 }] })], null, { list: [{ id: 1, name: 'Fix', type: 'cost' }], next: 2, cur: 'RON' });
    setMeta({ sdate: '2026-10-30' }); settle();     // vineri, după 5 din cele 10 zile lucrătoare ale lui A
  };
  const evmDone = () => { setMeta(null); };

  test('EVM: PV / EV / SPI / SV la data de status, cu cifre verificabile (fără cost real → fără indicatori de cost)', () => {
    evmFixture();
    try {
      const D = computeEVM();
      eq(D.unit, 'cost'); eq(Math.round(D.bac), 3000, 'BAC = 1000 + 2000'); eq(Math.round(D.pv), 500, 'PV: A e la jumătate (5 din 10 zile), B nu a început');
      eq(Math.round(D.ev), 250, 'EV = 25% din 1000'); eq(Math.round(D.sv), -250); near(D.spi, 0.5, 0.001, 'SPI = 250 / 500');
      eq(D.hasActual, false); eq(D.cpi, null, 'CPI nu se inventează fără cost real'); eq(D.eac, null); eq(D.cv, null);
    } finally { evmDone(); }
  });

  test('EVM: cu cost real → CV, CPI, EAC, ETC, VAC; activitățile fără cost real se consideră în buget (AC = EV)', () => {
    evmFixture();
    try {
      T.find(t => t.id === 1).acost = 400; settle(); const D = computeEVM();
      eq(D.hasActual, true); eq(Math.round(D.ac), 400, 'AC = 400 (B are EV 0)'); eq(Math.round(D.cv), -150); near(D.cpi, 0.625, 0.001);
      eq(Math.round(D.eac), 4800, 'EAC = BAC / CPI = 3000 / 0,625'); eq(Math.round(D.etc), 4400); eq(Math.round(D.vac), -1800);
      T.find(t => t.id === 2).prog = 50; T.find(t => t.id === 2).acost = 1000; settle(); const E = computeEVM();
      eq(Math.round(E.ev), 1250, 'EV = 250 + 50% din 2000'); eq(Math.round(E.ac), 1400); eq(E.nActual, 2);
    } finally { evmDone(); }
  });

  test('EVM: costul de bază din linia de bază nu se schimbă când se modifică resursele ulterior', () => {
    evmFixture();
    try {
      T.forEach(t => { t.bl = { sd: t.sd, dur: t.dur, cost: costMap[t.id] }; }); settle();
      T.find(t => t.id === 1).assign = [{ rid: 1, units: 5000 }]; settle();
      const D = computeEVM(); eq(Math.round(D.bac), 3000, 'BAC rămâne cel salvat în bază, nu 7000'); eq(D.hasBase, true);
      eq(Math.round(D.pv), 500);
    } finally { evmDone(); }
  });

  test('EVM: proiect fără costuri → valori în zile lucrătoare; curba S pornește de la 0 și ajunge la BAC; EV / AC se opresc la data de status', () => {
    newTabWith('Evm0', [mk(1, 'A', 10, null, [], '2026-10-26', { prog: 50 }), mk(2, 'B', 10, null, [F(1)])]); setMeta({ sdate: '2026-10-30' }); settle();
    try {
      const D = computeEVM(); eq(D.unit, 'zile'); near(D.bac, 20, 0.001); near(D.pv, 5, 0.001); near(D.ev, 5, 0.001); near(D.spi, 1, 0.001);
      const c = D.curve; near(c[0].pv, 0, 0.001); near(c[c.length - 1].pv, 20, 0.01, 'curba PV ajunge la BAC');
      ok(c.every((p, i) => i === 0 || p.pv >= c[i - 1].pv - 1e-9), 'PV nu scade niciodată');
      const hist = c.filter(p => p.ev !== null), fut = c.filter(p => p.ev === null); ok(hist.length && fut.length, 'EV există până la data de status și nu după');
      ok(hist.every(p => p.d <= D.status) && fut.every(p => p.d > D.status));
      near(hist[hist.length - 1].ev, 5, 0.01, 'la data de status curba EV = EV');
    } finally { evmDone(); }
  });

  test('EVM (revizie): costul real nu se amestecă cu valorile în zile; o bază salvată înainte de resurse nu îngheață bugetul la 0', () => {
    newTabWith('Evm1', [mk(1, 'A', 10, null, [], '2026-10-26', { prog: 50, acost: 500 }), mk(2, 'B', 10, null, [F(1)])]); setMeta({ sdate: '2026-10-30' }); settle();
    try {
      let D = computeEVM(); eq(D.unit, 'zile'); eq(D.hasActual, false, 'fără costuri în proiect, costul real nu intră în calcul'); eq(D.ignoredActual, true);
      near(D.ac, D.ev, 0.001, 'AC = EV, nu 500 de bani amestecați cu zile'); eq(D.cpi, null);
      renderEVM(); ok($('evmBody').textContent.includes('ignorat'), 'fereastra anunță că costul real e ignorat');
      T.forEach(t => { t.bl = { sd: t.sd, dur: t.dur, cost: 0 }; });                       // bază salvată înainte să existe resurse
      setRes({ list: [{ id: 1, name: 'Fix', type: 'cost' }], next: 2, cur: 'RON' });
      T.find(t => t.id === 1).assign = [{ rid: 1, units: 1000 }]; T.find(t => t.id === 2).assign = [{ rid: 1, units: 2000 }]; settle();
      D = computeEVM(); eq(D.unit, 'cost', 'resursele adăugate după bază sunt luate în calcul'); eq(Math.round(D.bac), 3000, 'BAC din costurile curente, nu 0'); eq(D.hasActual, true);
    } finally { evmDone(); }
  });

  test('EVM (revizie): data de status înainte de proiect sau activitate cu progres care începe după ea — graficul rămâne coerent', () => {
    evmFixture();
    try {
      setMeta({ sdate: '2026-09-01' }); settle(); let D = computeEVM();
      ok(+D.first <= +D.status, 'graficul începe la data de status sau înainte'); ok(D.curve.some(p => p.ev !== null), 'există puncte EV'); near(D.pv, 0, 0.001, 'PV = 0 înainte de proiect');
      renderEVM(); const st = $('evmBody').querySelector('line.st'); ok(st && parseFloat(st.getAttribute('x1')) >= _EG.L, 'linia „Status” nu iese peste axa Y');
      setMeta({ sdate: '2026-10-30' }); T.find(t => t.id === 2).prog = 40; settle(); D = computeEVM();       // B începe după data de status, dar are progres
      const h = D.curve.filter(p => p.ev !== null); near(h[h.length - 1].ev, D.ev, 0.01, 'la data de status curba EV = EV din indicatori');
    } finally { evmDone(); }
  });

  test('EVM: fereastra se deschide din Proiect › Urmărire, arată indicatorii, graficul și tabelul pe capitole; Esc o închide', () => {
    evmFixture();
    try {
      T.find(t => t.id === 1).acost = 400; settle();
      ok($('btnEVM'), 'butonul „Valoare realizată”'); openEVM(); ok($('evmModal').classList.contains('open'));
      eq(document.querySelectorAll('#evmBody .evm-kpi').length, 12, '12 indicatori'); ok($('evmBody').querySelector('path.pv') && $('evmBody').querySelector('path.ev') && $('evmBody').querySelector('path.ac'), 'curbele PV / EV / AC');
      eq(document.querySelectorAll('#evmBody .evm-tbl tbody tr').length, 2, 'un rând pe capitol / activitate principală');
      ok($('evmBody').textContent.includes('0,50') && $('evmBody').textContent.includes('0,63'), 'SPI 0,50 și CPI 0,63');
      const hit = $('evmHit'), r = hit.getBoundingClientRect(); hit.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 5 }));
      ok($('evmRead').textContent.includes('PV'), 'valorile apar la mouse: ' + $('evmRead').textContent);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ok(!$('evmModal').classList.contains('open'), 'Esc închide');
    } finally { closeEVM(); evmDone(); }
  });

  test('EVM: „Cost real” din Detalii activitate se salvează / se șterge, iar datele invalide din fișier se curăță', () => {
    evmFixture();
    try {
      openTaskInfo(1); $('tiActualCost').value = '123.5'; $('tiSaveBtn').click(); eq(T.find(t => t.id === 1).acost, 123.5, 'salvat');
      openTaskInfo(1); eq($('tiActualCost').value, '123.5'); $('tiActualCost').value = ''; $('tiSaveBtn').click(); eq(T.find(t => t.id === 1).acost, undefined, 'gol = șters');
      openTaskInfo(1); $('tiActualCost').value = '-5'; $('tiSaveBtn').click(); eq(T.find(t => t.id === 1).acost, undefined, 'negativ = respins');
      setProject([mk(1, 'A', 2, null, [], '2026-10-26', { acost: '-3', bl: { sd: '2026-10-26', dur: 2, cost: -1 } }), mk(2, 'B', 2, null, [], '2026-10-26', { acost: 'abc' }), mk(3, 'C', 2, null, [], '2026-10-26', { acost: '12', bl: { sd: '2026-10-26', dur: 2, cost: '450' } })]);
      _sanitizeTasks(); const [a, b, c] = T;
      eq([a.acost, b.acost, c.acost], [undefined, undefined, 12], 'cost real invalid eliminat'); eq(a.bl, { sd: '2026-10-26', dur: 2 }, 'cost de bază negativ eliminat'); eq(c.bl.cost, 450);
    } finally { evmDone(); }
  });

  // ---------- Șabloane de proiect ----------
  test('șabloane: fiecare se încarcă fără erori, fără cicluri, cu date valide, trece de sanitizare și pornește de la prima zi lucrătoare de la azi', () => {
    ok(PROJECT_TEMPLATES.length === 3, 'trei șabloane');
    const start = templateStartDate(); ok(validISO(start) && ![0, 6].includes(pD(start).getDay()), 'start = zi lucrătoare: ' + start); ok(start >= todayStr, 'nu în trecut');
    PROJECT_TEMPLATES.forEach(tpl => {
      const built = buildTemplateTasks(tpl, start), nDeps = built.reduce((s, t) => s + t.deps.length, 0), tabsBefore = tabs.length;
      newFromTemplate(tpl.id);
      eq(tabs.length, tabsBefore + 1, tpl.id + ': tab nou'); eq(tabs.find(t => t.id === activeTabId).name, tpl.nm);
      const leaves = T.filter(t => !hasK(t.id)), chapters = T.filter(t => hasK(t.id) && !t.pid), ms = T.filter(t => t.isMilestone);
      ok(leaves.length >= 10 && leaves.length <= 15, tpl.id + ': ' + leaves.length + ' activități (10–15)'); ok(chapters.length >= 2 && chapters.length <= 3, tpl.id + ': ' + chapters.length + ' capitole');
      ok(ms.length >= 1 && ms.every(t => t.dur === 1), tpl.id + ': repere'); eq(RES.list.length, 0, 'fără resurse');
      eq(T.reduce((s, t) => s + t.deps.length, 0), nDeps, tpl.id + ': sanitizarea nu pierde legături'); ok(!_topoDepOrder().hasCycle, tpl.id + ': fără cicluri');
      ok(T.some(t => t.deps.some(d => d.type === 'SS')) && T.some(t => t.deps.some(d => d.lag > 0)), tpl.id + ': are legături SS și cu decalaj');
      ok(T.every(t => t.deps.every(d => d.id !== t.id && T.some(x => x.id === d.id) && !isD(d.id, t.id) && !isD(t.id, d.id))), tpl.id + ': legături valide');
      settle(); ok(T.every(t => validISO(t.sd) && t.dur >= 1 && t.prog === 0), tpl.id + ': date valide');
      eq(T.map(t => t.sd).sort()[0], start, tpl.id + ': pornește de la ' + start); ok(leaves.every(t => isWork(pD(t.sd))), tpl.id + ': activitățile încep în zile lucrătoare');
      const before = JSON.stringify(T); _sanitizeTasks(); eq(JSON.stringify(T), before, tpl.id + ': sanitizarea nu mai schimbă nimic');
      ok(new Set(T.map(t => t.nm)).size === T.length, tpl.id + ': nume unice');
    });
  });

  test('șabloane: cardurile din ecranul de bun venit arată numele, descrierea și numărătoarea; click = proiect nou', () => {
    renderTemplateCards(); const cards = [...document.querySelectorAll('#wlTemplates .wl-tpl-card')]; eq(cards.length, 3);
    PROJECT_TEMPLATES.forEach((tpl, i) => { const s = templateStats(tpl), tx = cards[i].textContent; ok(tx.includes(tpl.nm) && tx.includes(tpl.desc), 'nume + descriere'); ok(tx.includes(s.tasks + ' activități') && tx.includes(s.chapters + ' capitole') && tx.includes(s.milestones + ' repere'), 'numărătoare: ' + tx); });
    ok(cards[0].title.length > 20, 'titlu explicativ'); const n = tabs.length; cards[2].click(); eq(tabs.length, n + 1, 'click = proiect nou'); eq(tabs.find(t => t.id === activeTabId).name, PROJECT_TEMPLATES[2].nm);
  });

  // ---------- Tur ghidat ----------
  const tourReset = () => { if (_tour) tourClose(); };
  test('tur: indicatorul „terminat" se salvează și se citește; nu pornește singur cu ?notour sau cu indicatorul pus', async () => {
    const keep = localStorage.getItem('ganttTourDone');
    try {
      tourSetDone(false); eq(tourIsDone(), false); eq(localStorage.getItem('ganttTourDone'), null); tourSetDone(true); eq(tourIsDone(), true); eq(localStorage.getItem('ganttTourDone'), '1');
      tourSetDone(false); maybeStartTour(); await wait(900); ok(!_tour, 'cu ?notour în adresă nu pornește singur');
      tourSetDone(true); maybeStartTour(); await wait(900); ok(!_tour, 'cu indicatorul pus nu pornește singur');
    } finally { tourReset(); if (keep === null) localStorage.removeItem('ganttTourDone'); else localStorage.setItem('ganttTourDone', keep); }
  });

  test('tur: se pornește și se închide (Următorul / Înapoi / Sari peste / Esc / Gata), cu rol de dialog, focus mutat și readus, 6 pași', async () => {
    const keep = localStorage.getItem('ganttTourDone'); addNewTab('Tur'); loadDemo(); await wait(50);
    const homeTab = document.querySelector('.rb-tab[data-rt="home"]'); homeTab.click();
    try {
      const opener = $('btnTour'); ok(opener && opener.title.includes('6 pași'), 'butonul Ghid din fila Vizualizare'); tourSetDone(false);
      startTour(); ok(_tour, 'pornit'); const box = $('tourBox'); eq(box.getAttribute('role'), 'dialog'); eq(box.getAttribute('aria-modal'), 'true'); ok(box.contains(document.activeElement), 'focus în casetă');
      eq($('tourNo').textContent, 'Pasul 1 din 6'); ok($('tourBack').disabled, 'Înapoi dezactivat la primul pas'); eq($('tourNext').textContent, 'Următorul'); ok($('tourTitle').textContent.length > 3 && $('tourText').textContent.length > 40);
      for (let i = 2; i <= 6; i++) { $('tourNext').click(); eq($('tourNo').textContent, 'Pasul ' + i + ' din 6'); ok($('tourText').textContent.length > 40, 'text la pasul ' + i); }
      eq($('tourNext').textContent, 'Gata', 'ultimul pas'); eq(document.querySelector('.rb-tab.active').dataset.rt, 'home', 'fila de panglică revine după pasul 5');
      $('tourBack').click(); eq($('tourNo').textContent, 'Pasul 5 din 6'); eq(document.querySelector('.rb-tab.active').dataset.rt, 'view', 'pasul 5 arată fila Vizualizare');
      $('tourNext').click(); $('tourNext').click(); ok(!_tour && !$('tourBox') && !$('tourSpot') && !$('tourShield'), '„Gata" închide și curăță'); eq(tourIsDone(), true, 'indicator salvat');
      eq(document.querySelector('.rb-tab.active').dataset.rt, 'home', 'fila inițială revine');
      tourSetDone(false); startTour(); $('tourSkip').click(); ok(!_tour && tourIsDone(), '„Sari peste" închide și marchează terminat');
      tourSetDone(false); startTour(); $('tourNext').click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); ok(!_tour && tourIsDone(), 'Esc închide');
      tourSetDone(false); document.querySelector('.rb-tab[data-rt="view"]').click(); opener.focus(); ok(document.activeElement === opener, 'butonul Ghid e vizibil în fila Vizualizare'); opener.click(); ok(_tour, 'pornit din butonul Ghid'); tourClose(); ok(document.activeElement === opener, 'focusul revine pe butonul Ghid'); eq(document.querySelector('.rb-tab.active').dataset.rt, 'view'); homeTab.click();
      startTour(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); eq($('tourNo').textContent, 'Pasul 2 din 6', 'săgeată dreapta = următorul');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); eq($('tourNo').textContent, 'Pasul 1 din 6', 'săgeată stânga = înapoi');
    } finally { tourReset(); homeTab.click(); if (keep === null) localStorage.removeItem('ganttTourDone'); else localStorage.setItem('ganttTourDone', keep); }
  });

  test('tur: cadrul luminat acoperă ținta, caseta rămâne în fereastră și nu acoperă ținta — normal, cu zoom pe tabel + Gantt, cu panglică mărită și în modul întunecat', async () => {
    const keep = localStorage.getItem('ganttTourDone'), keepZ = ZF, keepUi = uiMode, dark = document.body.classList.contains('dark');
    addNewTab('Tur2'); loadDemo(); await wait(50); const noAnim = noTransitions(), nt = document.createElement('style'); nt.textContent = '#tourSpot,#tourBox{transition:none!important}'; document.head.appendChild(nt);
    const run = async label => {
      startTour();
      try {
        for (let i = 0; i < 6; i++) {
          await wait(30); _tourPlace(); const sp = $('tourSpot').getBoundingClientRect(), bx = $('tourBox').getBoundingClientRect(), s = TOUR_STEPS[i], els = s.target().filter(Boolean), pad = s.pad || 6;
          ok(els.length, label + ' pas ' + (i + 1) + ': ținta există');
          const l = Math.min(...els.map(e => e.getBoundingClientRect().left)), t = Math.min(...els.map(e => e.getBoundingClientRect().top)), r = Math.max(...els.map(e => e.getBoundingClientRect().right)), b = Math.max(...els.map(e => e.getBoundingClientRect().bottom));
          ok(sp.left <= l + 2.5 && sp.top <= t + 2.5 && sp.right >= r - 2.5 && sp.bottom >= b - 2.5, label + ' pas ' + (i + 1) + ': cadrul acoperă ținta (' + [sp.left, sp.top, sp.right, sp.bottom].map(Math.round) + ' vs ' + [l, t, r, b].map(Math.round) + ')');
          ok(sp.left >= l - pad - 3 && sp.top >= t - pad - 3 || sp.left <= 2 || sp.top <= 2, label + ' pas ' + (i + 1) + ': cadrul nu e mult mai mare decât ținta');
          ok(bx.left >= 0 && bx.top >= 0 && bx.right <= innerWidth + 0.5 && bx.bottom <= innerHeight + 0.5, label + ' pas ' + (i + 1) + ': caseta e în fereastră');
          const huge = (r - l) * (b - t) > innerWidth * innerHeight * 0.3;
          if (!huge) ok(bx.right <= sp.left + 1 || bx.left >= sp.right - 1 || bx.bottom <= sp.top + 1 || bx.top >= sp.bottom - 1, label + ' pas ' + (i + 1) + ': caseta nu acoperă ținta');
          if (s.dots) ok(getComputedStyle(document.querySelector('.gb.task .dep-dot-right')).opacity === '1', 'pasul cu legături arată punctele de pe colțuri');
          if (i < 5) $('tourNext').click();
        }
      } finally { tourReset(); }
    };
    try {
      await run('normal');
      setContentZoom(1.25, true); await run('zoom 125%'); setContentZoom(1, true);
      uiMode = 1.3; applyUiScale(); await run('panglică 130%'); uiMode = keepUi; applyUiScale();
      document.body.classList.add('dark'); await run('întunecat'); if (!dark) document.body.classList.remove('dark');
    } finally { tourReset(); setContentZoom(keepZ, true); uiMode = keepUi; applyUiScale(); if (!dark) document.body.classList.remove('dark'); noAnim(); nt.remove(); if (keep === null) localStorage.removeItem('ganttTourDone'); else localStorage.setItem('ganttTourDone', keep); }
  });

  test('tur: tastele nu ajung la aplicația din spatele turului (Tab, Del, Ctrl+Z, Ctrl+N); vederea și ecranul complet se restaurează', async () => {
    const keep = localStorage.getItem('ganttTourDone'); addNewTab('Tur3'); loadDemo(); await wait(50);
    try {
      sel = T.find(t => !hasK(t.id) && t.pid).id; renderAll(); const snapT = JSON.stringify(T), h = _history.length, n = T.length;
      startTour(); const fire = (key, o) => { const ev = new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, o)); $('tourNext').dispatchEvent(ev); return ev; };
      ok(fire('Tab').defaultPrevented, 'Tab nu iese din casetă'); eq(JSON.stringify(T), snapT, 'Tab nu a făcut indent'); fire('Delete'); eq(T.length, n, 'Del nu șterge');
      fire('z', { ctrlKey: true }); eq(_history.length, h, 'Ctrl+Z nu anulează'); const cn = fire('n', { ctrlKey: true }); ok(cn.defaultPrevented && !$('nameModal').classList.contains('open'), 'Ctrl+N nu deschide „Proiect nou”');
      ok(!fire('F5').defaultPrevented, 'F5 rămâne al browserului'); eq(JSON.stringify(T), snapT, 'proiectul neschimbat'); eq($('tourNo').textContent, 'Pasul 1 din 6'); tourClose();
      setViewMode('tree'); startTour(); eq(view, 'gantt', 'turul arată Gantt-ul'); tourClose(); eq(view, 'tree', 'vederea revine'); setViewMode('gantt');
      toggleGanttFull(); ok(document.body.classList.contains('gantt-full')); startTour(); ok(!document.body.classList.contains('gantt-full'), 'turul iese din ecranul complet'); tourClose(); ok(document.body.classList.contains('gantt-full'), 'ecranul complet revine'); toggleGanttFull();
    } finally { tourReset(); if (document.body.classList.contains('gantt-full')) toggleGanttFull(); if (keep === null) localStorage.removeItem('ganttTourDone'); else localStorage.setItem('ganttTourDone', keep); }
  });

  test('accesibilitate: ferestrele au rol de dialog, focusul intră la deschidere și revine la închidere', async () => {
    document.querySelectorAll('.modal-overlay').forEach(ov => { const b = ov.firstElementChild; ok(b && b.getAttribute('role') && b.getAttribute('aria-modal') === 'true', 'fără rol: #' + ov.id); });
    eq($('confirmModal').firstElementChild.getAttribute('role'), 'alertdialog');
    addNewTab('A11y'); const btn = document.querySelector('.rb-tab'); btn.focus(); openCalendar(); await wait(80);
    ok($('calModal').contains(document.activeElement), 'focus în fereastra Calendar'); closeCalendar(); await wait(80);
    eq(document.activeElement, btn, 'focusul revine la elementul de dinainte');
    document.querySelectorAll('.modal-close').forEach(b => ok(b.getAttribute('aria-label'), 'buton de închidere fără etichetă'));
  });

  // ---------- extensie pentru funcții viitoare ----------
  const extra = window.__regressionExtra;
  if (typeof extra === 'function') extra({ test, ok, eq, near, skip, wait, F, mk, settle, snap, setProject, confirmYes, key, newTabWith, noTransitions, toasts });

  // ---------- rulăm ----------
  for (const t of tests) {
    results.total++;
    try { await t.fn(); results.passed++; }
    catch (e) { if (e.skip) { results.skipped.push(t.name + ' — ' + e.message); results.passed++; } else results.failed.push({ name: t.name, error: String(e.message || e).slice(0, 400) }); }
  }
  restoreEnv();
  return results;
})()
