/**
 * Rich text for hub entries.
 *
 * Quest and NPC descriptions, rumour text and note text are stored as HTML written in a
 * ProseMirror editor, and shown through TextEditor.enrichHTML so @UUID links, inline rolls
 * and other enrichers work. Entries saved by earlier versions hold plain text; they lack the
 * `format: "html"` marker and are converted to HTML when read.
 */

/** The text field of each entry type that holds rich text. */
export const RICH_FIELDS = {
  quests: "description",
  rumours: "text",
  npcs: "description",
  notes: "text"
};

/** The marker on entries whose rich text field is stored as HTML. */
export const HTML_FORMAT = "html";

/** Plain text as HTML paragraphs: blank lines start a paragraph, single newlines become line breaks. */
export function plainToHTML(text) {
  const paragraphs = String(text ?? "").replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/);
  return paragraphs
    .filter(p => p.trim())
    .map(p => `<p>${foundry.utils.escapeHTML(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The entry's rich text field as HTML, whichever way it is stored. */
export function storedHTML(type, entry) {
  const value = entry?.[RICH_FIELDS[type]];
  if (!value) return "";
  return entry.format === HTML_FORMAT ? String(value) : plainToHTML(value);
}

/**
 * The entry's rich text, cleaned and enriched for display. Stored HTML is cleaned first:
 * entries live in journal flags, which Foundry does not sanitise the way it does page text.
 * Secret blocks are only shown to the GM.
 */
export async function enrichEntry(type, entry) {
  const html = storedHTML(type, entry);
  if (!html) return "";
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(foundry.utils.cleanHTML(html), {
    secrets: game.user.isGM
  });
}

/** The entry's rich text as plain text, without secret blocks that haven't been revealed. */
export function publicText(type, entry) {
  const html = storedHTML(type, entry);
  if (!html) return "";
  const body = new DOMParser().parseFromString(html, "text/html").body;
  body.querySelectorAll("section.secret:not(.revealed)").forEach(secret => secret.remove());
  return body.textContent ?? "";
}

/** The readable text of an HTML string, for searching and for blank checks. */
export function htmlText(html) {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

/** Whether HTML from the editor holds nothing worth keeping, such as an empty paragraph. */
export function isBlankHTML(html) {
  if (!html) return true;
  if (/<(img|video|audio|iframe|hr|table)\b/i.test(html)) return false;
  return !htmlText(html).trim();
}
