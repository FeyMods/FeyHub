import { MODULE_ID } from "./constants.mjs";
import { STASH_ACTIONS, prepareStashContext, attachStashListeners, syncStashDrafts } from "./stash-ui.mjs";
import { getState } from "./store.mjs";
import { getLastSeen, markSeen, unreadLog } from "../data/unread.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The floating Party Stash window. A single shared instance is opened and closed via toggle(). */
export class FeyStashApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    const position = game.settings.get(MODULE_ID, "stashPosition") ?? {};
    super(foundry.utils.mergeObject({ position }, options));
  }

  static DEFAULT_OPTIONS = {
    id: "fey-stash",
    classes: ["fey-hub", "fey-stash", "fey-stash-window"],
    tag: "div",
    window: {
      title: "FEYHUB.Stash.Title",
      icon: "fa-solid fa-sack-dollar",
      resizable: true
    },
    position: { width: 460, height: 640 },
    actions: STASH_ACTIONS
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/party-stash.hbs`,
      scrollable: [".fp-body"]
    }
  };

  static #instance;

  static get instance() {
    return (FeyStashApp.#instance ??= new FeyStashApp());
  }

  static toggle() {
    const app = FeyStashApp.instance;
    if (app.rendered) app.close();
    else app.render({ force: true });
  }

  /** Re-render if open, e.g. after the shared state changes. */
  static refresh() {
    if (FeyStashApp.#instance?.rendered) FeyStashApp.#instance.render();
  }

  stashLogOpen = false;

  /* -------------------------------------------- */

  async _prepareContext(options) {
    return prepareStashContext(this.stashLogOpen);
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    attachStashListeners(this);
  }

  /** Showing the stash counts as seeing its activity, for the hub's unread count. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (unreadLog(getState().log, getLastSeen().stash).length) await markSeen("stash");
  }

  _syncPartState(partId, newElement, priorElement, state) {
    syncStashDrafts(newElement, priorElement);
    super._syncPartState(partId, newElement, priorElement, state);
  }

  _onClose(options) {
    super._onClose(options);
    const { left, top, width, height } = this.position;
    game.settings.set(MODULE_ID, "stashPosition", { left, top, width, height });
  }
}
