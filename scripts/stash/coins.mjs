/**
 * Parse coin written in plain text, such as "10g, 6s, 105c" or "3 gold and 2 sp".
 * Units match a stash currency by id, abbreviation or name, or by the first letter of its
 * abbreviation when no other currency shares it. The text must contain nothing but coin,
 * so ordinary chat that happens to mention money never gets picked up.
 */

const AMOUNT_UNIT = /(\d{1,3}(?:,\d{3})+|\d+)\s*(\p{L}+)\.?(?:\s+(?:pieces?|coins?)\b)?/giu;
const SEPARATORS = /^(?:[\s,;&+.]|\band\b)*$/i;

/** Map each lower-case unit spelling to its currency. */
function unitMap(currencies) {
  const map = new Map();
  // Initials first, dropping any shared by two currencies; exact names then take precedence.
  for (const c of currencies) {
    const initial = (c.abbr || c.id)?.[0]?.toLowerCase();
    if (!initial) continue;
    map.set(initial, map.has(initial) && map.get(initial) !== c ? null : c);
  }
  for (const c of currencies) {
    for (const key of [c.id, c.abbr, c.label]) if (key) map.set(String(key).toLowerCase(), c);
  }
  return map;
}

/** Plain text of a chat message's HTML content, parsed inertly. */
export function messageText(message) {
  const content = message?.content;
  if (!content || content.length > 300 || !/\d/.test(content)) return "";
  return new DOMParser().parseFromString(content, "text/html").body.textContent.trim();
}

/**
 * @param {string} text
 * @param {object[]} currencies  The stash's currencies.
 * @returns {Record<string, number>|null}  Currency id → amount, or null if the text isn't purely coin.
 */
export function parseCoins(text, currencies) {
  if (!text) return null;
  const units = unitMap(currencies);
  const amounts = {};
  let rest = text;
  for (const [match, number, unit] of text.matchAll(AMOUNT_UNIT)) {
    const currency = units.get(unit.toLowerCase());
    if (!currency) return null;
    amounts[currency.id] = (amounts[currency.id] ?? 0) + Number(number.replaceAll(",", ""));
    rest = rest.replace(match, " ");
  }
  if (!SEPARATORS.test(rest)) return null;
  for (const id of Object.keys(amounts)) if (!(amounts[id] > 0)) delete amounts[id];
  return Object.keys(amounts).length ? amounts : null;
}
