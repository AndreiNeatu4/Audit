'use strict';

/**
 * The technical requirements checked by this tool.
 *
 * EU legal chain:
 *   Web Accessibility Directive (EU) 2016/2102  ─┐
 *   European Accessibility Act   (EU) 2019/882  ─┤─▶ harmonised standard EN 301 549
 *                                                └─▶ EN 301 549 clause 9 (web) == WCAG Level AA
 *
 * The currently in-force EN 301 549 (V3.2.1, 2021-03) still points clause 9
 * to WCAG 2.1 (verified against its PDF text: clauses 9.1-9.4 == WCAG 2.1
 * A+AA, including 4.1.1 Parsing). ETSI's **draft EN 301 549 V4.1.0**
 * (2025-11, expected publication ~2026-10) updates clause 9 to **WCAG 2.2**
 * instead — also verified directly against its PDF text (clauses 9.1-9.4):
 * it adds 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8 and voids 4.1.1 Parsing.
 * This tool follows that forward direction and checks the full
 * **WCAG 2.2 Level A + AA** set, so a report stays valid once V4.1.0 is
 * formally adopted rather than only covering the older in-force baseline.
 *
 * So for a web page, "does it follow the EU directive?" means:
 *   "does it meet every WCAG 2.2 Level A + AA success criterion?"
 *
 * EN 301 549 numbers web criteria as clause "9.<wcag-number>",
 * e.g. WCAG 1.4.3 -> EN 301 549 clause 9.1.4.3. We derive that automatically.
 * (WCAG 2.2 retires 4.1.1 Parsing — removed below to match.)
 *
 * `check` is a plain-language note about what the requirement is about.
 * `autoTestable` is a hint: false means no automated tool can decide it -
 * it will always be reported as "Manual review".
 */

const RAW = [
  // ── Principle 1: Perceivable ────────────────────────────────────────────
  { num: '1.1.1',  level: 'A',  name: 'Non-text Content',                          check: 'Images, icons and other non-text content have text alternatives (alt text).' },
  { num: '1.2.1',  level: 'A',  name: 'Audio-only and Video-only (Prerecorded)',  check: 'Alternatives provided for audio-only and video-only media.', autoTestable: false },
  { num: '1.2.2',  level: 'A',  name: 'Captions (Prerecorded)',                    check: 'Captions provided for prerecorded video with audio.', autoTestable: false },
  { num: '1.2.3',  level: 'A',  name: 'Audio Description or Media Alternative',    check: 'Audio description or full text alternative for prerecorded video.', autoTestable: false },
  { num: '1.2.4',  level: 'AA', name: 'Captions (Live)',                           check: 'Captions provided for live audio content.', autoTestable: false },
  { num: '1.2.5',  level: 'AA', name: 'Audio Description (Prerecorded)',           check: 'Audio description provided for prerecorded video.', autoTestable: false },
  { num: '1.3.1',  level: 'A',  name: 'Info and Relationships',                    check: 'Structure (headings, lists, tables, labels) is conveyed in the markup.' },
  { num: '1.3.2',  level: 'A',  name: 'Meaningful Sequence',                       check: 'Reading/navigation order is logical and programmatically determinable.' },
  { num: '1.3.3',  level: 'A',  name: 'Sensory Characteristics',                   check: 'Instructions do not rely only on shape, size, or position.', autoTestable: false },
  { num: '1.3.4',  level: 'AA', name: 'Orientation',                               check: 'Content is not locked to a single (portrait/landscape) orientation.' },
  { num: '1.3.5',  level: 'AA', name: 'Identify Input Purpose',                    check: 'Input fields for user data use appropriate autocomplete attributes.' },
  { num: '1.4.1',  level: 'A',  name: 'Use of Color',                              check: 'Color is not the only means of conveying information.', autoTestable: false },
  { num: '1.4.2',  level: 'A',  name: 'Audio Control',                             check: 'Auto-playing audio longer than 3s can be paused or stopped.' },
  { num: '1.4.3',  level: 'AA', name: 'Contrast (Minimum)',                        check: 'Text has a contrast ratio of at least 4.5:1 (3:1 for large text).' },
  { num: '1.4.4',  level: 'AA', name: 'Resize Text',                              check: 'Text can be resized up to 200% without loss of content.', autoTestable: false },
  { num: '1.4.5',  level: 'AA', name: 'Images of Text',                            check: 'Real text is used instead of images of text where possible.', autoTestable: false },
  { num: '1.4.10', level: 'AA', name: 'Reflow',                                    check: 'Content reflows to a single column at 320px width without 2D scrolling.' },
  { num: '1.4.11', level: 'AA', name: 'Non-text Contrast',                         check: 'UI components and graphics have at least 3:1 contrast.' },
  { num: '1.4.12', level: 'AA', name: 'Text Spacing',                              check: 'No loss of content when users adjust line/letter/word spacing.' },
  { num: '1.4.13', level: 'AA', name: 'Content on Hover or Focus',                 check: 'Hover/focus popups are dismissable, hoverable and persistent.', autoTestable: false },

  // ── Principle 2: Operable ───────────────────────────────────────────────
  { num: '2.1.1',  level: 'A',  name: 'Keyboard',                                  check: 'All functionality is available from a keyboard.' },
  { num: '2.1.2',  level: 'A',  name: 'No Keyboard Trap',                          check: 'Keyboard focus can always be moved away from a component.', autoTestable: false },
  { num: '2.1.4',  level: 'A',  name: 'Character Key Shortcuts',                   check: 'Single-character shortcuts can be turned off or remapped.', autoTestable: false },
  { num: '2.2.1',  level: 'A',  name: 'Timing Adjustable',                         check: 'Users can turn off, adjust or extend time limits.', autoTestable: false },
  { num: '2.2.2',  level: 'A',  name: 'Pause, Stop, Hide',                         check: 'Moving/auto-updating content can be paused, stopped or hidden.', autoTestable: false },
  { num: '2.3.1',  level: 'A',  name: 'Three Flashes or Below Threshold',          check: 'Nothing flashes more than three times per second.', autoTestable: false },
  { num: '2.4.1',  level: 'A',  name: 'Bypass Blocks',                             check: 'A skip link or landmarks let users bypass repeated blocks.' },
  { num: '2.4.2',  level: 'A',  name: 'Page Titled',                               check: 'The page has a descriptive <title>.' },
  { num: '2.4.3',  level: 'A',  name: 'Focus Order',                               check: 'Focus order preserves meaning and operability.', autoTestable: false },
  { num: '2.4.4',  level: 'A',  name: 'Link Purpose (In Context)',                 check: 'The purpose of each link is clear from its text or context.' },
  { num: '2.4.5',  level: 'AA', name: 'Multiple Ways',                             check: 'More than one way to locate a page within the site.', autoTestable: false },
  { num: '2.4.6',  level: 'AA', name: 'Headings and Labels',                       check: 'Headings and labels describe the topic or purpose.' },
  { num: '2.4.7',  level: 'AA', name: 'Focus Visible',                             check: 'The keyboard focus indicator is visible.' },
  { num: '2.4.11', level: 'AA', name: 'Focus Not Obscured (Minimum)',              check: 'The focused component is not entirely hidden by sticky headers/footers/overlays.', autoTestable: false },
  { num: '2.5.1',  level: 'A',  name: 'Pointer Gestures',                          check: 'Multipoint/path gestures have a single-pointer alternative.', autoTestable: false },
  { num: '2.5.2',  level: 'A',  name: 'Pointer Cancellation',                      check: 'Actions can be cancelled or undone before completion.', autoTestable: false },
  { num: '2.5.3',  level: 'A',  name: 'Label in Name',                             check: 'A control\'s accessible name contains its visible label text.' },
  { num: '2.5.4',  level: 'A',  name: 'Motion Actuation',                          check: 'Motion-operated features have a UI alternative.', autoTestable: false },
  { num: '2.5.7',  level: 'AA', name: 'Dragging Movements',                        check: 'Drag-based functionality also has a single-pointer alternative (no dragging required).', autoTestable: false },
  { num: '2.5.8',  level: 'AA', name: 'Target Size (Minimum)',                     check: 'Pointer targets are at least 24×24 CSS px, or sufficiently spaced.' },

  // ── Principle 3: Understandable ─────────────────────────────────────────
  { num: '3.1.1',  level: 'A',  name: 'Language of Page',                          check: 'The page language is set (<html lang="...">).' },
  { num: '3.1.2',  level: 'AA', name: 'Language of Parts',                         check: 'Language changes within the page are marked up.' },
  { num: '3.2.1',  level: 'A',  name: 'On Focus',                                  check: 'Receiving focus does not trigger an unexpected change of context.', autoTestable: false },
  { num: '3.2.2',  level: 'A',  name: 'On Input',                                  check: 'Changing a setting does not trigger an unexpected change of context.', autoTestable: false },
  { num: '3.2.3',  level: 'AA', name: 'Consistent Navigation',                     check: 'Navigation is in a consistent order across pages.', autoTestable: false },
  { num: '3.2.4',  level: 'AA', name: 'Consistent Identification',                 check: 'Components with the same function are identified consistently.', autoTestable: false },
  { num: '3.2.6',  level: 'A',  name: 'Consistent Help',                           check: 'Help mechanisms (contact, chat, FAQ) appear in the same relative order across pages.', autoTestable: false },
  { num: '3.3.1',  level: 'A',  name: 'Error Identification',                      check: 'Input errors are identified and described in text.' },
  { num: '3.3.2',  level: 'A',  name: 'Labels or Instructions',                    check: 'Form fields have labels or instructions.' },
  { num: '3.3.3',  level: 'AA', name: 'Error Suggestion',                          check: 'Suggestions are provided when an input error is detected.', autoTestable: false },
  { num: '3.3.4',  level: 'AA', name: 'Error Prevention (Legal, Financial, Data)', check: 'Submissions can be reversed, checked or confirmed.', autoTestable: false },
  { num: '3.3.7',  level: 'A',  name: 'Redundant Entry',                           check: 'Previously entered information is auto-populated or available to select, not re-keyed.', autoTestable: false },
  { num: '3.3.8',  level: 'AA', name: 'Accessible Authentication (Minimum)',       check: 'Login does not require a cognitive test (e.g. memorised password puzzle) without an alternative.', autoTestable: false },

  // ── Principle 4: Robust ─────────────────────────────────────────────────
  // Note: WCAG 2.2 retired 4.1.1 Parsing (voided in the draft V4.1.0 text —
  // modern user agents / HTML5 parsing rules made it obsolete).
  { num: '4.1.2',  level: 'A',  name: 'Name, Role, Value',                         check: 'Custom controls expose correct name, role and value to assistive tech.' },
  { num: '4.1.3',  level: 'AA', name: 'Status Messages',                           check: 'Status messages are announced without moving focus.', autoTestable: false },
];

/**
 * The four accessibility principles named by the directive itself
 * (Directive (EU) 2019/882 — European Accessibility Act — Recital 47 and
 * Annex I, Section III(c): websites must be made "perceivable, operable,
 * understandable and robust"). WCAG's top-level number maps 1:1 onto them.
 */
const PRINCIPLES = {
  1: { key: 'perceivable',    name: 'Perceivable',    blurb: 'Information and UI components must be presentable to users in ways they can perceive.' },
  2: { key: 'operable',       name: 'Operable',       blurb: 'User interface components and navigation must be operable.' },
  3: { key: 'understandable', name: 'Understandable', blurb: 'Information and the operation of the UI must be understandable.' },
  4: { key: 'robust',         name: 'Robust',         blurb: 'Content must be robust enough to be interpreted reliably by a wide variety of user agents, including assistive technologies.' },
};

const CRITERIA = RAW.map((c) => {
  const principleNum = Number(c.num.split('.')[0]);
  return {
    ...c,
    autoTestable: c.autoTestable !== false, // default true
    enClause: `9.${c.num}`, // EN 301 549 clause number for web content
    principle: PRINCIPLES[principleNum].name,
    principleKey: PRINCIPLES[principleNum].key,
  };
});

// Legal basis metadata — the directive the tool checks against.
const DIRECTIVE = {
  celex: '32019L0882',
  title: 'Directive (EU) 2019/882 — European Accessibility Act (EAA)',
  alsoCovers: 'Directive (EU) 2016/2102 — Web Accessibility Directive',
  harmonisedStandard: 'Draft EN 301 549 V4.1.0 (2025-11), clause 9 → WCAG 2.2 Level A + AA',
  harmonisedStandardNote:
    'EN 301 549 V3.2.1 (2021-03, currently in legal force) still maps clause 9 to WCAG 2.1. ' +
    'This tool instead checks against ETSI\'s draft EN 301 549 V4.1.0 (2025-11, expected ' +
    'publication ~2026-10), which updates clause 9 to WCAG 2.2 Level A + AA — verified directly ' +
    'against the draft PDF text. As a draft it remains subject to change until formally adopted.',
  conformityBasis:
    'Article 15 (Presumption of conformity): a website conforming to the harmonised ' +
    'standard EN 301 549 is presumed to conform to the accessibility requirements of the ' +
    'Directive (Annex I — perceivable, operable, understandable, robust).',
};

module.exports = { CRITERIA, PRINCIPLES, DIRECTIVE };
