'use strict';

const { chromium } = require('playwright');
const { analyzePageWithBrowser, normalizeUrl } = require('./analyze');

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_DEPTH = 2;
const ROBOTS_TIMEOUT_MS = 5000;
// Links to these extensions are same-origin "pages" in form but not HTML documents worth scanning.
const SKIP_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp',
  'zip', 'rar', '7z', 'gz', 'tar',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'webm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'css', 'js', 'json', 'xml', 'woff', 'woff2', 'ttf', 'eot',
]);

/** Best-effort robots.txt fetch — fails open (treats everything as allowed) on any error/timeout. */
async function fetchRobotsDisallow(origin) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    const res = await fetch(`${origin}/robots.txt`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    return parseRobotsDisallow(await res.text());
  } catch {
    return [];
  }
}

/** Minimal robots.txt parser: only the `User-agent: *` block's `Disallow` rules. */
function parseRobotsDisallow(text) {
  const disallow = [];
  let applies = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      applies = value === '*';
    } else if (key === 'disallow' && applies && value) {
      disallow.push(value);
    }
  }
  return disallow;
}

function isPathAllowed(disallowList, pathname) {
  return !disallowList.some((rule) => pathname.startsWith(rule));
}

/** Resolve + filter a raw <a href> into a same-origin, crawlable page URL, or null. */
function normalizeLink(href, origin) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.origin !== origin) return null;
  const ext = u.pathname.split('.').pop().toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return null;
  u.hash = '';
  return u.toString();
}

/**
 * Crawl a site starting at startUrl, running the full accessibility scan
 * (analyzePageWithBrowser) on every discovered same-origin page, breadth-first,
 * up to opts.maxPages / opts.maxDepth. Emits events via onEvent(name, data) as
 * it goes so a caller (e.g. an SSE endpoint) can stream progress:
 *   'page'     — one page's full scan result (or { url, error } on failure)
 *   'progress' — { scanned, queued, visited, maxPages }
 *   'done'     — { pagesScanned, aggregate, stoppedReason }
 *
 * @param {string} startUrl
 * @param {{ maxPages?: number, maxDepth?: number, profiles?: string[], isAborted?: () => boolean }} opts
 * @param {(event: string, data: object) => void} onEvent
 */
async function crawlSite(startUrl, opts = {}, onEvent = () => {}) {
  const maxPages = opts.maxPages || DEFAULT_MAX_PAGES;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const isAborted = opts.isAborted || (() => false);

  const finalStartUrl = normalizeUrl(startUrl);
  const origin = new URL(finalStartUrl).origin;
  const disallow = await fetchRobotsDisallow(origin);

  const visited = new Set();
  const queue = [{ url: finalStartUrl, depth: 0 }];
  let scanned = 0;

  // Site-wide aggregate: per-criterion pass/fail/manual/ai_suggested counts across all pages.
  const criteriaAgg = new Map(); // num -> { num, name, enClause, level, pass, fail, manual, ai_suggested, failingPages }
  const totals = { pass: 0, fail: 0, manual: 0, ai_suggested: 0 };

  const browser = await chromium.launch();
  let stoppedReason = 'exhausted';
  try {
    while (queue.length > 0) {
      if (isAborted()) {
        stoppedReason = 'aborted';
        break;
      }
      if (scanned >= maxPages) {
        stoppedReason = 'max-pages-reached';
        break;
      }

      const { url, depth } = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      const pathname = new URL(url).pathname;
      if (!isPathAllowed(disallow, pathname)) {
        onEvent('page', { url, depth, skipped: true, reason: 'Disallowed by robots.txt' });
        continue;
      }

      let result;
      try {
        result = await analyzePageWithBrowser(browser, url, { profiles: opts.profiles });
      } catch (e) {
        scanned += 1;
        onEvent('page', { url, depth, error: e.message || 'Scan failed.' });
        onEvent('progress', { scanned, queued: queue.length, visited: visited.size, maxPages });
        continue;
      }

      scanned += 1;

      for (const c of result.criteria) {
        let entry = criteriaAgg.get(c.num);
        if (!entry) {
          entry = { num: c.num, name: c.name, enClause: c.enClause, level: c.level, pass: 0, fail: 0, manual: 0, ai_suggested: 0, failingPages: [] };
          criteriaAgg.set(c.num, entry);
        }
        entry[c.status] += 1;
        totals[c.status] += 1;
        if (c.status === 'fail') entry.failingPages.push(result.url);
      }

      onEvent('page', {
        url: result.url,
        depth,
        scannedAt: result.scannedAt,
        summary: result.summary,
        principleSummary: result.principleSummary,
        criteria: result.criteria,
        extraFindings: result.extraFindings,
      });

      if (depth < maxDepth) {
        for (const href of result.links || []) {
          const normalized = normalizeLink(href, origin);
          if (normalized && !visited.has(normalized)) {
            queue.push({ url: normalized, depth: depth + 1 });
          }
        }
      }

      onEvent('progress', { scanned, queued: queue.length, visited: visited.size, maxPages });
    }
  } finally {
    await browser.close();
  }

  const topFailingCriteria = Array.from(criteriaAgg.values())
    .filter((c) => c.fail > 0)
    .sort((a, b) => b.fail - a.fail)
    .map((c) => ({ ...c, failingPages: c.failingPages.slice(0, 50) }));

  onEvent('done', {
    pagesScanned: scanned,
    pagesRemaining: queue.length,
    totals,
    topFailingCriteria,
    stoppedReason,
  });
}

module.exports = { crawlSite };
