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
          <span class="badge manual small">${p.manual} manual</span>
          <span class="badge pass small">${p.pass} pass</span>
        </div>
      </div>`)
    .join('');

  renderTable();
}

function renderTable() {
  const rows = lastResult.criteria.filter(
    (c) => currentFilter === 'all' || c.status === currentFilter
  );

  if (!rows.length) {
    bodyEl.innerHTML = `<tr><td colspan="5" class="muted" style="padding:1.5rem;text-align:center">No requirements in this category.</td></tr>`;
    return;
  }

  // Group rows under their POUR principle heading.
  let html = '';
  let currentPrinciple = null;
  for (const c of rows) {
    if (c.principle !== currentPrinciple) {
      currentPrinciple = c.principle;
      html += `<tr class="principle-heading"><td colspan="5">${escapeHtml(c.principle)}</td></tr>`;
    }
    html += renderRow(c);
  }
  bodyEl.innerHTML = html;

  // Toggle detail rows
  bodyEl.querySelectorAll('.crit-row').forEach((row) => {
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

  for (const issue of c.issues) {
    const kind = issue.type === 'fail'
      ? `<span class="badge fail small">Violation</span>`
      : `<span class="badge manual small">Needs review</span>`;
    const profiles = issue.profiles.map((p) => `<span class="chip">${escapeHtml(p)}</span>`).join('');
    const impact = issue.impact ? ` · impact: ${escapeHtml(issue.impact)}` : '';

    html += `<div class="issue">
      <h4>${kind} ${escapeHtml(issue.help)}</h4>
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
  return s === 'pass' ? 'Pass' : s === 'fail' ? 'Fail' : 'Manual';
}

// ── Filters ──────────────────────────────────────────────────────────────
filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  filtersEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  if (lastResult) renderTable();
});

// ── util ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
