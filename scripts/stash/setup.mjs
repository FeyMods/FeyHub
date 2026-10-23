import { MODULE_ID, LEGACY_ID, defaultState } from "./constants.mjs";
import { registerSocket } from "./store.mjs";
import { registerSheetIntegration } from "./purse.mjs";
import { registerChatIntegration } from "./chat.mjs";
import { registerActorDrop } from "./stash-ui.mjs";
import { readWorldSetting } from "../data/migrate.mjs";

/**
 * Register the Party Stash's settings, keybinding, sheet buttons and chat buttons.
 * @param {object} callbacks
 * @param {Function} callbacks.refresh  Re-render every open view of the stash.
 * @param {Function} callbacks.toggle   Open or close the stash window.
 */
export function registerStash({ refresh, toggle }) {
  game.settings.register(MODULE_ID, "stash", {
    scope: "world",
    config: false,
    type: Object,
    default: defaultState(),
    onChange: () => refresh()
  });

  game.settings.register(MODULE_ID, "playersManage", {
    name: "FEYPARTY.Settings.PlayersManage.Name",
    hint: "FEYPARTY.Settings.PlayersManage.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refresh()
  });

  game.settings.register(MODULE_ID, "stashPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Set once the old Fey Party module's stash has been copied in (or found absent).
  game.settings.register(MODULE_ID, "stashImported", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.keybindings.register(MODULE_ID, "toggleStash", {
    name: "FEYPARTY.Keybinding.Toggle",
    editable: [],
    onDown: () => {
      toggle();
      return true;
    }
  });

  registerSheetIntegration();
  registerChatIntegration();
  registerActorDrop();
}

/** Ready-time setup: the GM relay socket and a one-time import of Fey Party's data. */
export async function readyStash() {
  registerSocket();
  if (!game.users.activeGM?.isSelf) return;

  if (game.modules.get(LEGACY_ID)?.active) {
    ui.notifications.warn("FEYPARTY.Notify.LegacyActive", { localize: true, permanent: true });
  }
  if (game.settings.get(MODULE_ID, "stashImported")) return;

  const stash = readWorldSetting(LEGACY_ID, "stash");
  if (stash && typeof stash === "object") {
    await game.settings.set(MODULE_ID, "stash", stash);
    const playersManage = readWorldSetting(LEGACY_ID, "playersManage");
    if (typeof playersManage === "boolean") await game.settings.set(MODULE_ID, "playersManage", playersManage);
    ui.notifications.info("FEYPARTY.Notify.Imported", { localize: true });
  }
  await game.settings.set(MODULE_ID, "stashImported", true);
}
