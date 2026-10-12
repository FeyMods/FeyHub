import { MODULE_ID, PREVIOUS_ID } from "./hub-store.mjs";

/** World settings that were stored under the previous module id. */
const WORLD_SETTINGS = ["hubJournalId", "secretJournalId", "stash", "playersManage", "stashImported"];

export function registerMigration() {
  // Set once data stored under the previous module id has been copied (or found absent).
  game.settings.register(MODULE_ID, "idMigrated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
}

/**
 * Copy world settings and journal/folder flags from the previous module id to the current one.
 * Only the active GM does this, and only once. The old data is left in place.
 */
export async function migrateFromPreviousId() {
  if (!game.users.activeGM?.isSelf) return;
  if (game.settings.get(MODULE_ID, "idMigrated")) return;

  let migrated = false;
  for (const key of WORLD_SETTINGS) {
    const value = readWorldSetting(PREVIOUS_ID, key);
    if (value === null) continue;
    await game.settings.set(MODULE_ID, key, value);
    migrated = true;
  }

  // Flags are read directly because getFlag() rejects scopes of inactive modules.
  for (const collection of [game.journal, game.folders]) {
    for (const doc of collection) {
      const flags = doc.flags?.[PREVIOUS_ID];
      if (!flags || doc.flags[MODULE_ID]) continue;
      await doc.update({ [`flags.${MODULE_ID}`]: flags });
      migrated = true;
    }
  }

  await game.settings.set(MODULE_ID, "idMigrated", true);
  if (migrated) ui.notifications.info("FEYHUB.Notify.Migrated", { localize: true });
}

/** Read a world setting directly from storage; its module needn't be active. */
export function readWorldSetting(namespace, key) {
  let value = game.settings.storage.get("world")?.getSetting(`${namespace}.${key}`)?.value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // Plain strings may be stored unquoted.
    }
  }
  return value ?? null;
}
