# EU Accessibility Checker

A web interface where you paste a website URL and it checks whether the page
follows the **EU accessibility directive**, showing **Pass / Fail / AI-suggested /
Manual review** for every technical requirement.

## What "EU directive" means here

| Law | Points to | For web content means |
|-----|-----------|-----------------------|
| Web Accessibility Directive (EU) 2016/2102 | EN 301 549 | WCAG 2.1 Level A + AA (currently in force, V3.2.1) |
| European Accessibility Act (EU) 2019/882 | EN 301 549 | WCAG 2.1 Level A + AA (currently in force, V3.2.1) |

EN 301 549 clause **9** currently (V3.2.1, in force) adopts **WCAG 2.1 Level A + AA**.
ETSI's **draft EN 301 549 V4.1.0** (2025-11, expected publication 2026-10) updates
clause 9 to **WCAG 2.2 Level A + AA** instead — six criteria added (Focus Not
Obscured, Dragging Movements, Target Size, Consistent Help, Redundant Entry,
Accessible Authentication), and the obsolete 4.1.1 Parsing criterion removed.

**This tool follows that forward direction and checks the full WCAG 2.2 set**
(**55** criteria, numbered `9.<wcag-number>`, e.g. WCAG `1.4.3` → EN 301 549
`9.1.4.3`), so a report stays valid once V4.1.0 is finalised rather than only
covering the older WCAG 2.1 baseline.

## How it works

- **Backend** (`server.js` + `lib/`): loads the page in a headless Chromium
  browser via **Playwright**, then runs **two independent accessibility engines**
  against it:
  - **axe-core** (via `@axe-core/playwright`) — tagged `wcag2a/aa`, `wcag21a/aa`,
    `wcag22a/aa`, plus `best-practice`.
  - **HTML_CodeSniffer** (`html_codesniffer`, Squiz Labs) — a separately built,
    non-axe-based engine, injected into the same page and run against `WCAG2AA`.
  Different engines catch different issues, so a finding from *either* engine
  counts — this raises automated coverage beyond what axe-core alone would find
  (verified: HTML_CodeSniffer alone caught an `1.3.1 Info and Relationships`
  violation axe-core missed in testing).
- It scans the page at several **screen resolutions and DPI levels** (desktop,
  laptop, tablet @2x, mobile @3x), running *both* engines at each. A requirement
  fails if it fails at *any* resolution, from *either* engine.
- Results are mapped from rule tags/codes back to WCAG success criteria / EN 301 549
  clauses (axe via its `wcagXXX` tags, HTML_CodeSniffer via the SC number embedded
  in its message code, e.g. `WCAG2AA.Principle1.Guideline1_4.1_4_3.G18` → `1.4.3`).
  Each reported issue is labelled with which engine (`axe-core` / `HTML_CodeSniffer`)
  found it.
- axe's `best-practice` rules (e.g. landmarks, heading structure) aren't part of the
  55 WCAG 2.2 criteria, so they're reported separately as `extraFindings` — shown in
  the UI under "Additional recommendations", not counted in the pass/fail totals.
- **Frontend** (`public/`): plain HTML/JS — a URL box and a full checklist table.

### Crawl an entire site

The **"Crawl site"** tab (`lib/crawl.js` + `GET /api/crawl`) runs the same full scan across
every page it can reach from a starting URL, not just one:

- Discovers links by reading `<a href>` on each page it scans (via the same loaded-page
  Playwright context, no extra page loads) and follows **same-origin** links
  **breadth-first**, skipping non-HTML file types (images, PDFs, stylesheets, etc.).
- Respects `robots.txt` (`Disallow` rules for `User-agent: *`) — best-effort, fails open if
  `robots.txt` can't be fetched.
- Bounded by **Max pages** (default 20) and **Max link depth** (default 2) set in the UI, so
  a crawl can't run away on a large site.
- Reuses **one Chromium instance** across the whole crawl (`analyzePageWithBrowser` in
  `lib/analyze.js`) instead of relaunching a browser per page.
- Streams results as they complete via **Server-Sent Events** (`GET /api/crawl`, since
  `EventSource` requires GET) — the UI shows each page's pass/fail/manual counts as soon as
  it's scanned, with the full per-criterion table expandable per page, rather than blocking on
  a spinner until the entire crawl finishes.
- Produces a **site-wide summary**: totals across every page × criterion, and a
  "criteria failing on the most pages" ranking — useful for prioritising fixes that recur
  across templates (e.g. a shared header/footer issue) over one-off page content problems.
- Closing the browser tab (client disconnect) aborts the crawl server-side rather than
  continuing to scan pages nobody is watching.

### AI-assisted review (optional, off by default)

Some criteria are inherently judgement calls no rule engine can decide — e.g. "is
this alt text meaningful," "is this error message clear," "do these headings
actually describe their sections." Set `ANTHROPIC_API_KEY` and this tool will send
a screenshot + HTML excerpt for exactly those still-unresolved criteria to Claude
(`lib/aiReview.js`) and ask for a best-effort suggestion.

This produces a **fourth, distinct status: `ai_suggested`** — it is never merged
into Pass/Fail. Every AI-suggested row shows the model's verdict, its own stated
confidence, and its reasoning, plus an explicit "not a substitute for a human
accessibility review" warning. The model is told to answer `insufficient_evidence`
(which falls straight back to plain "Manual review") whenever it can't actually
tell from a screenshot and HTML — timing behaviour, audio/video quality, and
cross-page consistency are called out specifically as things it can't judge. The
page HTML fed to the model is also explicitly labelled as untrusted content in the
prompt, since a hostile page could otherwise try to prompt-inject the reviewer.

Without `ANTHROPIC_API_KEY` set, this step is skipped entirely and the tool behaves
exactly as before — no new dependency, no behaviour change, no cost.

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."   # enable AI-assisted review for this session
npm start
```

**This does not mean 100% automated accuracy or "no manual checking" is achievable
— it isn't, for any tool.** WCAG defines a large share of its criteria in terms of
human-perceptible quality, not machine-checkable syntax, so there will always be a
real "Manual review" (and, even with AI, an "AI-suggested — unconfirmed") bucket.
Article 15 of the directive grants only a *presumption* of conformity for sites
meeting EN 301 549 in full — never a certification from automated tooling alone.

### Possible further additions

Not currently wired in, but worth considering if even more automated coverage is
needed: **IBM Equal Access Accessibility Checker** (a third independent rule
engine — skipped here because its results don't expose a clean WCAG
success-criterion number per rule, so mapping it into this tool's criteria model
reliably would need a hand-built rule→SC lookup table) and **Google Lighthouse's
accessibility category** (skipped because it wraps a subset of axe-core rules, so
it adds a score but little genuinely new detection beyond what's already covered
here). **Guidepup** (screen-reader automation for NVDA/VoiceOver) could turn a few
more currently-manual criteria (e.g. focus order, name/role/value edge cases) into
real automated passes/fails, at the cost of much slower, heavier scans. **Cross-page
consistency checks** (e.g. WCAG 3.2.3 Consistent Navigation, 3.2.4 Consistent
Identification) are still reported per-page/manual by the crawler — comparing nav
structure across all crawled pages could turn those into real automated results too.

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
- **PDF export, scheduled scans, screenshots per resolution:** the backend
  returns structured JSON from `/api/scan` and `/api/crawl`, so any of these
  can be layered on without touching the analysis core.
