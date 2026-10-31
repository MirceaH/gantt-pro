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
| `tests/regression.js` | Regression tests (run in the page, see CLAUDE.md) |
| `toolbar.js`, `main.js` | Ribbon UI and app startup |

---
