# Gantt PRO - Modular

Aplicație web **vanilla HTML/CSS/JS** (fără build system, fără framework) pentru planificare proiect — Gantt interactiv inspirat MS Project / WBS Schedule Pro.

## Rulare
Static site. Server local: `python -m http.server 8000` (config în `.claude/launch.json`).

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
SF: succ.start = pred.start + lag - succ.dur + 1
```

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

**Prog-handle** = mâner vertical alb pe **mijlocul orizontal** al barei, `z-index:25` (deasupra dep-dot). Vizibil subtil pe bar-hover, prominent pe handle-hover.

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
`FS=1, SS=3, FF=0, SF=2`. Lag convertit în minute: `lag_zile * 480` (8h/zi).

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
