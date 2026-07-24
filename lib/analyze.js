'use strict';

const { chromium } = require('playwright');
const AxeBuilderPkg = require('@axe-core/playwright');
const AxeBuilder = AxeBuilderPkg.AxeBuilder || AxeBuilderPkg.default || AxeBuilderPkg;
const { CRITERIA, DIRECTIVE } = require('./criteria');

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

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MAX_NODES_PER_ISSUE = 8;

// Rank of a per-criterion status. Higher wins when merging across rules/profiles.
const RANK = { none: 0, pass: 1, review: 2, fail: 3 };

/** "wcag143" -> "1.4.3". Returns null for non-criterion tags like "wcag2aa". */
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
 * Scan a single profile and fold its axe results into the shared aggregation.
 */
async function scanProfile(browser, url, profile, agg) {
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

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

    const fold = (list, status) => {
      for (const rule of list) {
        const nums = criteriaForTags(rule.tags);
        for (const num of nums) {
          const entry = ensureCriterion(agg, num);
          entry.rank = Math.max(entry.rank, RANK[status]);
          entry.covered = true;
          if (status === 'fail' || status === 'review') {
            recordIssue(entry, rule, status, profile, num);
          }
        }
      }
    };

    fold(results.violations, 'fail');
    fold(results.incomplete, 'review');
    fold(results.passes, 'pass');
  } finally {
    await context.close();
  }
}

function ensureCriterion(agg, num) {
  if (!agg[num]) agg[num] = { rank: 0, covered: false, issues: new Map() };
  return agg[num];
}

function recordIssue(entry, rule, status, profile, num) {
  let issue = entry.issues.get(rule.id);
  if (!issue) {
    issue = {
      rule: rule.id,
      type: status, // 'fail' | 'review'
      impact: rule.impact || null,
      help: rule.help,
      description: rule.description,
      helpUrl: rule.helpUrl,
      profiles: new Set(),
      nodes: new Map(), // key -> node detail
    };
    entry.issues.set(rule.id, issue);
  }
  issue.profiles.add(profile.id);
  for (const node of rule.nodes || []) {
    const key = (node.target || []).join(' ') + '::' + (node.html || '');
    if (!issue.nodes.has(key) && issue.nodes.size < MAX_NODES_PER_ISSUE) {
      issue.nodes.set(key, {
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
    type: i.type,
    impact: i.impact,
    help: i.help,
    description: i.description,
    helpUrl: i.helpUrl,
    profiles: Array.from(i.profiles),
    nodes: Array.from(i.nodes.values()),
  }));
}

/**
 * Analyze a URL against WCAG 2.1 A/AA (EN 301 549 clause 9).
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
  const profileErrors = [];

  const browser = await chromium.launch();
  try {
    for (const profile of runProfiles) {
      try {
        await scanProfile(browser, finalUrl, profile, agg);
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

  const summary = criteria.reduce(
    (s, c) => {
      s[c.status] = (s[c.status] || 0) + 1;
      return s;
    },
    { pass: 0, fail: 0, manual: 0 }
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
    });
    p[c.status] += 1;
  }

  return {
    url: finalUrl,
    scannedAt: new Date().toISOString(),
    profiles: runProfiles.map((p) => ({ id: p.id, label: p.label })),
    profileErrors,
    summary,
    principleSummary: Object.values(byPrinciple),
    criteria,
    engine: 'axe-core (via Playwright / Chromium)',
    standard: DIRECTIVE.harmonisedStandard,
    directive: DIRECTIVE,
  };
}

module.exports = { analyzeUrl, PROFILES };
