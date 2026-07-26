'use strict';

const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url');
const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const bodyEl = document.getElementById('checklist-body');
const summaryEl = document.getElementById('summary');
const principleSummaryEl = document.getElementById('principle-summary');
const filtersEl = document.getElementById('filters');
const profilesList = document.getElementById('profiles-list');
const profilesCount = document.getElementById('profiles-count');

let currentFilter = 'all';
let lastResult = null;

// ── Load available screen/DPI profiles ─────────────────────────────────────
fetch('/api/profiles')
  .then((r) => r.json())
  .then((profiles) => {
    profilesList.innerHTML = profiles
      .map(
        (p) => `<label><input type="checkbox" name="profile" value="${p.id}" checked /> ${escapeHtml(p.label)}</label>`
      )
      .join('');
    updateProfilesCount();
    profilesList.addEventListener('change', updateProfilesCount);
  })
  .catch(() => {
    profilesList.innerHTML = '<p class="hint">Could not load screen profiles.</p>';
  });

function updateProfilesCount() {
  const n = profilesList.querySelectorAll('input:checked').length;
  profilesCount.textContent = `(${n} selected)`;
}

// ── Submit ──────────────────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  const selectedProfiles = Array.from(
    profilesList.querySelectorAll('input:checked')
  ).map((i) => i.value);

  setLoading(true);
  showStatus(`<span class="spinner"></span> Loading and analyzing <strong>${escapeHtml(url)}</strong> at ${selectedProfiles.length} resolution(s)… this can take up to a minute.`);
  resultsEl.hidden = true;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, profiles: selectedProfiles }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed.');
    lastResult = data;
    renderResults(data);
    statusEl.hidden = true;
  } catch (err) {
    showStatus(`⚠️ ${escapeHtml(err.message)}`, true);
  } finally {
    setLoading(false);
  }
});

function setLoading(on) {
  scanBtn.disabled = on;
  scanBtn.textContent = on ? 'Analyzing…' : 'Check accessibility';
}

function showStatus(html, isError) {
  statusEl.hidden = false;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.innerHTML = html;
}

// ── Render ────────────────────────────────────────────────────────────────
function renderResults(data) {
  resultsEl.hidden = false;

  document.getElementById('scanned-url').textContent = data.url;
  const profileLabels = data.profiles.map((p) => p.label).join(' · ');
  document.getElementById('scanned-info').innerHTML =
    `Standard: <strong>${escapeHtml(data.standard)}</strong> &nbsp;·&nbsp; Engine: ${escapeHtml(data.engine)}<br>` +
    `Resolutions tested: ${escapeHtml(profileLabels)} &nbsp;·&nbsp; ${new Date(data.scannedAt).toLocaleString()}`;

  const s = data.summary;
  summaryEl.innerHTML = `
    <div class="stat fail"><div class="num">${s.fail}</div><div class="lbl">Fail</div></div>
    ${s.ai_suggested ? `<div class="stat ai_suggested"><div class="num">${s.ai_suggested}</div><div class="lbl">AI-suggested</div></div>` : ''}
    <div class="stat manual"><div class="num">${s.manual}</div><div class="lbl">Manual review</div></div>
    <div class="stat pass"><div class="num">${s.pass}</div><div class="lbl">Pass</div></div>
    <div class="stat"><div class="num">${s.total}</div><div class="lbl">Total requirements</div></div>
  `;

  // POUR roll-up — the directive's own framing of the requirements.
  principleSummaryEl.innerHTML = (data.principleSummary || [])
    .map((p) => `
      <div class="principle-card ${p.fail ? 'has-fail' : ''}">
        <div class="principle-name">${escapeHtml(p.principle)}</div>
        <div class="principle-counts">
          <span class="badge fail small">${p.fail} fail</span>
          ${p.ai_suggested ? `<span class="badge ai_suggested small">${p.ai_suggested} AI-suggested</span>` : ''}
          <span class="badge manual small">${p.manual} manual</span>
          <span class="badge pass small">${p.pass} pass</span>
        </div>
      </div>`)
    .join('');

  renderTable();
  renderExtraFindings(data.extraFindings || []);
}

function renderExtraFindings(findings) {
  const section = document.getElementById('extra-findings');
  const list = document.getElementById('extra-findings-list');
  if (!findings.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = buildExtraFindingsHtml(findings);
}

function buildExtraFindingsHtml(findings) {
  return findings
    .map((f) => {
      const profiles = f.profiles.map((p) => `<span class="chip">${escapeHtml(p)}</span>`).join('');
      return `<div class="issue">
        <h4><span class="badge manual small">${escapeHtml(f.type)}</span> <span class="chip engine">${escapeHtml(f.engine)}</span> ${escapeHtml(f.help)}</h4>
        <div class="issue-meta">
          Rule <code>${escapeHtml(f.rule)}</code>
          ${f.helpUrl ? ` · <a href="${escapeHtml(f.helpUrl)}" target="_blank" rel="noopener">learn more ↗</a>` : ''}
          <br>Detected at: ${profiles}
        </div>
      </div>`;
    })
    .join('');
}

function renderTable() {
  const rows = lastResult.criteria.filter(
    (c) => currentFilter === 'all' || c.status === currentFilter
  );
  bodyEl.innerHTML = buildCriteriaTableHtml(rows);
  attachRowToggle(bodyEl);
}

/** Pure: build <tr> rows (grouped under POUR principle headings) for a list of criteria. Used by both the single-page table and each crawled page's expandable table. */
function buildCriteriaTableHtml(rows) {
  if (!rows.length) {
    return `<tr><td colspan="5" class="muted" style="padding:1.5rem;text-align:center">No requirements in this category.</td></tr>`;
  }
  let html = '';
  let currentPrinciple = null;
  for (const c of rows) {
    if (c.principle !== currentPrinciple) {
      currentPrinciple = c.principle;
      html += `<tr class="principle-heading"><td colspan="5">${escapeHtml(c.principle)}</td></tr>`;
    }
    html += renderRow(c);
  }
  return html;
}

/** Wire up click-to-expand for every .crit-row inside a table body container. */
function attachRowToggle(container) {
  container.querySelectorAll('.crit-row').forEach((row) => {
    row.addEventListener('click', () => {
      const detail = row.nextElementSibling;
      if (detail && detail.classList.contains('detail-row')) {
        detail.hidden = !detail.hidden;
      }
    });
  });
}

function renderRow(c) {
  const hasDetail = c.issues.length > 0 || c.note;
  const badge = `<span class="badge ${c.status}">${statusLabel(c.status)}</span>`;

  const main = `
    <tr class="crit-row">
      <td>${badge}</td>
      <td>${c.num}</td>
      <td>${c.enClause}</td>
      <td>
        <div class="crit-name">${escapeHtml(c.name)} ${hasDetail ? '▸' : ''}</div>
        <div class="crit-check">${escapeHtml(c.check)}</div>
      </td>
      <td>${c.level}</td>
    </tr>`;

  if (!hasDetail) return main;

  return main + `
    <tr class="detail-row" hidden>
      <td colspan="5">
        <div class="detail-inner">${renderDetail(c)}</div>
      </td>
    </tr>`;
}

function renderDetail(c) {
  let html = '';
  if (c.note) html += `<p class="note">${escapeHtml(c.note)}</p>`;

  if (c.status === 'ai_suggested') {
    const verdictLabel = c.aiVerdict === 'likely_pass' ? 'Likely pass' : 'Likely fail';
    const verdictClass = c.aiVerdict === 'likely_pass' ? 'pass' : 'fail';
    html += `<div class="ai-suggestion">
      <div class="ai-suggestion-head">
        <span class="badge ${verdictClass} small">${escapeHtml(verdictLabel)}</span>
        <span class="chip">confidence: ${escapeHtml(c.aiConfidence)}</span>
      </div>
      <p>${escapeHtml(c.aiReasoning)}</p>
      <p class="muted small">⚠ Generated by a language model from a screenshot and HTML excerpt — it can be wrong. Not a substitute for a human accessibility review.</p>
    </div>`;
  }

  for (const issue of c.issues) {
    const kind = issue.type === 'fail'
      ? `<span class="badge fail small">Violation</span>`
      : `<span class="badge manual small">Needs review</span>`;
    const profiles = issue.profiles.map((p) => `<span class="chip">${escapeHtml(p)}</span>`).join('');
    const impact = issue.impact ? ` · impact: ${escapeHtml(issue.impact)}` : '';
    const engine = issue.engine ? `<span class="chip engine">${escapeHtml(issue.engine)}</span> ` : '';

    html += `<div class="issue">
      <h4>${kind} ${engine}${escapeHtml(issue.help)}</h4>
      <div class="issue-meta">
        Rule <code>${escapeHtml(issue.rule)}</code>${impact}
        ${issue.helpUrl ? ` · <a href="${escapeHtml(issue.helpUrl)}" target="_blank" rel="noopener">learn more ↗</a>` : ''}
        <br>Detected at: ${profiles}
      </div>`;

    for (const node of issue.nodes) {
      html += `<div class="node">${escapeHtml(node.html)}</div>`;
    }
    html += `</div>`;
  }
  return html;
}

function statusLabel(s) {
  if (s === 'pass') return 'Pass';
  if (s === 'fail') return 'Fail';
  if (s === 'ai_suggested') return 'AI-suggested';
  return 'Manual';
}

// ── Filters ──────────────────────────────────────────────────────────────
filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  filtersEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  if (lastResult) renderTable();
});

// ── Mode tabs ────────────────────────────────────────────────────────────
const modeTabsEl = document.getElementById('mode-tabs');
const singleModeEl = document.getElementById('single-mode');
const crawlModeEl = document.getElementById('crawl-mode');
modeTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  modeTabsEl.querySelectorAll('button').forEach((b) => {
    const active = b === btn;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  singleModeEl.hidden = btn.dataset.mode !== 'single';
  crawlModeEl.hidden = btn.dataset.mode !== 'crawl';
});

// ── Crawl mode ───────────────────────────────────────────────────────────
const crawlForm = document.getElementById('crawl-form');
const crawlUrlInput = document.getElementById('crawl-url');
const crawlStartBtn = document.getElementById('crawl-start-btn');
const crawlStopBtn = document.getElementById('crawl-stop-btn');
const crawlMaxPagesInput = document.getElementById('crawl-max-pages');
const crawlMaxDepthInput = document.getElementById('crawl-max-depth');
const crawlStatusEl = document.getElementById('crawl-status');
const crawlResultsEl = document.getElementById('crawl-results');
const crawlPagesEl = document.getElementById('crawl-pages');
const crawlSummaryEl = document.getElementById('crawl-summary');
const crawlPageCountEl = document.getElementById('crawl-page-count');
const crawlProfilesList = document.getElementById('crawl-profiles-list');
const crawlProfilesCount = document.getElementById('crawl-profiles-count');

fetch('/api/profiles')
  .then((r) => r.json())
  .then((profiles) => {
    crawlProfilesList.innerHTML = profiles
      .map((p) => `<label><input type="checkbox" name="crawl-profile" value="${p.id}" checked /> ${escapeHtml(p.label)}</label>`)
      .join('');
    updateCrawlProfilesCount();
    crawlProfilesList.addEventListener('change', updateCrawlProfilesCount);
  })
  .catch(() => {
    crawlProfilesList.innerHTML = '<p class="hint">Could not load screen profiles.</p>';
  });

function updateCrawlProfilesCount() {
  const n = crawlProfilesList.querySelectorAll('input:checked').length;
  crawlProfilesCount.textContent = `(${n} selected)`;
}

let crawlSource = null;
let crawlPageCount = 0;

crawlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (crawlSource) return;
  startCrawl();
});
crawlStopBtn.addEventListener('click', () => stopCrawl('Crawl stopped.'));

function startCrawl() {
  const url = crawlUrlInput.value.trim();
  if (!url) return;
  const maxPages = crawlMaxPagesInput.value || 20;
  const maxDepth = crawlMaxDepthInput.value || 2;
  const selectedProfiles = Array.from(crawlProfilesList.querySelectorAll('input:checked')).map((i) => i.value);

  crawlPageCount = 0;
  crawlPagesEl.innerHTML = '';
  crawlPageCountEl.textContent = '';
  crawlSummaryEl.hidden = true;
  crawlSummaryEl.innerHTML = '';
  crawlResultsEl.hidden = false;
  setCrawlLoading(true);
  showCrawlStatus(`<span class="spinner"></span> Starting crawl of <strong>${escapeHtml(url)}</strong>…`);

  const params = new URLSearchParams({ url, maxPages: String(maxPages), maxDepth: String(maxDepth) });
  if (selectedProfiles.length) params.set('profiles', selectedProfiles.join(','));

  const source = new EventSource(`/api/crawl?${params.toString()}`);
  crawlSource = source;

  source.addEventListener('page', (e) => addCrawlPage(JSON.parse(e.data)));

  source.addEventListener('progress', (e) => {
    const p = JSON.parse(e.data);
    showCrawlStatus(`<span class="spinner"></span> Scanned ${p.scanned} of up to ${p.maxPages} pages · ${p.queued} queued · ${p.visited} URL(s) seen…`);
  });

  source.addEventListener('done', (e) => {
    const d = JSON.parse(e.data);
    renderCrawlSummary(d);
    stopCrawl(null);
  });

  source.addEventListener('error', (e) => {
    let message = 'Crawl connection lost.';
    try {
      const parsed = JSON.parse(e.data);
      if (parsed && parsed.message) message = parsed.message;
    } catch {
      // native EventSource network error — no JSON payload
    }
    showCrawlStatus(`⚠️ ${escapeHtml(message)}`, true);
    stopCrawl(null);
  });
}

function stopCrawl(finalMessage) {
  if (crawlSource) {
    crawlSource.close();
    crawlSource = null;
  }
  setCrawlLoading(false);
  if (finalMessage) showCrawlStatus(finalMessage);
  else crawlStatusEl.hidden = true;
}

function setCrawlLoading(on) {
  crawlStartBtn.disabled = on;
  crawlStartBtn.textContent = on ? 'Crawling…' : 'Start crawl';
  crawlStopBtn.hidden = !on;
  crawlUrlInput.disabled = on;
}

function showCrawlStatus(html, isError) {
  crawlStatusEl.hidden = false;
  crawlStatusEl.className = 'status' + (isError ? ' error' : '');
  crawlStatusEl.innerHTML = html;
}

function addCrawlPage(data) {
  crawlPageCount += 1;
  crawlPageCountEl.textContent = `(${crawlPageCount})`;

  const card = document.createElement('div');
  card.className = 'crawl-page';

  if (data.skipped) {
    card.innerHTML = `
      <div class="crawl-page-head">
        <span class="crawl-page-url">${escapeHtml(data.url)}</span>
        <span class="badge manual small">Skipped</span>
      </div>
      <p class="muted small" style="padding:0 1rem .75rem">${escapeHtml(data.reason)}</p>`;
    crawlPagesEl.appendChild(card);
    return;
  }

  if (data.error) {
    card.innerHTML = `
      <div class="crawl-page-head">
        <span class="crawl-page-url">${escapeHtml(data.url)}</span>
        <span class="badge fail small">Error</span>
      </div>
      <p class="muted small" style="padding:0 1rem .75rem">${escapeHtml(data.error)}</p>`;
    crawlPagesEl.appendChild(card);
    return;
  }

  const s = data.summary;
  card.innerHTML = `
    <div class="crawl-page-head">
      <span class="crawl-page-url">${escapeHtml(data.url)} <span class="chip">depth ${data.depth}</span></span>
      <div class="crawl-page-counts">
        <span class="badge fail small">${s.fail} fail</span>
        ${s.ai_suggested ? `<span class="badge ai_suggested small">${s.ai_suggested} AI</span>` : ''}
        <span class="badge manual small">${s.manual} manual</span>
        <span class="badge pass small">${s.pass} pass</span>
      </div>
    </div>
    <div class="crawl-page-detail" hidden>
      <div class="table-wrap">
        <table class="checklist">
          <thead>
            <tr><th>Result</th><th>WCAG</th><th>EN 301 549</th><th>Requirement</th><th>Level</th></tr>
          </thead>
          <tbody>${buildCriteriaTableHtml(data.criteria)}</tbody>
        </table>
      </div>
    </div>`;

  const head = card.querySelector('.crawl-page-head');
  const detail = card.querySelector('.crawl-page-detail');
  head.addEventListener('click', () => { detail.hidden = !detail.hidden; });
  attachRowToggle(detail);

  crawlPagesEl.appendChild(card);
}

function renderCrawlSummary(d) {
  crawlSummaryEl.hidden = false;
  const t = d.totals;
  const remainingNote = d.pagesRemaining
    ? ` · ${d.pagesRemaining} more discovered but not scanned (raise "Max pages" to cover them)`
    : '';

  crawlSummaryEl.innerHTML = `
    <h3 class="section-label">Site-wide summary — ${d.pagesScanned} page${d.pagesScanned === 1 ? '' : 's'} scanned${escapeHtml(remainingNote)}</h3>
    <div class="summary">
      <div class="stat fail"><div class="num">${t.fail}</div><div class="lbl">Fail (page × criterion)</div></div>
      ${t.ai_suggested ? `<div class="stat ai_suggested"><div class="num">${t.ai_suggested}</div><div class="lbl">AI-suggested</div></div>` : ''}
      <div class="stat manual"><div class="num">${t.manual}</div><div class="lbl">Manual review</div></div>
      <div class="stat pass"><div class="num">${t.pass}</div><div class="lbl">Pass</div></div>
    </div>
    <h4 class="section-label">Criteria failing on the most pages</h4>
    ${d.topFailingCriteria.length ? `
      <div class="table-wrap">
        <table class="checklist">
          <thead><tr><th>WCAG</th><th>EN 301 549</th><th>Requirement</th><th>Pages failing</th></tr></thead>
          <tbody>
            ${d.topFailingCriteria.map((c) => `
              <tr>
                <td>${escapeHtml(c.num)}</td>
                <td>${escapeHtml(c.enClause)}</td>
                <td>${escapeHtml(c.name)}</td>
                <td><span class="badge fail small">${c.fail}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<p class="muted small">No failing criteria found across the scanned pages.</p>`}
  `;
}

// ── util ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
