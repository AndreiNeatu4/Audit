'use strict';

const fs = require('fs');
const { chromium } = require('playwright');
const AxeBuilderPkg = require('@axe-core/playwright');
const AxeBuilder = AxeBuilderPkg.AxeBuilder || AxeBuilderPkg.default || AxeBuilderPkg;
const { CRITERIA, DIRECTIVE } = require('./criteria');
const { suggestManualCriteria, isEnabled: aiReviewEnabled } = require('./aiReview');

// Second, independently-built engine (not axe-based) used as a cross-check —
// different engines catch different issues, so running both raises the
// automated-detection ceiling beyond what axe-core alone finds.
const HTMLCS_SOURCE = fs.readFileSync(require.resolve('html_codesniffer/build/HTMLCS.js'), 'utf8');

/**
 * Screen profiles. Each page is scanned at every selected profile so we can
 * catch issues that only appear at certain resolutions / pixel densities
 * (e.g. reflow, contrast, tap-target size). A requirement is marked FAIL if it
 * fails in ANY profile.
 *
 * `dsf` = deviceScaleFactor (DPI multiplier): 1 = standard, 2 = "retina", 3 = high-density phone.
 */
const PROFILES = [
  { id: 'desktop', label: 'Desktop 1920×1080 @1x', width: 1920, height: 1080, dsf: 1, mobile: false },
  { id: 'laptop',  label: 'Laptop 1366×768 @1x',   width: 1366, height: 768,  dsf: 1, mobile: false },
  { id: 'tablet',  label: 'Tablet 768×1024 @2x',   width: 768,  height: 1024, dsf: 2, mobile: true  },
  { id: 'mobile',  label: 'Mobile 375×812 @3x',    width: 375,  height: 812,  dsf: 3, mobile: true  },
];

// 'best-practice' isn't a WCAG criterion, but axe's best-practice rules catch
// real issues outside the strict A/AA set — surfaced separately as `extraFindings`.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'];
const HTMLCS_STANDARD = 'WCAG2AA';
const HTMLCS_TIMEOUT_MS = 30000;
const MAX_NODES_PER_ISSUE = 8;
const MAX_EXTRA_FINDINGS = 40;

// Rank of a per-criterion status. Higher wins when merging across rules/profiles.
const RANK = { none: 0, pass: 1, review: 2, fail: 3 };

/** "wcag143" -> "1.4.3". Returns null for non-criterion tags like "wcag2aa" or "best-practice". */
function wcagTagToNumber(tag) {
  const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

function criteriaForTags(tags) {
  const nums = new Set();
  for (const t of tags || []) {
    const num = wcagTagToNumber(t);
    if (num) nums.add(num);
  }
  return nums;
}

/** "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail" -> "1.4.3". Returns null if no SC segment is found. */
function htmlcsCodeToNumber(code) {
  for (const part of String(code || '').split('.')) {
    const m = /^(\d+)_(\d+)_(\d+)$/.exec(part);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return null;
}

/**
 * Run HTML_CodeSniffer (a second, non-axe-based engine) against the already
 * loaded page. Returns [] (never throws) if the page's own scripts shadow the
 * globals HTMLCS relies on (e.g. an AMD loader) — that profile just falls
 * back to axe-only results rather than failing the whole scan.
 */
async function runHtmlcs(page) {
  try {
    await page.evaluate(HTMLCS_SOURCE);
    const hasHtmlcs = await page.evaluate(() => typeof window.HTMLCS !== 'undefined');
    if (!hasHtmlcs) return [];

    const run = page.evaluate(
      ({ standard }) =>
        new Promise((resolve) => {
          try {
            window.HTMLCS.process(
              standard,
              document,
              () => {
                const msgs = window.HTMLCS.getMessages().map((m) => ({
                  type: m.type,
                  code: m.code,
                  msg: m.msg,
                  html: m.element && m.element.outerHTML ? String(m.element.outerHTML).slice(0, 300) : null,
                }));
                resolve(msgs);
              },
              () => resolve([])
            );
          } catch {
            resolve([]);
          }
        }),
      { standard: HTMLCS_STANDARD }
    );
    const timeout = new Promise((resolve) => setTimeout(() => resolve([]), HTMLCS_TIMEOUT_MS));
    return await Promise.race([run, timeout]);
  } catch {
    return [];
  }
}

function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw new Error('Please enter a URL.');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${input}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.');
  }
  return parsed.toString();
}

/**
 * Scan a single profile and fold results from BOTH engines (axe-core and
 * HTML_CodeSniffer) into the shared aggregation. Running two independently
 * built engines against the same page catches more real issues than either
 * alone, since their rule sets and detection logic differ.
 */
async function scanProfile(browser, url, profile, agg, extraAgg, capture) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dsf,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    // Give client-rendered content a moment to settle.
    await page.waitForTimeout(1500);

    // Grab one screenshot + HTML snapshot (first profile only) for the
    // optional AI-assisted review of criteria no rule engine can verify.
    if (capture && !capture.done && aiReviewEnabled()) {
      try {
        const buf = await page.screenshot();
        capture.screenshotBase64 = buf.toString('base64');
        capture.html = await page.content();
      } catch {
        // Non-fatal — AI review just runs without a screenshot/HTML if this fails.
      } finally {
        capture.done = true;
      }
    }

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

    const fold = (list, status, engine) => {
      for (const rule of list) {
        const nums = criteriaForTags(rule.tags);
        if (nums.size === 0) {
          // Not mapped to a WCAG success criterion (e.g. axe best-practice
          // rules) — surface as a supplementary recommendation instead.
          if (status !== 'pass') recordExtra(extraAgg, rule, status, profile, engine);
          continue;
        }
        for (const num of nums) {
          const entry = ensureCriterion(agg, num);
          entry.rank = Math.max(entry.rank, RANK[status]);
          entry.covered = true;
          if (status === 'fail' || status === 'review') {
            recordIssue(entry, rule, status, profile, engine);
          }
        }
      }
    };

    fold(results.violations, 'fail', 'axe-core');
    fold(results.incomplete, 'review', 'axe-core');
    fold(results.passes, 'pass', 'axe-core');

    const htmlcsMsgs = await runHtmlcs(page);
    for (const m of htmlcsMsgs) {
      if (m.type !== 1 && m.type !== 2) continue; // ERROR or WARNING only; skip NOTICE (too noisy)
      const num = htmlcsCodeToNumber(m.code);
      if (!num) continue;
      const status = m.type === 1 ? 'fail' : 'review';
      const entry = ensureCriterion(agg, num);
      entry.rank = Math.max(entry.rank, RANK[status]);
      entry.covered = true;
      const rule = { id: m.code, impact: null, help: m.msg, description: m.msg, helpUrl: null, nodes: [{ target: [], html: m.html, failureSummary: null }] };
      recordIssue(entry, rule, status, profile, 'HTML_CodeSniffer');
    }
  } finally {
    await context.close();
  }
}

function ensureCriterion(agg, num) {
  if (!agg[num]) agg[num] = { rank: 0, covered: false, issues: new Map() };
  return agg[num];
}

function recordIssue(entry, rule, status, profile, engine) {
  const key = `${engine}:${rule.id}`;
  let issue = entry.issues.get(key);
  if (!issue) {
    issue = {
      rule: rule.id,
      engine,
      type: status, // 'fail' | 'review'
      impact: rule.impact || null,
      help: rule.help,
      description: rule.description,
      helpUrl: rule.helpUrl,
      profiles: new Set(),
      nodes: new Map(), // key -> node detail
    };
    entry.issues.set(key, issue);
  }
  issue.profiles.add(profile.id);
  for (const node of rule.nodes || []) {
    const key2 = (node.target || []).join(' ') + '::' + (node.html || '');
    if (!issue.nodes.has(key2) && issue.nodes.size < MAX_NODES_PER_ISSUE) {
      issue.nodes.set(key2, {
        html: node.html,
        target: node.target,
        summary: node.failureSummary || null,
      });
    }
  }
}

function serializeIssues(issuesMap) {
  return Array.from(issuesMap.values()).map((i) => ({
    rule: i.rule,
    engine: i.engine,
    type: i.type,
    impact: i.impact,
    help: i.help,
    description: i.description,
    helpUrl: i.helpUrl,
    profiles: Array.from(i.profiles),
    nodes: Array.from(i.nodes.values()),
  }));
}

function recordExtra(extraAgg, rule, status, profile, engine) {
  const key = `${engine}:${rule.id}`;
  let item = extraAgg.get(key);
  if (!item) {
    item = {
      rule: rule.id,
      engine,
      type: status,
      help: rule.help,
      description: rule.description,
      helpUrl: rule.helpUrl,
      profiles: new Set(),
    };
    extraAgg.set(key, item);
  }
  item.profiles.add(profile.id);
}

/**
 * Analyze a URL against WCAG 2.2 A/AA (EN 301 549 clause 9, per draft V4.1.0).
 * @param {string} url
 * @param {{ profiles?: string[] }} opts  which profile ids to run (defaults to all)
 */
async function analyzeUrl(url, opts = {}) {
  const finalUrl = normalizeUrl(url);
  const selected = PROFILES.filter(
    (p) => !opts.profiles || opts.profiles.length === 0 || opts.profiles.includes(p.id)
  );
  const runProfiles = selected.length ? selected : PROFILES;

  const agg = {}; // criterion num -> aggregation
  const extraAgg = new Map(); // findings not mapped to any WCAG criterion (e.g. axe best-practice)
  const capture = { done: false, screenshotBase64: null, html: null };
  const profileErrors = [];

  const browser = await chromium.launch();
  try {
    for (const profile of runProfiles) {
      try {
        await scanProfile(browser, finalUrl, profile, agg, extraAgg, capture);
      } catch (e) {
        profileErrors.push({ profile: profile.id, message: e.message });
      }
    }
  } finally {
    await browser.close();
  }

  // If every profile failed to load, surface that as a hard error.
  if (profileErrors.length === runProfiles.length) {
    throw new Error(
      `Could not analyze the page. ${profileErrors[0].message}`
    );
  }

  const criteria = CRITERIA.map((c) => {
    const a = agg[c.num] || { rank: 0, covered: false, issues: new Map() };
    let status;
    let note = null;
    let automated = c.autoTestable && a.covered;

    if (a.rank === RANK.fail) {
      status = 'fail';
    } else if (a.rank === RANK.review) {
      status = 'manual';
      note = 'Automated check was inconclusive — manual review required.';
    } else if (a.rank === RANK.pass) {
      status = 'pass';
    } else {
      // No automated test covered this criterion.
      status = 'manual';
      automated = false;
      note = c.autoTestable
        ? 'No automated result — manual review recommended.'
        : 'Cannot be tested automatically — requires manual review.';
    }

    const issues = serializeIssues(a.issues);
    const failedProfiles = new Set();
    issues.filter((i) => i.type === 'fail').forEach((i) => i.profiles.forEach((p) => failedProfiles.add(p)));

    return {
      num: c.num,
      enClause: c.enClause,
      name: c.name,
      level: c.level,
      check: c.check,
      principle: c.principle,
      principleKey: c.principleKey,
      status,
      automated,
      note,
      failedProfiles: Array.from(failedProfiles),
      issues,
    };
  });

  // AI-assisted review — ONLY for criteria no rule engine could resolve.
  // Result is a distinct "ai_suggested" tier, never folded into pass/fail:
  // it's a non-binding suggestion for a human reviewer, not a verified result.
  if (aiReviewEnabled()) {
    const manualCandidates = criteria.filter((c) => c.status === 'manual' && !c.automated);
    if (manualCandidates.length) {
      const aiResults = await suggestManualCriteria({
        url: finalUrl,
        screenshotBase64: capture.screenshotBase64,
        html: capture.html,
        criteria: manualCandidates.map((c) => ({ num: c.num, name: c.name, check: c.check, enClause: c.enClause })),
      });
      const byNum = new Map(aiResults.map((r) => [r.num, r]));
      for (const c of criteria) {
        const r = byNum.get(c.num);
        if (!r || r.verdict === 'insufficient_evidence') continue;
        c.status = 'ai_suggested';
        c.aiVerdict = r.verdict; // 'likely_pass' | 'likely_fail'
        c.aiConfidence = r.confidence;
        c.aiReasoning = r.reasoning;
        c.note = 'AI-suggested, NOT a verified result — a human must confirm this before relying on it.';
      }
    }
  }

  const summary = criteria.reduce(
    (s, c) => {
      s[c.status] = (s[c.status] || 0) + 1;
      return s;
    },
    { pass: 0, fail: 0, manual: 0, ai_suggested: 0 }
  );
  summary.total = criteria.length;

  // Per-principle (POUR) roll-up — matches how the directive itself frames the
  // requirements for websites (Annex I, Section III(c)).
  const byPrinciple = {};
  for (const c of criteria) {
    const p = (byPrinciple[c.principle] = byPrinciple[c.principle] || {
      principle: c.principle,
      key: c.principleKey,
      pass: 0,
      fail: 0,
      manual: 0,
      ai_suggested: 0,
    });
    p[c.status] += 1;
  }

  const extraFindings = Array.from(extraAgg.values())
    .slice(0, MAX_EXTRA_FINDINGS)
    .map((i) => ({
      rule: i.rule,
      engine: i.engine,
      type: i.type,
      help: i.help,
      description: i.description,
      helpUrl: i.helpUrl,
      profiles: Array.from(i.profiles),
    }));

  return {
    url: finalUrl,
    scannedAt: new Date().toISOString(),
    profiles: runProfiles.map((p) => ({ id: p.id, label: p.label })),
    profileErrors,
    summary,
    principleSummary: Object.values(byPrinciple),
    criteria,
    extraFindings,
    engine: aiReviewEnabled()
      ? 'axe-core + HTML_CodeSniffer (via Playwright / Chromium) + AI-assisted review'
      : 'axe-core + HTML_CodeSniffer (via Playwright / Chromium)',
    aiReviewEnabled: aiReviewEnabled(),
    standard: DIRECTIVE.harmonisedStandard,
    directive: DIRECTIVE,
  };
}

module.exports = { analyzeUrl, PROFILES };
