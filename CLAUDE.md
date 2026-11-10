# Gantt PRO - Modular

Aplicație web **vanilla HTML/CSS/JS** (fără build system, fără framework) pentru planificare proiect — Gantt interactiv inspirat MS Project / WBS Schedule Pro.

## Rulare
Static site. Server local: `python -m http.server 8000`. Pe calculatorul acesta nu există Python / Node: folosește `.claude/serve.ps1` (`powershell -NoProfile -ExecutionPolicy Bypass -File .claude/serve.ps1`), pornit și de `preview_start` prin `.claude/launch.json` (ambele sunt ignorate de git).

## Arhitectură

Script-urile se încarcă în ordine prin `<script>` tags în `index.html`. Globals sunt partajate direct (fără modules):

- **js/data.js** — model + state global (`T`, `nid`, `sel`, `coll`, `tabs`), helpers date (`pD`/`fD`/`aD`/`dD`), undo/redo, auto-scheduling, I/O JSON, acțiuni task
- **js/gantt.js** — randare tabel stânga + Gantt dreapta, rutare ortogonală săgeți, interacțiune bare (drag/resize/progres)
- **js/tree.js** — vizualizare arbore (vedere alternativă)
- **js/deps.js** — anchor-dots, drag pentru creare/mutare dependențe, modal edit dep
- **js/toolbar.js** — clipboard, find, Task Info modal, export MS Project XML, shortcuts
- **js/main.js** — dark mode, export PNG/PDF, bootstrap, `renderAll()` orchestrare

## Model de date task

```js
{
  id, nm, sd, dur, prog,          // obligatoriu
  pid,                             // parinte summary (null = root)
  deps: [{id, type, lag}, ...],   // dependențe (vezi mai jos)
  notes, isMilestone               // opționale
}
```

`T` = array de task-uri al tab-ului activ (sincronizat cu `tabs[activeTabId].T` prin `syncTabData()`).

## Dependențe (Faza 1 — complet)

**Model:** `{id: predId, type: 'FS'|'SS'|'FF'|'SF', lag: number_zile}`.
Format vechi (`deps: [1, 2]`) e **auto-migrat la FS** prin `_ensureDeps()`.

**Formule auto-scheduling** (zile inclusive, task ocupă `[sd, sd+dur-1]`):
```
FS: succ.start = pred.start + pred.dur + lag
SS: succ.start = pred.start + lag
FF: succ.start = pred.start + pred.dur + lag - succ.dur
SF: succ.final = ziua lucrătoare dinaintea pred.start (+lag)   // ca în MS Project: fără zi suprapusă
```
(în zile lucrătoare, calendarul proiectului; formula comună e `depStart(t,d,lag)` în data.js; decalajul se rotunjește la zile întregi în `_normalizeDep`)

- **Reperul are durată 0** (ca în MS Project): `dur` rămâne 1 în date, dar reperul stă la FINALUL zilei lui. Ca succesor FS / FF cade în ultima zi a predecesorului, iar succesorul lui FS începe în ziua lucrătoare următoare (deci nu consumă o zi). În CPM `d = 0`; în Gantt rombul e la finalul zilei (`(off+1)*dw`), iar coloana „Zile" arată 0.
- **Legături pe un capitol** (capitolul ca succesor): se aplică tuturor activităților din el — `inheritedDeps(t)` / `schedDeps(t)` (data.js), folosite de `recalcSchedule`, `_topoDepOrder`, `computeCPM`, `wouldCreateCycle` și export. Doar FS / SS pe capitole (FF / SF refuzate în `_applyDepsSafely`, ca în MS Project).
- **Startul unei activități e mereu o zi lucrătoare** (`recalcSchedule` aliniază cu `nextWork`).
- **Start scris de mână** (tabel, Detalii, tragerea barei) → `moveStartTo(t, v)`: activitatea se mută, durata rămâne; cu legături proprii → decalaj (`lagFromMove`); cu legături doar moștenite → restricție SNET; o SNET existentă își ia data nouă; alte restricții puse de utilizator nu se ating.

`recalcSchedule()` rulează la fiecare `renderAll()` în loop cu `recalcSummaries()` până la stabilizare (max 20 iterații). Cicluri detectate cu `_topoDepOrder()`, prevenție la creare cu `wouldCreateCycle()`.

## Convenții vizuale

**Culori per tip de dependență** (CSS vars `--dep-c` / `--dep-c-strong`):
- FS = gri-albastru `#8da0b5` (default, cel mai folosit)
- SS = verde `#4ea378`
- FF = portocaliu `#e58b35`
- SF = mov `#9870c7`

**Rutare săgeți** = **ortogonală Manhattan** (L-shape), colțuri rotunjite cu Q arc (4px radius). Helpers în `gantt.js`: `_buildOrthoPoints()`, `_roundedPolyPath()`, `_labelAnchor()` (evită primii/ultimii 15px ai segmentului vertical ca label-ul să nu se bată cu dep-dots).

**Anchor-dots** = DOUĂ pe fiecare bară task, pe **colțurile SUS** (nu la mijloc):
- `dep-dot-left` sus-stânga, albastru = Start (pt. SS/SF)
- `dep-dot-right` sus-dreapta, coral = Finish (pt. FS/FF)
- Vizibile la hover pe bară sau în timpul drag-ului (body.dep-dragging)
- Combinație (`fromSide`, `toSide`) → tipul dep (vezi `DEP_TYPE_FROM_SIDES` în `deps.js`)
- La drag: badge plutitor cu tipul colorat lângă cursor, highlight pe jumătatea activă a target-ului

**Prog-handle** (`.prog-handle[data-ph]`, desenat în `renderGantt`, tras în `attachBars`) = mâner vertical alb la **capătul părții umplute** (la % progres), `z-index:25` (deasupra dep-dot). La 0% / 100% e tras 12 px spre interior (`_phLeft`), ca să nu acopere mânerele de redimensionare; nu se desenează pe capitole, repere, bare sub `PH_MIN_W` (30 px) sau la zoom foarte mic (`zoom-micro`). Vizibil subtil pe bar-hover, prominent pe handle-hover.

**Procent %** = text transparent cu stroke negru 4-direcții, la capătul fill-ului. **Nu are fundal** → numele task-ului rămâne vizibil dedesubt.

**Snap progres:** multipli de **5%** default; `Shift+drag` = **1%** precis.

**Hover focus:** la hover pe bară, săgețile care nu ating acea bară scad la opacity 12% (clasa `has-focus` pe `.dep-svg`).

## renderAll pipeline

```
renderAll():
  loop (max 20):
    snap = T.map(sd+dur).join()
    recalcSchedule()      // deps → data task
    recalcSummaries()     // children → summary
    if snapshot egal → break
  renderTH / renderTBody / renderGantt (sau renderTree)
  renderStatus / saveAllTabs / updateUndoRedoBtns
```

Fiecare acțiune user face `pushHistory() → modify → syncTabData() → renderAll()`.

## Export MS Project XML

În `toolbar.js: _buildMSProjectXML`. Mapare Type codes:
`FS=1, SS=3, FF=0, SF=2`. **Lag în ZECIMI de minut**: `lag_zile * 4800` (8h/zi). Verificat deschizând fișierul în MS Project Professional: activitățile sunt automate (`Manual=0`); cele fără legături primesc SNET la start, cele cu legături `ConstraintType=0` explicit; reperul `Milestone=1`, durată 0, la 17:00; finalurile la 17:00; calendarul (zile lucrătoare 8–12 / 13–17 + zile libere ca `WeekDay DayType=0`), resurse (muncă: tarif/oră, `MaxUnits` ca fracție; material: `Work = PT{cantitate}H`; cost fix: `Cost`), atribuiri **cu Start / Finish** (fără ele MS Project mută activitatea), date reale (deduse din progres dacă lipsesc), restricții, termene, linia de bază 0, moneda. Fișiere de test: `Claude outputs/export-test-*.xml`.

## Fazele proiectului (roadmap)

- ✅ **Faza 1** — Dependențe complete (FS/SS/FF/SF + lag + UI polish)
- ✅ **Faza 2** — Drum critic (CPM) — `js/cpm.js`
- ✅ **Faza 3** — Restricții (ASAP/ALAP/SNET/SNLT/FNET/FNLT/MSO/MFO) + termen limită — în `data.js` (`_applyCons`) și `cpm.js`
- ✅ **Faza 4** — Resurse (muncă/material/cost), tipuri de activități, supra-alocare — `js/resources.js`
- ✅ **Faza 5** — Buget (cost pe activitate/capitol/proiect) — `js/resources.js`
- ✅ **Faza 6** — Linia de bază + variație + „Azi" + întârzieri — `js/plan.js`
- ⬜ **Faza 7** — Asistent AI (generator WBS, analiză riscuri, comenzi în limbaj natural) — necesită API/server

## Reguli de cod

- Vanilla JS, **fără** build system — menține scrip-urile `<script src>` globale
- CSS vars pentru teme (dark mode via `body.dark`)
- `esc(s)` pt. orice text user → HTML (anti-XSS)
- `pushHistory()` înainte de orice modificare pt. undo
- `syncTabData()` după modificare ca tab-ul să fie salvat
- Toast scurt (`toast('...')`) pt. feedback acțiuni

## Module adăugate după Faza 1

- `js/calendar.js` — zile lucrătoare + zile libere per proiect (`CAL`, `addWorkDays`, `endDate`, `workDur`). Durata (`dur`) = zile lucrătoare.
- `js/cpm.js` — drum critic, rezervă, avertismente (`taskWarn`), ALAP.
- `js/plan.js` — linia de bază (`t.bl`), variație, activități întârziate.
- `js/resources.js` — resurse (`RES`), costuri (`costMap`), încărcare (`loadMap`), supra-alocare (`resWarn`), fereastra „Resurse și buget".
- `js/files.js` — salvare/deschidere de fișiere pe disc (File System Access API), Ctrl+S / Ctrl+O.
- PWA: `manifest.json`, `sw.js` (la fișiere noi: adaugă-le în `ASSETS` și crește `CACHE`).
- Stare per proiect (tab): `T`, `CAL`, `RES`. Se salvează în `tabs[]`, în exportul JSON și în fișierul de proiect.
- Câmpuri noi pe activitate: `cons`, `deadline`, `_alap`, `bl`, `assign[{rid,units}]`, `ttype` ('fd'|'fw').

## Noutăți UX (ramura ux-polish)

- `js/dates.js` — câmp de dată în format românesc zz.ll.aaaa: `dtField(iso,{id,dis,cls,onchange})` generează un câmp text + buton de calendar + un `<input type="date">` ascuns (păstrează valoarea ISO, deci restul codului citește `.value` ca înainte). `dtSet(id,iso)` pentru setare din cod, `dtWrapStatic(id)` pentru inputuri din HTML-ul static. Nu mai folosi `<input type="date">` direct (afișează după limba sistemului).
- Ecran de bun venit când nu e niciun proiect deschis (`tabs.length===0`, clasa `body.no-project`): Proiect nou / Deschide / Exemplu + proiecte recente (IndexedDB, `files.js`: `recentAdd/renderRecents/openRecent`). Prima rulare NU mai încarcă demo-ul.
- `_openHandle()` în `files.js`: dacă fișierul e deja deschis într-un tab, te duce la el (fără dublură).
- Taste în tabel (când nu editezi): ↑/↓ selectează, → indent, ← outdent, Alt+↑/↓ mută, Enter editează, Esc / click pe spațiu gol deselectează, Ctrl+N proiect nou.
- Numele din bară: `barLabel()` în `gantt.js` (complet → `t.sn` nume scurt → prescurtare automată → gol); niciodată numărul rândului.
- Capitolele au bară subțire cu capete în jos și titlul deasupra; săgețile nu mai ascund duplicatele; „FS" nu se scrie pe săgeată (doar la hover pe săgeată).
- Zoom auto minim 1.2 px/zi (proiecte lungi încap în fereastră); clasa `zoom-tiny` ascunde grila pe zile.
- Calendar: buton „Sărbători legale România" (`roHolidays(an)`, Paște ortodox calculat).
- Dialogul „Activitate nouă": durata începe goală și e obligatorie; data de start implicită = începutul proiectului (`defaultNewStart()`); „+ Capitol" = `addChapter()`.
- `alignPanes()` (gantt.js): egalează înălțimea antetului din stânga cu zona de deasupra primului rând din dreapta (bară de unelte + luni + zile) și spațiul de jos, ca rândul din tabel și bara din Gantt să fie MEREU pe aceeași linie orizontală. Se apelează la finalul `renderAll()` și la redimensionare (ResizeObserver). Nu fixa înălțimi de antet în CSS.
- „Nume lângă bară": `showSideNames` / `toggleSideNames()` (buton în Vizualizare), numele ca element `.bar-side` în rândul Gantt.

## Funcții MS Project adăugate

- **Teste de regresie:** `tests/regression.js` (în pagina aplicației, deschisă la ~1360×800): în consolă `eval(await (await fetch('tests/regression.js')).text())` → `{total, passed, failed, errors}`. Rulează-l după ORICE modificare; adaugă teste pentru orice funcție nouă. Fixturile din `tests/fixtures/` sunt fișiere Excel reale (salvate de Excel).
  - În browserul de test, la schimbarea fișierelor: dezînregistrează service worker-ul, șterge cache-urile, `fetch(f,{cache:'reload'})` pentru fiecare fișier (și citește corpul), apoi reîncarcă; altfel rulează cod vechi.
- `recomputeAll()` (main.js) = doar calculele (legături, capitole, CPM, ALAP, resurse, avertismente); `renderAll()` = recomputeAll + desenare. Funcțiile care încearcă variante de plan (nivelare, „Actualizează planul") folosesc `recomputeAll()`.
- **Date la nivel de proiect:** `META = { sdate }` (data de status; `null` = azi). Se salvează cu proiectul (`tab.meta`, JSON, fișier, undo). Orice dată nouă la nivel de proiect se adaugă în: `syncTabData`, `loadTabData`, `addNewTab`, `pushHistory/undo/redo`, `exportJSON`, `importJSONasTab`, `_projectJSON`, `_openHandle`.
- **Progres real (plan.js):** `t.as` / `t.af` (început / final real, doar activități). `statusDay()` = data de status sau azi; `isBehind`, `_statusOf` o folosesc. `_syncActuals` completează / scoate datele reale când se schimbă progresul. „Actualizează planul" (`_scanActuals`) fixează activitățile la datele reale prin restricții `cons.ac = true` (MSO / SNET) și prelungește activitățile în desfășurare rămase în urmă; se anulează cu `clearActualPins`.
- **Filtre (filters.js):** `FILTER`, `viewRows()` (= `flat()` fără filtru). Tabelul, Gantt-ul și navigarea cu săgeți folosesc `viewRows()`, nu `flat()`. Cu filtru pornit, mutările de structură și ștergerea capitolelor sunt blocate (`structLocked()`); adăugarea oprește filtrul.
- **Tipărire (print.js):** previzualizare cu pagini de hârtie construite din HTML-ul Gantt-ului capturat la scara potrivită; tabelul din pagină e generat separat; `@media print` afișează doar `#printPreview`. Tema e mereu luminoasă pe hârtie (se scoate `body.dark` cât timp e deschisă).
- **Excel / CSV (xlsx.js, sheets.js):** `xlsxBuild` / `xlsxRead` (ZIP „store" la scriere, `DecompressionStream` la citire), `csvParse` / `csvBuild`. Fără linie `sep=` în CSV (ar anula BOM-ul și diacriticele); separatorul se alege după setările regionale (`csvDelimiter()`). Importul recunoaște titluri românești / englezești (`SH_MAP`, `SH_FUZZY`).
- **Resurse (resources.js):** tab „Utilizare" (ore pe perioade), nivelare = planificare în serie (`_levelRun`): ordine după rezerva minimă, fiecare activitate pe prima fereastră liberă; restricțiile create au `cons.lv = true` și `cons.o` (data inițială) → `clearLeveling`.
- **Cronologie (timeline.js):** vedere `view === 'timeline'`; ignoră filtrele; click pe bară → Gantt.
- Restricții create de aplicație (`cons.ac`, `cons.lv`) se pot recunoaște și elimina fără să se atingă cele puse de utilizator.

## Revizuirea codului (corectitudine, securitate, date)

- **Rulare teste fără consolă:** `tests/runner.html` (încarcă aplicația într-un iframe și rulează `regression.js`). Headless: `msedge --headless=new --window-size=1360,800 --virtual-time-budget=240000 --dump-dom http://localhost:8000/tests/runner.html` → citește `#out`. Serverul trebuie pornit din folderul `gantt-pro`.
- **Date din fișiere = nesigure:** `_sanitizeTasks` (activități), `setCal` (zile libere doar ISO valide), `setRes` (tipuri, numere, texte curate) normalizează la încărcare. `plainText(s,max)` scoate `<>"'&\`` din moneda / unitatea resurselor; `validISO(s)` verifică date. `esc()` scapă și apostroful. Orice câmp nou din fișier: validează-l în sanitizare și `esc()` la afișare.
- **Salvare în browser:** `saveAllTabs()` programează, `flushSave()` scrie (se apelează și la `pagehide` / `visibilitychange`). Dacă `localStorage` refuză, bara de stare și un toast avertizează; datele stricate se păstrează în `ganttPRO_tabs_corrupt`.
- **Index de căutare:** `recomputeAll()` rulează sub `withIndex()`; în acest interval `kids()` / `taskById()` sunt O(1). Nu schimba structura lui `T` (adăugare / ștergere / `pid`) în interiorul recalculării. `computeCPM` folosește un tabel cumulat de zile lucrătoare.
- **CPM și capitole:** o legătură către un capitol se aplică frunzelor lui (FS/FF: toate; SS/SF: cele care încep primele). Progresul capitolului e ponderat cu durata copiilor.
- **Mutare bară cu legături:** `lagFromMove(t)` transformă mutarea într-un lag pe legătura dominantă (minim 0, nu creează suprapuneri din greșeală); `depStart(t,d,lag)` e formula comună de programare.
- **Selecție fără redesenare:** `refreshSelection()` (gantt.js) schimbă doar clasele rândului / barei, săgețile evidențiate și fila Format (în Arbore face `renderAll`). `selTask`, `setSel`, `deselectAll`, click pe bară și meniul click-dreapta o folosesc. `renderAll()` desenează sub `withIndex()` (căutări O(1)) — nu schimba structura lui `T` în funcțiile de desenare.
- **Editare:** „Lipește" pune copia sub rândul selectat, la același nivel (`insertAfterBlock`); activitatea nouă din dialog intră sub rândul selectat; ștergerea unui capitol cere confirmare; istoricul Ctrl+Z e păstrat pe fiecare filă (`_histByTab`); editările din foaia de resurse sunt pași de anulare; reperele se pot marca „atinse" (`markDone`) și apar ca întârziate dacă data lor a trecut (`isBehind`).
- **Undo:** instantaneele identice nu se dublează; plafon `MAX_HISTORY` și `MAX_HISTORY_CHARS`.
- **Accesibilitate:** `initA11y()` (main.js) pune `role="dialog"`, mută focusul la deschiderea ferestrelor și îl readuce la închidere.

## Design (ramura curentă)

- **Sus (stil MS Project):** fila Vizualizare conține vederile (Gantt / Arbore / Cronologie, etichetate); rândul de sub panglică are doar file de proiecte; „Legendă" și „Tot ecranul" sunt butoane rapide sus-dreapta (`#ganttTools`, doar în Gantt). Grupurile din panglică au titluri prin `data-cap` (CSS `::after`). Orice buton nou în fila Vizualizare: verifică testul de lățime la 1360 px.
- **Tabel:** prima coloană = ID (nr. rând, `rowIds()`); codul WBS e prefix înaintea numelui (`showWbs` / `toggleWbs()`, buton „WBS" în Vizualizare). Dependențele se scriu tot cu coduri WBS.
- **Detalii activitate:** panoul din Arbore, fereastra Task Info și bara de informații (doar în Gantt pe tot ecranul) folosesc aceleași denumiri; `tests/regression.js` le leagă între ele.
- **Bare Gantt:** `barStyle` = `"new"` (implicit) | `"classic"` (`toggleBarStyle()`, butonul ✦ din Vizualizare › Afișare, salvat în `ganttBarStyle`). Stilul Nou = `body.bars-new`: bare plate (16 px), culoare după stare (`st-todo` / `st-wip` / `st-done` / `crit`), nume întreg în bară dacă încape, altfel `.bar-side` lângă ea; sub 4 px/zi (`zoom-micro`) bare-pilulă, numele doar la hover.
- **Dimensiune tabel + Gantt:** Ctrl +/−/0 și Ctrl+rotiță (peste tabel / grafic) setează `ZF` (0.6–2.0, pași în `CZ_LEVELS`) prin CSS `zoom` doar pe `#splitView`; panglica / filele / bara de stare nu se scalează; salvat în `ganttContentZoom`; indicator „Dimensiune" în bara de stare (click = 100%). **Regulă:** orice calcul care transformă mișcarea mouse-ului (clientX / clientY, px de ecran) în zile sau px din Gantt trebuie împărțit la `ZF` (vezi tragerea barelor, redimensionarea coloanelor, separatorul, `_cursorToInner`, `alignPanes`); `getBoundingClientRect` e în px de ecran, iar `offsetWidth` / `scrollLeft` în px locali.
- **Layout la zoom de pagină / ferestre înguste:** panoul din stânga are `width:clamp(480px,46vw,600px)` (fără lățime inline; separatorul o poate seta); coloana „Activitate” e elastică (`NAME_MIN`, `_cmin`) ca „După” să nu mai fie tăiată; coloanele suplimentare (`col-var` etc.) se văd DOAR cu panoul extins; prefixul WBS dispare sub 540 px (container query); bara de stare ascunde „Medie” / „Durată” pe ferestre înguste. Pentru verificări vizuale: `msedge --headless=new --window-size=<css w>,<css h> --force-device-scale-factor=<zoom>` (lățimea ferestrei e în px CSS).
- **Atenție la editări automate:** nu rescrie fișiere cu `perl -0pi` când înlocuirea conține caractere non-ASCII (strică diacriticele); folosește uneltele de editare. Panglica, filele și bara de stare NU se scalează cu Ctrl +/− (doar tabelul + Gantt-ul); mărimea lor are scala proprie (rândul de mai sus).
- **Mărimea panglicii / filelor / barei de stare:** `--ui-zoom` (CSS zoom pe `.ribbon`, `.tabs-row`, `.sbar`); automat = `min(lățime/1600, înălțime/650)` între 1 și 1.8 (deci crește singură pe ecrane mari sau când micșorezi pagina din browser); manual cu A− / A+ (sus-dreapta) sau Ctrl+Alt +/−/0, salvat în `ganttUiScale`. Elementele `position:fixed` din panglică (ex. `.rb-menu`) trebuie să-și împartă coordonatele de ecran la `uiScale()` (vezi `toggleDD`).
## Valoare realizată (EVM) — `js/evm.js`
- Fereastra „Valoare realizată (EVM) și curba S": Proiect › Urmărire › „Valoare realizată". `computeEVM()` calculează la data de status (`statusDay()`): BAC, PV, EV, AC, SV, SPI, CV, CPI, EAC, ETC, VAC, curba S și tabelul pe capitole.
- Modelul: valoarea unei activități = `t.bl.cost` (costul din momentul salvării liniei de bază) sau, dacă lipsește, costul curent din resurse (`costMap`); fără costuri în proiect se folosește durata (zile lucrătoare). PV = liniar în zile lucrătoare pe intervalul liniei de bază; EV = valoare × `t.prog`; AC = `t.acost` (cost real introdus în Detalii activitate › Resurse și cost) sau, dacă lipsește, EV.
- Indicatorii de COST (CV, CPI, EAC, ETC, VAC) apar doar dacă măcar o activitate are `t.acost` (altfel CPI ar fi mereu 1). Istoricul EV / AC din curba S e o estimare liniară.
- Câmpuri noi pe activitate: `acost` (număr ≥ 0) și `bl.cost`; ambele sunt validate în `_sanitizeTasks`.

## Flux de lucru

- După orice modificare de cod în `js/`, `index.html`, `sw.js` sau `tests/`, rulează agentul `reviewer` (`.claude/agents/reviewer.md`) pe modificare, **înainte de commit**.
- Verifică fiecare constatare direct în cod: corectează ce e real și ignoră ce e fals pozitiv.
- Rulează apoi `tests/regression.js` (headless, prin `tests/runner.html`) și adaugă teste pentru orice funcție nouă.
- La modificări mici (doar text, culori, CSS) reviewer-ul nu e obligatoriu.
- Commit-ul se face doar după ce testele trec.
- Nu folosi `git add -A`: adaugă în commit doar fișierele modificate de tine (`git add <fișier>`). Folderul `Claude outputs/` (fișiere descărcate din chat) e în `.gitignore`.

## Șabloane de proiect și tur ghidat (`js/templates.js`, `js/tour.js`)
- **Șabloane:** `PROJECT_TEMPLATES` (3: Construcții, Dezvoltare software, Organizare eveniment); elemente `{k, nm, p, dur, ms, d}` (vezi comentariul din fișier). `newFromTemplate(id)` → `addNewTab(...)`, deci trec prin `_sanitizeTasks` ca orice fișier încărcat. Cardurile din ecranul de bun venit: `renderTemplateCards()` (apelat din `updateEmptyState`). Un șablon nou: adaugă-l în listă; testele verifică automat numărul de activități (10–15), capitolele (2–3), ciclurile, datele și sanitizarea.
- **Tur:** `TOUR_STEPS` (6 pași), `startTour()` / `tourGo(i)` / `tourClose()`; pornește singur o dată la prima deschidere a unui proiect (flag `ganttTourDone`, `maybeStartTour()` din `addNewTab` și de la pornire); `?notour` în adresă îl oprește (folosit de `tests/runner.html`); butonul „Ghid" din Vizualizare îl repornește. Cadrul și caseta sunt elemente din `<body>` (nescalate), iar pozițiile vin din `getBoundingClientRect` (px de ecran), deci NU se împarte la `ZF` / `uiScale()`; dacă muți cadrul într-un element scalat, împarte. Cât timp turul e activ, tastele nu ajung la aplicație (handler în captură); la închidere se restaurează fila de panglică, vederea, ecranul complet, panglica restrânsă și focusul.
- **Titluri:** fiecare buton din panglică are `title` cu explicație + scurtătura (dacă există); la butoane noi, la fel (și la elementele din meniurile `.rb-menu`).

## Funcții MS Project — lotul 1 (analiza completă: `Claude outputs/analiza-ms-project.md`)
- **Selecție multiplă** (indent / outdent pe mai multe rânduri: `_multiStruct` + `selRoots()`, un singur pas de anulare): `sel` = rândul activ; `msel` (Set) = toate rândurile selectate, valabilă doar cât îl conține pe `sel` (`_multiOn()`); `selIds()` le dă în ordinea schemei, `isSelId(id)` la desenare. `selTask(id, event)`: click / Ctrl+click / Shift+click (interval din `viewRows()` de la `_selAnchor`); Ctrl+A = `selectAllRows()`. `setSel` / `deselectAll` / `renderAll` / `refreshSelection` curăță selecția multiplă învechită (`clearMulti()`). Acțiuni pe selecție: `delSel` (confirmare), `linkSelected` (lanț FS, Ctrl+F2), `unlinkSelected` (doar legăturile dintre rânduri, Ctrl+Shift+F2), `setProgSel` / `markOnTrack` (fila Format › Progres). Copierea / tăierea rămân pe un rând.
- **Sortare:** `sortTasks(key, desc)` (`SORT_KEYS`) reordonează `T` stabil → fiecare capitol își sortează rândurile, structura rămâne; pas de anulare. Butonul e în Activitate › Structură (în Vizualizare nu mai e loc la 1360 px).
- **Mută proiectul:** `moveProject(iso, moveDeadlines)` (plan.js) mută cu aceleași zile lucrătoare startul, restricțiile (`cons.date`, `cons.o`), termenele și datele reale; linia de bază și data de status rămân. O dată pe zi nelucrătoare se aliniază întâi la ziua lucrătoare următoare.
- **Pe drum:** `onTrackPct(t)` = zilele lucrătoare până la data de status (inclusiv) / durată.
- **Import MS Project (XML):** `_parseMSProjectXML(text)` (toolbar.js) → `{name, tasks, cal, res, meta, fileStart, warn}`; `importMSProjectText(text)` deschide o filă nouă (trece prin `_sanitizeTasks` / `setCal` / `setRes`) și avertizează dacă vreo activitate are alt start decât în fișier. Citește doar copiii direcți (`kidsOf`), ierarhia din `OutlineLevel`, decalajul din zecimi de minut (`MinutesPerDay`), calendarul proiectului cu lanțul de calendare de bază (`BaseCalendarUID`), excepțiile nelucrătoare (WeekDay `DayType 0` și `Exceptions` zilnice). SNET la start pe activități fără legături nu devine restricție; capitolele păstrează doar FS / SS; atribuirile cu resursa `-65535` se ignoră. Fixturi reale salvate de MS Project: `tests/fixtures/msproject-saved*.xml`.
- **Exportul MS Project** nu mai pune `CalendarUID` pe resurse (cu `1` MS Project redenumea calendarul proiectului după resursă). **Costurile (`Cost` pe linia de bază și pe atribuiri) sunt în BANI (×100)** în MSPDI, verificat pe fișierul salvat de MS Project; tarifele (`StandardRate`) sunt în monedă pe oră. Importul plafonează durata / decalajul (36 500 zile) și zilele libere (20 000), tratează durata 0 ca reper și avertizează la decalaje în procente, calendaristice sau în ore.
- **Coloane (ca „Insert Column"):** `CX_POOL` (gantt.js) = toate coloanele suplimentare; `CX` = cele alese (`setCols(keys)`, salvat în `ganttCols`; implicit `CX_DEFAULT`); meniul: click dreapta pe antet sau butonul ⋯ (`openColMenu` / `toggleCol`). Se văd doar cu tabelul extins (clasa `col-x`); o coloană bifată cu tabelul restrâns îl extinde. Valorile calculate vin din `colVal(k, t)` (la capitole: min / max / sumă peste frunze); `as` / `af` rămân editabile. `cpm[id].free` = rezerva liberă (computeCPM). O coloană nouă: adaug-o în `CX_POOL` + `colVal` și scapă textul cu `esc()`.
- **Grupare (ca „Group by"):** Vizualizare › Filtru › „Grupează după" (critic / stare / resurse / capitol / luna de start / repere). `GROUP` (filters.js), `_groups()` = grupuri cu subtotaluri, `viewList()` = titluri de grup + activități (folosit de tabel, Gantt și tipărire); `viewRows()` rămâne DOAR activitățile vizibile (selecție, săgeți, Ctrl+A). Titlurile de grup sunt obiecte `{_grp:true, id<0, k, nm, n, sd, dur, prog, cost}`: orice buclă nouă peste `viewList()` trebuie să le sară (`if (t._grp)`). Cât e pornită, structura e blocată (`structLocked`); adăugarea o oprește (`stopFilterForEdit`); schimbarea proiectului o oprește (`clearFilter(true)`); închiderea unui grup scoate rândurile lui din selecție.

## Lotul 2 — calendare și timp
- **Calendare multiple:** `CAL.cals = [{id, nm, days, hol, inh}]` (Proiect › Calendar: lista „Calendarul”, ＋ Nou, 🗑; `inh` = respectă și zilele libere ale proiectului); activitatea îl alege în Detalii › Calendar (`t.cal`). **Concediile** unei resurse de muncă: `r.off = [ISO]` (foaia de resurse › Concediu).
- **Motor:** `isWork` citește calendarul curent `_CUR`; `withCal(c, fn)` îl schimbă temporar (try/finally, se poate imbrica); `calOf(t)` = calendarul activității (al ei sau al proiectului) minus concediile resurselor atribuite (cache golit în `_recomputeAll` și `setCal`); `endDate(t)` e mereu în calendarul activității. **Regulă:** orice calcul de zile lucrătoare PENTRU O ACTIVITATE (`nextWork` / `addWorkDays` / `workDur` / `isWork`) se face în `withCal(calOf(t), …)` — vezi `_schedOne`, `depStart`, `lagFromMove`, încărcarea / nivelarea, Detalii, tragerea barelor. Capitolele și indicii la nivel de proiect rămân pe calendarul proiectului. CPM măsoară activitățile cu calendar propriu în zilele proiectului (start → ziua de după final).
- **MS Project:** calendarele suplimentare ies ca alte calendare de bază (UID 2…), resursele cu concediu primesc un calendar derivat din „Standard” (UID 1000+id); `CalendarUID` pe activitate e după `ConstraintType`. La import se păstrează doar calendarele de bază folosite de activități; zilele libere în plus din calendarul unei resurse devin concediu.
- **Durate cu unitate:** `parseDur(text)` (data.js) → zile lucrătoare întregi (fracțiunile se rotunjesc; săptămâna = zilele lucrătoare din calendarul PROIECTULUI, nu al activității) sau null: „5” / „5z”, „2s” / „2 săpt” / „2w” (× zilele lucrătoare din săptămâna proiectului), „1l” / „1 lună” / „1mo” (× 20), „16h” / „16 ore” (÷ 8, în sus). Câmpurile de durată (tabel `.in-dur`, Detalii `tiDur`, dialogul nou `atDur`) sunt `type="text"` și citesc cu `parseDur`; `upd('dur')` refuză textul greșit ÎNAINTE de pasul de anulare.
- **Decalaj în procente:** legătura `{id, type, lag, pct:true}` = `lag` % din durata predecesorului (ex. „1.2SS+50%”, fereastra legăturii › „% din predecesor”). Orice calcul folosește `lagDays(d)` (zile, rotunjit — MS Project păstrează fracțiunea, deci startul poate diferi cu o jumătate de zi), nu `d.lag`: programare, `lagFromMove` (mutarea cu mâna îl transformă în zile), CPM. **MS Project scrie procentul simplu:** `LinkLag 50` + `LagFormat 19` (verificat salvând din MS Project, fixtura `tests/fixtures/msproject-saved-cal.xml`); exportul și importul folosesc același format.

## Lotul 3 — rapoarte (`js/reports.js`, Proiect › Urmărire › Rapoarte)
- Fereastra `repModal` cu 4 file (`_repTab`): **Prezentare** (`_repOverview`: indicatori, repere următoare, întârziate, capitole), **Flux de numerar** (`cashFlow()` → luni cu plan / bază / real + cumulat; costul fiecărei activități împărțit egal pe zilele ei lucrătoare, în calendarul ei; grafic SVG + `exportCashCSV`), **Următoarele săptămâni** (`upcomingTasks(weeks)` de la data de status, pe săptămâni de luni până duminică, plus restanțele), **Comparare** (`compareProjects(src)`: `'bl'` = linia de bază sau id-ul altui proiect deschis; potrivire după id, apoi după nume; tipuri add / del / start / fin / dur / prog / nm).
- Rapoartele nu schimbă datele; tot textul utilizatorului trece prin `esc()`. Tipărirea (`printReport`) pune `body.rep-print` (CSS `@media print` arată doar fereastra, temă luminoasă) și îl scoate la `afterprint`.
