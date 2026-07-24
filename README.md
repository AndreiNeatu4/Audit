# EU Accessibility Checker

A web interface where you paste a website URL and it checks whether the page
follows the **EU accessibility directive**, showing **Pass / Fail / Manual review**
for every technical requirement.

## What "EU directive" means here

| Law | Points to | For web content means |
|-----|-----------|-----------------------|
| Web Accessibility Directive (EU) 2016/2102 | EN 301 549 | WCAG 2.1 Level A + AA |
| European Accessibility Act (EU) 2019/882 | EN 301 549 | WCAG 2.1 Level A + AA |

EN 301 549 clause **9** adopts the **WCAG 2.1 Level A + AA** success criteria and
numbers them `9.<wcag-number>` (e.g. WCAG `1.4.3` → EN 301 549 `9.1.4.3`).
This tool checks all **50** of those criteria.

## How it works

- **Backend** (`server.js` + `lib/`): loads the page in a headless Chromium
  browser via **Playwright**, then runs the **axe-core** accessibility engine.
- It scans the page at several **screen resolutions and DPI levels** (desktop,
  laptop, tablet @2x, mobile @3x). A requirement fails if it fails at *any* resolution.
- Results are mapped from axe rules back to WCAG success criteria / EN 301 549 clauses.
- **Frontend** (`public/`): plain HTML/JS — a URL box and a full checklist table.

### Honest limitations

Automated tools can reliably verify roughly **30–50%** of WCAG criteria (contrast,
alt text, labels, ARIA, structure…). The rest require human judgement and are shown
as **Manual review** — never faked as a pass. A clean automated report is *not* a
guarantee of legal conformance.

## Setup (Windows / PowerShell)

```powershell
npm install            # installs deps and downloads the Chromium browser
npm start              # starts the server
```

Then open <http://localhost:3000> and paste a URL.

## Extending it

- **More screen profiles / DPIs:** edit `PROFILES` in `lib/analyze.js`.
- **More detail per criterion:** the axe `passes` / `incomplete` / `violations`
  are already aggregated in `lib/analyze.js`.
- **Multi-page crawl, PDF export, scheduled scans, screenshots per resolution:**
  the backend returns structured JSON from `/api/scan`, so any of these can be
  layered on without touching the analysis core.
```
