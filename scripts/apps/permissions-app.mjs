import { MODULE_ID, getHubJournal } from "../data/hub-store.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only dialog for choosing which players may edit the hub. Editors are made
 * OWNER of the shared hub journal; everyone else inherits OBSERVER (read-only).
 */
export class FeyHubPermissionsApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "fey-hub-permissions",
    tag: "form",
    classes: ["fey-hub", "fey-permissions"],
    window: {
      title: "FEYHUB.Permissions.Title",
      icon: "fa-solid fa-user-lock"
    },
    position: { width: 380, height: "auto" },
    form: {
      handler: FeyHubPermissionsApp.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/permissions.hbs` }
  };

  async _prepareContext(options) {
    const journal = getHubJournal();
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const users = game.users
      .filter(u => !u.isGM)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(u => ({
        id: u.id,
        name: u.name,
        color: u.color?.css ?? u.color,
        canEdit: journal?.ownership?.[u.id] === OWNER
      }));
    return { ready: !!journal, users };
  }

  static async #onSubmit(event, form, formData) {
    if (!game.user.isGM) return;
    const journal = getHubJournal();
    if (!journal) return;
    const selected = foundry.utils.expandObject(formData.object).users ?? {};
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const ownership = { default: L.OBSERVER };
    for (const user of game.users) {
      if (user.isGM) continue;
      ownership[user.id] = selected[user.id] ? L.OWNER : L.INHERIT;
    }
    await journal.update({ ownership });
    ui.notifications.info("FEYHUB.Permissions.Saved", { localize: true });
  }
}
