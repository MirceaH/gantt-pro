// ============================================================
// ȘABLOANE DE PROIECT — „Începe dintr-un șablon" pe ecranul de bun venit
// ============================================================
// Fiecare șablon e o listă de elemente în ordinea din tabel:
//   k = cheie (doar în șablon), nm = nume, p = cheia capitolului părinte (fără p = capitol principal / activitate de rădăcină),
//   dur = zile lucrătoare (capitolele își calculează singure durata), ms = reper,
//   d = predecesori: 'cheie' (FS) sau ['cheie', 'SS', lag] (tip + decalaj în zile lucrătoare).
// Datele pornesc de la prima zi lucrătoare de la „azi"; legăturile mută restul activităților.
// Șablonul intră în aplicație pe aceeași cale ca un fișier încărcat (addNewTab → loadTabData → _sanitizeTasks).
const PROJECT_TEMPLATES = [
  {
    id: 'constructii', nm: 'Construcții (hală)',
    desc: 'De la studii și autorizații la recepția unei hale: fundații, structură, închideri, instalații și finisaje.',
    items: [
      { k: 'c1', nm: 'Pregătire și fundații' },
      { k: 'a1', p: 'c1', nm: 'Studii și proiectare', dur: 12 },
      { k: 'a2', p: 'c1', nm: 'Autorizație de construire', dur: 10, d: ['a1'] },
      { k: 'a3', p: 'c1', nm: 'Mobilizare șantier', dur: 3, d: ['a2'] },
      { k: 'a4', p: 'c1', nm: 'Săpătură', dur: 5, d: ['a3'] },
      { k: 'a5', p: 'c1', nm: 'Turnare fundații', dur: 6, d: ['a4'] },
      { k: 'c2', nm: 'Structură și închideri' },
      { k: 'b1', p: 'c2', nm: 'Structură metalică', dur: 10, d: [['a5', 'FS', 2]] },
      { k: 'b2', p: 'c2', nm: 'Structură finalizată', ms: true, d: ['b1'] },
      { k: 'b3', p: 'c2', nm: 'Acoperiș', dur: 6, d: ['b2'] },
      { k: 'b4', p: 'c2', nm: 'Pereți exteriori', dur: 7, d: [['b3', 'SS', 3]] },
      { k: 'b5', p: 'c2', nm: 'Instalații electrice', dur: 8, d: [['b4', 'SS', 2]] },
      { k: 'c3', nm: 'Instalații, finisaje și predare' },
      { k: 'd1', p: 'c3', nm: 'Instalații HVAC', dur: 6, d: ['b4'] },
      { k: 'd2', p: 'c3', nm: 'Finisaje interioare', dur: 8, d: ['b5', 'd1'] },
      { k: 'd3', p: 'c3', nm: 'Amenajare exterior', dur: 5, d: ['b4'] },
      { k: 'd4', p: 'c3', nm: 'Teste și verificări', dur: 3, d: ['d2'] },
      { k: 'd5', p: 'c3', nm: 'Recepția lucrării', ms: true, d: ['d4', 'd3'] }
    ]
  },
  {
    id: 'software', nm: 'Dezvoltare software',
    desc: 'Un ciclu complet: cerințe și design, dezvoltare backend și interfață, teste, corectări și lansare.',
    items: [
      { k: 'c1', nm: 'Analiză și proiectare' },
      { k: 'a1', p: 'c1', nm: 'Colectarea cerințelor', dur: 8 },
      { k: 'a2', p: 'c1', nm: 'Analiză și specificații', dur: 6, d: ['a1'] },
      { k: 'a3', p: 'c1', nm: 'Design interfață (UX)', dur: 7, d: [['a2', 'SS', 3]] },
      { k: 'a4', p: 'c1', nm: 'Arhitectură tehnică', dur: 5, d: ['a2'] },
      { k: 'a5', p: 'c1', nm: 'Specificații aprobate', ms: true, d: ['a3', 'a4'] },
      { k: 'c2', nm: 'Dezvoltare' },
      { k: 'b1', p: 'c2', nm: 'Backend și bază de date', dur: 15, d: ['a5'] },
      { k: 'b2', p: 'c2', nm: 'Interfață (frontend)', dur: 15, d: [['b1', 'SS', 5]] },
      { k: 'b3', p: 'c2', nm: 'Integrare și teste interne', dur: 6, d: ['b1', 'b2'] },
      { k: 'b4', p: 'c2', nm: 'Versiune alfa', ms: true, d: ['b3'] },
      { k: 'c3', nm: 'Testare și lansare' },
      { k: 'd1', p: 'c3', nm: 'Teste de acceptanță (QA)', dur: 8, d: ['b4'] },
      { k: 'd2', p: 'c3', nm: 'Corectarea erorilor', dur: 6, d: [['d1', 'SS', 3]] },
      { k: 'd3', p: 'c3', nm: 'Documentație și instruire', dur: 5, d: [['d1', 'SS', 2]] },
      { k: 'd4', p: 'c3', nm: 'Lansare în producție', dur: 2, d: ['d2', 'd3'] },
      { k: 'd5', p: 'c3', nm: 'Produs lansat', ms: true, d: ['d4'] }
    ]
  },
  {
    id: 'eveniment', nm: 'Organizare eveniment',
    desc: 'Conferință, workshop sau gală: concept și locație, promovare și logistică, ziua evenimentului și raportul final.',
    items: [
      { k: 'c1', nm: 'Planificare' },
      { k: 'a1', p: 'c1', nm: 'Concept, obiective și buget', dur: 5 },
      { k: 'a2', p: 'c1', nm: 'Alegerea locației', dur: 6, d: ['a1'] },
      { k: 'a3', p: 'c1', nm: 'Contracte cu furnizorii', dur: 6, d: ['a2'] },
      { k: 'a4', p: 'c1', nm: 'Planificare aprobată', ms: true, d: ['a3'] },
      { k: 'c2', nm: 'Promovare și logistică' },
      { k: 'b1', p: 'c2', nm: 'Campanie de promovare', dur: 15, d: ['a1'] },
      { k: 'b2', p: 'c2', nm: 'Invitații și înscrieri', dur: 10, d: [['b1', 'SS', 3]] },
      { k: 'b3', p: 'c2', nm: 'Program și invitați speciali', dur: 8, d: ['a2'] },
      { k: 'b4', p: 'c2', nm: 'Logistică, catering și materiale', dur: 8, d: ['a3'] },
      { k: 'c3', nm: 'Evenimentul' },
      { k: 'd1', p: 'c3', nm: 'Montaj și pregătirea sălii', dur: 2, d: ['b2', 'b3', 'b4'] },
      { k: 'd2', p: 'c3', nm: 'Ziua evenimentului', ms: true, d: [['d1', 'FS', 1]] },
      { k: 'd3', p: 'c3', nm: 'Demontare și predarea locației', dur: 1, d: ['d2'] },
      { k: 'd4', p: 'c3', nm: 'Raport final și mulțumiri', dur: 3, d: ['d3'] }
    ]
  }
];

// Prima zi lucrătoare (luni–vineri) de la azi încolo — calendarul unui proiect nou e cel implicit
function templateStartDate() {
  let d = new Date(); d.setHours(0, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d = aD(d, 1);
  return fD(d);
}

// Transformă șablonul în activități (id-uri 1..n, legături cu id-uri); toate pornesc la `startISO`, iar legăturile le așază
function buildTemplateTasks(tpl, startISO) {
  const idOf = {}; tpl.items.forEach((x, i) => { idOf[x.k] = i + 1; });
  return tpl.items.map((x, i) => {
    const t = { id: i + 1, nm: x.nm, sd: startISO, dur: x.ms ? 1 : (x.dur || 1), prog: 0, pid: x.p ? idOf[x.p] : null,
      deps: (x.d || []).map(e => Array.isArray(e) ? { id: idOf[e[0]], type: e[1], lag: e[2] || 0 } : { id: idOf[e], type: 'FS', lag: 0 }) };
    if (x.ms) t.isMilestone = true;
    return t;
  });
}

// Numărătoare pentru carduri: activități (fără capitole și repere), capitole, repere
function templateStats(tpl) {
  const parents = new Set(tpl.items.filter(x => x.p).map(x => x.p));
  const chapters = tpl.items.filter(x => parents.has(x.k)).length, milestones = tpl.items.filter(x => x.ms).length;
  return { chapters, milestones, tasks: tpl.items.length - chapters - milestones };
}

function newFromTemplate(id) {
  const tpl = PROJECT_TEMPLATES.find(x => x.id === id); if (!tpl) return;
  const tasks = buildTemplateTasks(tpl, templateStartDate());
  addNewTab(tpl.nm, tasks, tasks.length + 1);
  toast('📋 Proiect creat din șablonul „' + tpl.nm + '” — începe azi; schimbă numele, duratele și legăturile după nevoie');
}

// Cardurile din ecranul de bun venit (text din șabloane proprii, dar trecut prin esc() ca regulă)
function renderTemplateCards() {
  const box = document.getElementById('wlTemplates'); if (!box) return;
  box.innerHTML = PROJECT_TEMPLATES.map(tpl => {
    const s = templateStats(tpl), pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    return `<button type="button" class="wl-tpl-card" onclick="newFromTemplate('${tpl.id}')" title="Creează un proiect nou din șablonul „${esc(tpl.nm)}”, cu activități și legături gata făcute">
      <b>${esc(tpl.nm)}</b><span class="wl-tpl-d">${esc(tpl.desc)}</span>
      <span class="wl-tpl-n">${pl(s.tasks, 'activitate', 'activități')} · ${pl(s.chapters, 'capitol', 'capitole')} · ${pl(s.milestones, 'reper', 'repere')}</span></button>`;
  }).join('');
}
