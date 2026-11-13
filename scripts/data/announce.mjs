/**
 * Optional chat announcements for hub changes players should notice: new quests, rumours and
 * NPCs, quest status changes, rumours confirmed or proven false, and quest rewards paid into
 * the Party Stash. Hidden entries are never announced; revealing one announces it as new.
 *
 * The client that makes a change posts the message, so each change is announced once.
 */

import { publicText } from "./rich-text.mjs";

const MODULE_ID = "FeyHub";

/** Longest quoted rumour text, in characters. */
const QUOTE_LENGTH = 120;

export function registerAnnouncements() {
  game.settings.register(MODULE_ID, "announce", {
    name: "FEYHUB.Settings.Announce.Name",
    hint: "FEYHUB.Settings.Announce.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

const enabled = () => !!game.settings.get(MODULE_ID, "announce");
const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
const fmt = (key, data) => game.i18n.format(`FEYHUB.Announce.${key}`, data);

/** A short quote of an entry's public text. */
function quote(type, entry) {
  const text = publicText(type, entry).replace(/\s+/g, " ").trim();
  return text.length > QUOTE_LENGTH ? `${text.slice(0, QUOTE_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * Post an announcement to chat.
 * @param {string} icon  Font Awesome classes.
 * @param {string} html  Message HTML; callers escape any user text in it.
 */
export async function announce(icon, html) {
  if (!enabled()) return;
  try {
    await ChatMessage.implementation.create({
      speaker: { alias: game.i18n.localize("FEYHUB.Title") },
      content: `<div class="fey-announce"><i class="${icon}" inert></i><span>${html}</span></div>`
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not post an announcement`, err);
  }
}

/** The message for a change, as [icon, html], or null if it shouldn't be announced. */
export function describeChange(type, before, after) {
  if (!after || after.hidden) return null;
  const isNew = !before || before.hidden;

  if (type === "quests") {
    const title = `<strong>${esc(after.title)}</strong>`;
    if (isNew) return ["fa-solid fa-scroll", fmt("QuestNew", { title })];
    if (before.status === after.status) return null;
    const key = { completed: "QuestCompleted", failed: "QuestFailed" }[after.status] ?? "QuestStatus";
    const status = esc(game.i18n.localize(`FEYHUB.Quest.Status.${after.status ?? "active"}`));
    return ["fa-solid fa-scroll", fmt(key, { title, status })];
  }

  if (type === "rumours") {
    const text = `<em>${esc(quote(type, after))}</em>`;
    if (isNew) return ["fa-solid fa-comments", fmt("RumourNew", { text })];
    if (before.status === after.status) return null;
    if (after.status === "true") return ["fa-solid fa-circle-check", fmt("RumourTrue", { text })];
    if (after.status === "false") return ["fa-solid fa-circle-xmark", fmt("RumourFalse", { text })];
    return null;
  }

  if ((type === "npcs") && isNew) {
    return ["fa-solid fa-user", fmt("NPCNew", { name: `<strong>${esc(after.name)}</strong>` })];
  }
  return null;
}

/** Announce a change to a hub entry, if it is one players should hear about. */
export function announceChange(type, before, after) {
  if (!enabled()) return;
  const message = describeChange(type, before, after);
  if (message) announce(...message);
}
