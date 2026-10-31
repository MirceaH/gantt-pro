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
  const LS_KEYS = ['ganttSideNames', 'ganttBase', 'ganttCrit', 'ganttDark', 'ganttColW', 'ganttRibbonCollapsed'];
  const env = {
    tabs: JSON.stringify(tabs), active: activeTabId, next: nextTabId, view,
    showSideNames: typeof showSideNames !== 'undefined' ? showSideNames : null,
    showBaseline: typeof showBaseline !== 'undefined' ? showBaseline : null,
    showCritical: typeof showCritical !== 'undefined' ? showCritical : null,
    isAutoZoom, zoomLevel, dayW: document.documentElement.style.getPropertyValue('--day-w'),
    ls: {}, hist: [_history.slice(), _future.slice()],
    filter: typeof FILTER !== 'undefined' ? JSON.stringify(FILTER) : null
  };
  LS_KEYS.forEach(k => { try { env.ls[k] = localStorage.getItem(k); } catch (e) {} });
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
  // C) FUNCȚII NOI (adăugate pe măsură ce sunt implementate)
  // ============================================================
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
