import { MODULE_ID, ensureJournals, isHubJournal } from "./data/hub-store.mjs";
import { FeyHubApp } from "./apps/hub-app.mjs";
import { FeyHubPermissionsApp } from "./apps/permissions-app.mjs";
import { FeyStashApp } from "./stash/stash-app.mjs";
import { registerStash, readyStash } from "./stash/setup.mjs";

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
  await readyStash();
  await ensureJournals();
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
    title: "FEYPARTY.ControlTitle",
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

// Linked actors may change name, portrait or permissions.
Hooks.on("updateActor", (actor, changes) => {
  if (("name" in changes) || ("img" in changes) || ("ownership" in changes)) FeyHubApp.refresh();
});
