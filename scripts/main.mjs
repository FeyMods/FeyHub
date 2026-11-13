import { MODULE_ID, ensureJournals, isHubJournal, migrateEntries, getEntries } from "./data/hub-store.mjs";
import { FeyHubApp } from "./apps/hub-app.mjs";
import { FeyHubPermissionsApp } from "./apps/permissions-app.mjs";
import { FeyStashApp } from "./stash/stash-app.mjs";
import { registerStash, readyStash } from "./stash/setup.mjs";
import { registerMigration, migrateFromPreviousId } from "./data/migrate.mjs";
import { registerAnnouncements } from "./data/announce.mjs";
import { registerUnread, initLastSeen } from "./data/unread.mjs";

const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "hubJournalId", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "secretJournalId", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  registerMigration();
  registerAnnouncements();
  registerUnread();

  game.settings.registerMenu(MODULE_ID, "permissions", {
    name: "FEYHUB.Permissions.Title",
    label: "FEYHUB.Permissions.Menu",
    hint: "FEYHUB.Permissions.Hint",
    icon: "fa-solid fa-user-lock",
    type: FeyHubPermissionsApp,
    restricted: true
  });

  registerStash({
    refresh: () => {
      FeyStashApp.refresh();
      FeyHubApp.refresh();
    },
    toggle: () => FeyStashApp.toggle()
  });

  foundry.applications.handlebars.loadTemplates([
    `${TEMPLATE_ROOT}/tabs/quests.hbs`,
    `${TEMPLATE_ROOT}/tabs/rumours.hbs`,
    `${TEMPLATE_ROOT}/tabs/npcs.hbs`,
    `${TEMPLATE_ROOT}/tabs/notes.hbs`,
    `${TEMPLATE_ROOT}/tabs/card-footer.hbs`,
    `${TEMPLATE_ROOT}/party-stash.hbs`
  ]);

  game.modules.get(MODULE_ID).api = {
    open: () => FeyHubApp.instance.render({ force: true }),
    toggle: () => FeyHubApp.toggle(),
    stash: {
      open: () => FeyStashApp.instance.render({ force: true }),
      close: () => FeyStashApp.instance.close(),
      toggle: () => FeyStashApp.toggle(),
      refresh: () => FeyStashApp.refresh()
    }
  };
});

Hooks.once("ready", async () => {
  // Before anything reads the settings or creates fresh journals.
  await migrateFromPreviousId();
  await readyStash();
  await ensureJournals();
  await migrateEntries();
  await initLastSeen();
  FeyHubApp.notifyUnread();
  FeyHubApp.refresh();
});

// Add the hub button to the Token controls (V13: controls and tools are records).
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if (!tokens) return;
  tokens.tools.feyHub = {
    name: "feyHub",
    title: "FEYHUB.Title",
    icon: "fa-solid fa-book-atlas",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => FeyHubApp.toggle()
  };
  tokens.tools.feyStash = {
    name: "feyStash",
    title: "FEYHUB.Stash.ControlTitle",
    icon: "fa-solid fa-sack-dollar",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => FeyStashApp.toggle()
  };
});

// Keep every open hub in sync with the backing journals.
Hooks.on("updateJournalEntry", doc => {
  if (isHubJournal(doc)) FeyHubApp.refresh();
});

Hooks.on("deleteJournalEntry", doc => {
  if (!isHubJournal(doc)) return;
  if (game.users.activeGM?.isSelf) {
    const key = game.settings.get(MODULE_ID, "hubJournalId") === doc.id ? "hubJournalId" : "secretJournalId";
    game.settings.set(MODULE_ID, key, "").then(() => ensureJournals());
  }
  FeyHubApp.refresh();
});

// The stash settings refresh through their own onChange handlers.
Hooks.on("updateSetting", setting => {
  if ([`${MODULE_ID}.hubJournalId`, `${MODULE_ID}.secretJournalId`].includes(setting.key)) FeyHubApp.refresh();
});

/** Is the hub open and showing an NPC linked to this actor? */
function hubShowsActor(actor) {
  if (!foundry.applications.instances.get("fey-hub")?.rendered) return false;
  return getEntries("npcs").some(npc => npc.actorUuid === actor.uuid);
}

// Linked actors may change name, portrait or permissions, or be deleted. Other actors don't
// appear in the hub, so their changes don't re-render it.
Hooks.on("updateActor", (actor, changes) => {
  if (!(("name" in changes) || ("img" in changes) || ("ownership" in changes))) return;
  if (hubShowsActor(actor)) FeyHubApp.refresh();
});

Hooks.on("deleteActor", actor => {
  if (hubShowsActor(actor)) FeyHubApp.refresh();
});
