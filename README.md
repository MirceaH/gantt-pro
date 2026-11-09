# Gantt PRO

A browser-based project scheduling app inspired by MS Project. It runs entirely in the browser, with no server and no install, and can be installed as an app (PWA).

*Versiunea în română este mai jos.*

## Features

- **Interactive Gantt chart:** drag and resize bars, WBS hierarchy, zoom, full-screen mode.
- **Full dependency model:** FS, SS, FF and SF links with lag/lead and automatic scheduling.
- **Critical path (CPM):** critical tasks highlighted on the chart and in the tree, with total float per task.
- **Work calendars:** configurable working days and holidays, per project.
- **Tree view:** collapsible WBS, zoom, focus on a branch, drag to reorganize.
- **Progress tracking:** status date, actual start/finish per task, a thin "actual" bar on the Gantt, and "Update plan" to move the schedule to reality.
- **Filters:** show only critical, late, unfinished, in-progress, milestones, a resource, a date range or a name (table and Gantt stay aligned).
- **Resources:** costs, budget, load charts, an hours-per-period usage table and one-click **resource leveling** (undoable).
- **Earned value (EVM):** PV, EV, AC, SPI, CPI and the S-curve.
- **Project templates** and a **guided tour** on first use.
- **Timeline view:** the whole project on one page for presentations, exportable as an image.
- **Print / PDF:** paged print preview (A4, A3, Letter) with the table and Gantt side by side.
- **Excel / CSV:** export `.xlsx` (real dates, filters, resources sheet) or CSV; import a task list from Excel or CSV.
- **Export:** JSON, PNG, PDF, Excel, CSV and MS Project XML.
- **Dark mode**, multiple projects in tabs, undo/redo, autosave to the browser.

## Getting started

Open `index.html` in Chrome or Edge. On first launch a welcome screen lets you start a new project, open a project file or load an example ("Industrial Hall Construction"). Your data is saved automatically in the browser.

To install it as an app, serve it from a web server (for example GitHub Pages) and click "Install" in the address bar.

## Tech stack

Plain HTML, CSS and JavaScript: no framework and no build step. The code is split into modules by responsibility:

| Module | Responsibility |
| --- | --- |
| `gantt.js` | Timeline rendering and bar interaction |
| `deps.js` | Dependency links and arrows |
| `cpm.js` | Critical path method and float calculation |
| `plan.js`, `calendar.js`, `dates.js` | Automatic scheduling and working-day calendars |
| `tree.js` | WBS tree view |
| `files.js` | Save/open project files on disk, recent files |
| `filters.js` | Row filters shared by the table and the Gantt |
| `resources.js` | Resources, costs, load, usage table, leveling |
| `print.js` | Paged print preview and PDF |
| `xlsx.js`, `sheets.js` | Excel (.xlsx) and CSV export/import, no external libraries |
| `timeline.js` | One-page timeline view |
| `evm.js` | Earned value management and S-curve |
| `templates.js`, `tour.js` | Project templates and the guided tour |
| `tests/regression.js` | Regression tests (run in the page, see CLAUDE.md) |
| `toolbar.js`, `main.js` | Ribbon UI and app startup |

---

# Gantt PRO (română)

Aplicație web de planificare a proiectelor, inspirată de MS Project. Rulează în întregime în browser, fără server și fără instalare, și poate fi instalată ca aplicație (PWA).

## Funcții

- **Gantt interactiv:** bare care se trag și se redimensionează, ierarhie WBS, zoom, ecran complet.
- **Dependențe complete:** legături FS, SS, FF și SF cu decalaj, cu programare automată.
- **Drum critic (CPM):** activitățile critice sunt evidențiate în grafic și în arbore, cu rezerva totală pe activitate.
- **Calendare de lucru:** zile lucrătoare și zile libere configurabile, pentru fiecare proiect.
- **Vedere arbore:** WBS pliabil, zoom, focalizare pe o ramură, tragere pentru reorganizare.
- **Urmărirea progresului:** data de status, început / final real pe activitate, bara „reală” din Gantt și „Actualizează planul” pentru a muta planul la realitate.
- **Filtre:** arată doar activitățile critice, întârziate, nefinalizate, în lucru, reperele, o resursă, un interval de date sau un nume (tabelul și Gantt-ul rămân aliniate).
- **Resurse:** costuri, buget, grafice de încărcare, tabel de utilizare pe perioade și **nivelare** a resurselor dintr-un click (anulabilă).
- **Valoare realizată (EVM):** PV, EV, AC, SPI, CPI și curba S.
- **Cronologie:** tot proiectul pe o singură pagină pentru prezentări, exportabil ca imagine.
- **Tipărire / PDF:** previzualizare pe pagini (A4, A3, Letter), cu tabelul și Gantt-ul alăturate.
- **Excel / CSV:** export `.xlsx` (date reale, filtre, foaie de resurse) sau CSV; import de listă de activități din Excel sau CSV.
- **Export:** JSON, PNG, PDF, Excel, CSV și MS Project XML.
- **Șabloane de proiect** și un **tur ghidat** la prima utilizare.
- **Mod întunecat**, mai multe proiecte în file, anulare / refacere, salvare automată în browser.

## Pornire

Deschide `index.html` în Chrome sau Edge. La prima pornire, ecranul de bun venit îți propune un proiect nou, deschiderea unui fișier, un șablon sau un exemplu („Construcție hală industrială”). Datele se salvează automat în browser.

Ca s-o instalezi ca aplicație, servește-o de pe un server web (de exemplu GitHub Pages) și apasă „Instalează” în bara de adrese.

## Tehnologie

HTML, CSS și JavaScript simplu: fără framework și fără pas de build. Modulele sunt descrise în tabelul de mai sus; regulile de lucru și arhitectura detaliată sunt în `CLAUDE.md`.
