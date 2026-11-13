/**
 * "New" and "Updated" markers for each player.
 *
 * A user-scoped setting records when the user last looked at each hub tab. Entries changed
 * by someone else after that are unread: their tab shows a count and their card a badge.
 * The stash tab counts activity log lines by other users instead.
 */

const MODULE_ID = "FeyHub";

/** The tabs whose changes are tracked. */
export const UNREAD_TABS = ["quests", "rumours", "npcs", "notes", "stash"];

export function registerUnread() {
  game.settings.register(MODULE_ID, "lastSeen", {
    scope: "user",
    config: false,
    type: Object,
    default: {}
  });
}

/** When the user last looked at each tab, as tab → timestamp. */
export function getLastSeen() {
  const stored = game.settings.get(MODULE_ID, "lastSeen");
  return (stored && (typeof stored === "object")) ? { ...stored } : {};
}

/** Was the entry changed by someone else after `since`? Nothing is unread without a `since`. */
export function isUnread(entry, since) {
  if (!Number.isFinite(since)) return false;
  return ((entry.updatedAt ?? 0) > since) && (entry.updatedBy !== game.user.id);
}

/** The card badge for an entry: "new" if someone else added it after `since`, "updated" if they changed it. */
export function entryBadge(entry, since) {
  if (!isUnread(entry, since)) return null;
  return (((entry.createdAt ?? 0) > since) && (entry.createdBy !== game.user.id)) ? "new" : "updated";
}

/** Activity log lines written by other users after `since`. */
export function unreadLog(log, since) {
  if (!Number.isFinite(since)) return [];
  return log.filter(line => (line.time > since) && (line.user !== game.user.name));
}

/** Record that the user has seen a tab as of now. */
export async function markSeen(tab) {
  const seen = getLastSeen();
  seen[tab] = Date.now();
  await game.settings.set(MODULE_ID, "lastSeen", seen);
}

/**
 * Give every tab a starting time the first time a user loads the module, so an existing
 * world's entries don't all show as new.
 * @returns {Promise<Record<string, number>>}  The last-seen times.
 */
export async function initLastSeen() {
  const seen = getLastSeen();
  const missing = UNREAD_TABS.filter(tab => !Number.isFinite(seen[tab]));
  if (missing.length) {
    const now = Date.now();
    for (const tab of missing) seen[tab] = now;
    await game.settings.set(MODULE_ID, "lastSeen", seen);
  }
  return seen;
}
