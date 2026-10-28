# Gantt PRO

A browser-based project scheduling app inspired by MS Project. It runs entirely in the browser, with no server and no install, and can be installed as an app (PWA).

*Versiunea în română este mai jos.*

## Features

- **Interactive Gantt chart:** drag and resize bars, WBS hierarchy, zoom, full-screen mode.
- **Full dependency model:** FS, SS, FF and SF links with lag/lead and automatic scheduling.
- **Critical path (CPM):** critical tasks highlighted on the chart and in the tree, with total float per task.
- **Work calendars:** configurable working days and holidays, per project.
- **Tree view:** collapsible WBS, zoom, focus on a branch, drag to reorganize.
- **Export:** JSON, PNG, PDF and MS Project XML.
- **Dark mode**, multiple projects in tabs, undo/redo, autosave to the browser.

## Getting started

Open `index.html` in Chrome or Edge. A demo project ("Industrial Hall Construction") loads on first launch, and your data is saved automatically in the browser.

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
| `files.js` | Import and export (JSON, PNG, PDF, MS Project XML) |
| `toolbar.js`, `main.js` | Ribbon UI and app startup |

---
