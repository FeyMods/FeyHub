/**
 * Data layer for the Fey Hub.
 *
 * All entries live in the flags of two JournalEntries:
 *  - the shared hub journal (default OBSERVER, editors are OWNER)
 *  - the GM-only secret journal (default NONE) for hidden entries
 *
 * Entries are stored keyed by id so concurrent edits by different users merge.
 */

export const MODULE_ID = "FeyHub";

/** The module's id before it was renamed; its world data is migrated once. */
export const PREVIOUS_ID = "fey-manager";
export const TYPES = ["quests", "rumours", "npcs", "notes"];

export const QUEST_STATUSES = ["active", "on-hold", "completed", "failed"];
export const RUMOUR_STATUSES = ["unverified", "true", "false"];
export const NPC_DISPOSITIONS = ["unknown", "friendly", "neutral", "hostile"];

/* -------------------------------------------- */
/*  Journals                                    */
/* -------------------------------------------- */

export function getHubJournal() {
  const id = game.settings.get(MODULE_ID, "hubJournalId");
  return id ? game.journal.get(id) ?? null : null;
}

export function getSecretJournal() {
  const id = game.settings.get(MODULE_ID, "secretJournalId");
  return id ? game.journal.get(id) ?? null : null;
}

/** Is this journal one of the hub's backing journals? */
export function isHubJournal(doc) {
  return [game.settings.get(MODULE_ID, "hubJournalId"), game.settings.get(MODULE_ID, "secretJournalId")]
    .includes(doc?.id);
}

/**
 * Create the backing journals if they are missing. Only the active GM does this.
 */
export async function ensureJournals() {
  if (!game.users.activeGM?.isSelf) return;
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;

  let folder = game.folders.find(f => f.type === "JournalEntry" && f.getFlag(MODULE_ID, "folder"));
  const needsHub = !getHubJournal();
  const needsSecret = !getSecretJournal();
  if ((needsHub || needsSecret) && !folder) {
    folder = await Folder.create({
      name: "FeyHub",
      type: "JournalEntry",
      flags: { [MODULE_ID]: { folder: true } }
    });
  }

  if (needsHub) {
    const hub = await JournalEntry.create({
      name: "FeyHub",
      folder: folder?.id,
      ownership: { default: L.OBSERVER },
      flags: { [MODULE_ID]: { role: "hub" } }
    });
    await game.settings.set(MODULE_ID, "hubJournalId", hub.id);
  }

  if (needsSecret) {
    const secret = await JournalEntry.create({
      name: "FeyHub (GM)",
      folder: folder?.id,
      ownership: { default: L.NONE },
      flags: { [MODULE_ID]: { role: "secret" } }
    });
    await game.settings.set(MODULE_ID, "secretJournalId", secret.id);
  }
}

/* -------------------------------------------- */
/*  Permissions                                 */
/* -------------------------------------------- */

/** Can the current user add and edit hub entries? */
export function canEdit() {
  if (game.user.isGM) return true;
  return !!getHubJournal()?.isOwner;
}

/** Can the current user delete this entry? Editors may only delete their own. */
export function canDelete(entry) {
  if (game.user.isGM) return true;
  return canEdit() && entry?.createdBy === game.user.id;
}

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

function readType(journal, type) {
  const data = journal?.getFlag(MODULE_ID, type) ?? {};
  return Object.values(foundry.utils.deepClone(data)).filter(e => e && e.id);
}

/**
 * All entries of a type visible to the current user. Hidden entries (GM only)
 * are marked with `hidden: true`.
 */
export function getEntries(type) {
  const shared = readType(getHubJournal(), type).map(e => ({ ...e, hidden: false }));
  if (!game.user.isGM) return shared;
  const secret = readType(getSecretJournal(), type).map(e => ({ ...e, hidden: true }));
  return shared.concat(secret);
}

/** Find a single entry and which journal holds it. */
export function getEntry(type, id) {
  const hub = getHubJournal();
  let data = hub?.getFlag(MODULE_ID, type)?.[id];
  if (data) return { entry: foundry.utils.deepClone(data), hidden: false, journal: hub };
  if (!game.user.isGM) return null;
  const secret = getSecretJournal();
  data = secret?.getFlag(MODULE_ID, type)?.[id];
  if (data) return { entry: foundry.utils.deepClone(data), hidden: true, journal: secret };
  return null;
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

function denied() {
  ui.notifications.warn("FEYHUB.Warn.NoPermission", { localize: true });
  return null;
}

/**
 * Mark `key` of `target` for deletion when `target` is merged into a document update.
 * V14 deprecates the "-=" key in favour of its ForcedDeletion operator (`_del`); V13 only
 * understands "-=".
 */
function markDeleted(target, key) {
  if (globalThis._del) target[key] = globalThis._del;
  else target[`-=${key}`] = null;
  return target;
}

/** An update that removes one entry from a type's flag object. */
function deleteFlagKey(type, id) {
  if (globalThis._del) return { [`flags.${MODULE_ID}.${type}.${id}`]: globalThis._del };
  return { [`flags.${MODULE_ID}.${type}.-=${id}`]: null };
}

function journalFor(hidden) {
  const journal = hidden ? getSecretJournal() : getHubJournal();
  if (!journal) ui.notifications.error("FEYHUB.Warn.NotReady", { localize: true });
  return journal;
}

export async function createEntry(type, data, { hidden = false } = {}) {
  if (!canEdit()) return denied();
  if (hidden && !game.user.isGM) hidden = false;
  const journal = journalFor(hidden);
  if (!journal) return null;
  const now = Date.now();
  const id = foundry.utils.randomID();
  const entry = {
    ...data,
    id,
    createdBy: game.user.id,
    createdAt: now,
    updatedBy: game.user.id,
    updatedAt: now
  };
  await journal.update({ [`flags.${MODULE_ID}.${type}.${id}`]: entry });
  return entry;
}

/**
 * Update an entry. Passing `hidden` (GM only) moves it between the shared and
 * secret journals.
 *
 * Changes are merged into the stored entry, so nested objects such as a quest's
 * objectives only need the keys that changed. Objective ids listed in
 * `removeObjectives` are deleted.
 */
export async function updateEntry(type, id, changes, { hidden, removeObjectives = [] } = {}) {
  if (!canEdit()) return denied();
  const found = getEntry(type, id);
  if (!found) return null;
  const stamp = { updatedBy: game.user.id, updatedAt: Date.now() };

  const move = game.user.isGM && (hidden !== undefined) && (hidden !== found.hidden);
  if (!move) {
    const update = { ...changes, ...stamp };
    // Deletion keys only apply when merging into an existing objectives record; an old
    // objectives array is replaced outright by the new record.
    const stored = found.entry.objectives;
    if (removeObjectives.length && stored && !Array.isArray(stored)) {
      update.objectives = { ...update.objectives };
      for (const objectiveId of removeObjectives) {
        if (objectiveId in stored) markDeleted(update.objectives, objectiveId);
      }
    }
    await found.journal.update({ [`flags.${MODULE_ID}.${type}.${id}`]: update });
    return { ...found.entry, ...changes, ...stamp };
  }

  const target = journalFor(hidden);
  if (!target) return null;
  const entry = { ...found.entry, ...changes, ...stamp };
  delete entry.hidden;
  await target.update({ [`flags.${MODULE_ID}.${type}.${id}`]: entry });
  await found.journal.update(deleteFlagKey(type, id));
  return entry;
}

export async function deleteEntry(type, id) {
  const found = getEntry(type, id);
  if (!found) return;
  if (!canDelete(found.entry)) return denied();
  await found.journal.update(deleteFlagKey(type, id));
}

export function setHidden(type, id, hidden) {
  return updateEntry(type, id, {}, { hidden });
}

/* -------------------------------------------- */
/*  Quest objectives                            */
/* -------------------------------------------- */

/*
 * A quest's objectives are stored as a record keyed by objective id, each with a `sort`
 * index, so two users ticking different objectives at once each change only their own key.
 * Quests saved by earlier versions hold a plain array, which these helpers also accept.
 */

/** A quest's objectives as an ordered array, whichever way they are stored. */
export function objectiveList(objectives) {
  if (!objectives || (typeof objectives !== "object")) return [];
  const list = Array.isArray(objectives)
    ? objectives.map((o, sort) => ({ ...o, sort }))
    : Object.values(objectives).map((o, i) => ({ ...o, sort: Number.isFinite(o?.sort) ? o.sort : i }));
  return list.filter(o => o?.id).sort((a, b) => a.sort - b.sort);
}

/** An ordered array of objectives as the stored record, numbering `sort` in array order. */
export function objectiveRecord(list) {
  return Object.fromEntries(list.map((o, sort) => [o.id, { id: o.id, text: o.text ?? "", done: !!o.done, sort }]));
}

/**
 * Convert objectives arrays saved by earlier versions into records. Only the active GM
 * does this; until then the helpers above read either shape.
 */
export async function migrateObjectives() {
  if (!game.users.activeGM?.isSelf) return;
  for (const journal of [getHubJournal(), getSecretJournal()]) {
    const quests = journal?.getFlag(MODULE_ID, "quests") ?? {};
    const update = {};
    for (const [id, quest] of Object.entries(quests)) {
      if (Array.isArray(quest?.objectives)) {
        update[`flags.${MODULE_ID}.quests.${id}.objectives`] = objectiveRecord(objectiveList(quest.objectives));
      }
    }
    if (Object.keys(update).length) await journal.update(update);
  }
}
