// Which stylesheet rules apply to a clicked element, and live preview of edits.
//
// The browser is the authority on *which* selectors match — that is what a
// selector engine is for. It is not the authority on what a rule contains: the
// CSSOM expands `padding: 12px` into four longhands, none of which appear in the
// file. So this module reports matching selectors, and the server reports the
// declarations behind them.

const IS_EDITOR_RULE = /^\.fl-|\[data-fl-/;

/** Matching top-level selectors, in cascade order (later rules win). */
export function matchingSelectors(el) {
  const found = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet — not ours, not editable
    }
    if (!rules) continue;
    for (const rule of rules) {
      // Media-query rules are responsive overrides; the inspector edits the base
      // rule only, so changing a value here never silently rewrites a breakpoint.
      if (rule.constructor?.name !== "CSSStyleRule" || !rule.selectorText) continue;
      if (IS_EDITOR_RULE.test(rule.selectorText)) continue;
      const parts = rule.selectorText.split(",").map((s) => s.trim());
      const hit = parts.some((p) => {
        try {
          return el.matches(p);
        } catch {
          return false;
        }
      });
      if (hit) found.push({ selector: rule.selectorText, rule });
    }
  }
  return found;
}

/** Apply a value to the live rule so the page updates as you type. */
export function preview(selector, property, value) {
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.selectorText === selector) {
        try {
          rule.style.setProperty(property, value);
        } catch {
          /* an invalid intermediate value while typing — ignore, keep the old paint */
        }
        return true;
      }
    }
  }
  return false;
}
