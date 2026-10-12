import {
  MODULE_ID, QUEST_STATUSES, RUMOUR_STATUSES,
  getHubJournal, getEntries, getEntry, canEdit, canDelete,
  createEntry, updateEntry, deleteEntry, setHidden
} from "../data/hub-store.mjs";
import { FeyEntryEditor } from "./entry-editor.mjs";
import { FeyHubPermissionsApp } from "./permissions-app.mjs";
import { STASH_ACTIONS, prepareStashContext, attachStashListeners, syncStashDrafts } from "../stash/stash-ui.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TABS = [
  { id: "quests", icon: "fa-solid fa-scroll", label: "FEYHUB.Tabs.Quests" },
  { id: "rumours", icon: "fa-solid fa-comments", label: "FEYHUB.Tabs.Rumours" },
  { id: "npcs", icon: "fa-solid fa-users", label: "FEYHUB.Tabs.NPCs" },
  { id: "notes", icon: "fa-solid fa-note-sticky", label: "FEYHUB.Tabs.Notes" },
  { id: "stash", icon: "fa-solid fa-sack-dollar", label: "FEYHUB.Tabs.Stash" }
];

const DEFAULT_NPC_IMG = "icons/svg/mystery-man.svg";

/** Sort newest-updated first. */
const byUpdated = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

function userName(id) {
  return game.users.get(id)?.name ?? game.i18n.localize("FEYHUB.UnknownUser");
}

function timeAgo(ts) {
  if (!ts) return "";
  return foundry.utils.timeSince?.(ts) ?? new Date(ts).toLocaleDateString();
}

/** Parse Foundry drag data from a drop event. */
function getDragData(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch {
    return null;
  }
}

export class FeyHubApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static #instance;

  static get instance() {
    return FeyHubApp.#instance ??= new FeyHubApp();
  }

  static toggle() {
    const app = FeyHubApp.instance;
    if (app.rendered) app.close();
    else app.render({ force: true });
  }

  /** Re-render the open hub (debounced so bursts of updates render once). */
  static refresh = foundry.utils.debounce(() => {
    if (FeyHubApp.#instance?.rendered) FeyHubApp.#instance.render();
  }, 50);

  /* -------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "fey-hub",
    classes: ["fey-hub"],
    window: {
      title: "FEYHUB.Title",
      icon: "fa-solid fa-book-atlas",
      resizable: true
    },
    position: { width: 640, height: 720 },
    actions: {
      switchTab: FeyHubApp.#onSwitchTab,
      add: FeyHubApp.#onAdd,
      edit: FeyHubApp.#onEdit,
      delete: FeyHubApp.#onDelete,
      toggleHidden: FeyHubApp.#onToggleHidden,
      toggleObjective: FeyHubApp.#onToggleObjective,
      questFilter: FeyHubApp.#onQuestFilter,
      openActor: FeyHubApp.#onOpenActor,
      unlinkActor: FeyHubApp.#onUnlinkActor,
      gotoNpc: FeyHubApp.#onGotoNpc,
      permissions: FeyHubApp.#onPermissions,
      ...STASH_ACTIONS
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/hub.hbs`,
      scrollable: [".fey-panel"]
    }
  };

  /** UI state that survives re-renders. */
  activeTab = "quests";
  questFilter = "all";
  search = "";
  expanded = new Set();
  stashLogOpen = false;

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const ready = !!getHubJournal();
    const editable = ready && canEdit();
    const npcs = getEntries("npcs");
    const npcById = new Map(npcs.map(n => [n.id, n]));
    const counts = {};

    const decorate = (type, e) => ({
      ...e,
      type,
      canEdit: editable,
      canDelete: canDelete(e),
      isGM: game.user.isGM,
      expanded: this.expanded.has(e.id),
      author: userName(e.createdBy),
      editedBy: e.updatedBy && (e.updatedBy !== e.createdBy) ? userName(e.updatedBy) : null,
      updated: timeAgo(e.updatedAt)
    });

    const npcRef = id => {
      const npc = id ? npcById.get(id) : null;
      return npc ? { id: npc.id, name: npc.name } : null;
    };

    // Quests
    const allQuests = getEntries("quests");
    counts.quests = allQuests.length;
    const questFilters = [{ id: "all", label: game.i18n.localize("FEYHUB.Quest.All"), count: allQuests.length }]
      .concat(QUEST_STATUSES.map(s => ({
        id: s,
        label: game.i18n.localize(`FEYHUB.Quest.Status.${s}`),
        count: allQuests.filter(q => q.status === s).length
      })))
      .map(f => ({ ...f, active: f.id === this.questFilter }));
    const quests = allQuests
      .filter(q => (this.questFilter === "all") || (q.status === this.questFilter))
      .sort((a, b) => (QUEST_STATUSES.indexOf(a.status) - QUEST_STATUSES.indexOf(b.status)) || byUpdated(a, b))
      .map(q => {
        const objectives = q.objectives ?? [];
        const giver = npcRef(q.giverNpcId);
        return {
          ...decorate("quests", q),
          objectives,
          doneCount: objectives.filter(o => o.done).length,
          statusLabel: game.i18n.localize(`FEYHUB.Quest.Status.${q.status ?? "active"}`),
          giver,
          searchText: [q.title, q.description, giver?.name, ...objectives.map(o => o.text)].join(" ").toLowerCase()
        };
      });

    // Rumours
    const rumours = getEntries("rumours").sort(byUpdated).map(r => {
      const sourceNpc = npcRef(r.sourceNpcId);
      const status = RUMOUR_STATUSES.includes(r.status) ? r.status : "unverified";
      return {
        ...decorate("rumours", r),
        status,
        statusLabel: game.i18n.localize(`FEYHUB.Rumour.Status.${status}`),
        sourceNpc,
        searchText: [r.text, r.source, r.location, sourceNpc?.name].join(" ").toLowerCase()
      };
    });
    counts.rumours = rumours.length;

    // NPCs
    const npcList = [...npcs].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")).map(n => {
      const actor = n.actorUuid ? fromUuidSync(n.actorUuid) : null;
      const canView = !!actor?.testUserPermission?.(game.user, "LIMITED");
      const disposition = n.disposition || "unknown";
      return {
        ...decorate("npcs", n),
        img: (canView && actor.img) || n.img || DEFAULT_NPC_IMG,
        linked: !!n.actorUuid,
        canView,
        disposition,
        dispositionLabel: game.i18n.localize(`FEYHUB.NPC.Disposition.${disposition}`),
        searchText: [n.name, n.description, canView ? actor.name : ""].join(" ").toLowerCase()
      };
    });
    counts.npcs = npcList.length;

    // Notes
    const notes = getEntries("notes").sort(byUpdated).map(n => ({
      ...decorate("notes", n),
      searchText: [n.title, n.text].join(" ").toLowerCase()
    }));
    counts.notes = notes.length;

    const tabs = TABS.map(t => ({
      ...t,
      label: game.i18n.localize(t.label),
      count: counts[t.id],
      hasCount: t.id in counts,
      active: t.id === this.activeTab
    }));

    return {
      ready,
      editable,
      isGM: game.user.isGM,
      tabs,
      activeTab: this.activeTab,
      isQuests: this.activeTab === "quests",
      isRumours: this.activeTab === "rumours",
      isNPCs: this.activeTab === "npcs",
      isNotes: this.activeTab === "notes",
      isStash: this.activeTab === "stash",
      addLabel: game.i18n.localize(`FEYHUB.Add.${this.activeTab}`),
      search: this.search,
      questFilters,
      quests,
      rumours,
      npcs: npcList,
      notes,
      // The stash partial reads its data from the root context.
      ...(this.activeTab === "stash" ? prepareStashContext(this.stashLogOpen) : {})
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    attachStashListeners(this);
  }

  /** Keep half-typed stash entries when another user's change re-renders the hub. */
  _syncPartState(partId, newElement, priorElement, state) {
    syncStashDrafts(newElement, priorElement);
    super._syncPartState(partId, newElement, priorElement, state);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = this.element;

    // Live search filter, applied in the DOM so the input keeps focus.
    const input = html.querySelector("input.fey-search-input");
    input?.addEventListener("input", event => {
      this.search = event.currentTarget.value;
      this.#applySearch();
    });
    this.#applySearch();

    // Remember which cards are expanded.
    for (const details of html.querySelectorAll("details.fey-card")) {
      details.addEventListener("toggle", () => {
        if (details.open) this.expanded.add(details.dataset.id);
        else this.expanded.delete(details.dataset.id);
      });
    }

    // Drag Actors onto the NPC tab to link or create NPC entries.
    if (context.editable && context.isNPCs) {
      const panel = html.querySelector(".fey-panel");
      panel.addEventListener("dragover", event => {
        event.preventDefault();
        event.target.closest(".fey-card, .fey-panel")?.classList.add("drag-over");
      });
      panel.addEventListener("dragleave", event => {
        event.target.closest(".fey-card, .fey-panel")?.classList.remove("drag-over");
      });
      panel.addEventListener("drop", this.#onDropActor.bind(this));
    }
  }

  #applySearch() {
    const term = this.search.trim().toLowerCase();
    for (const card of this.element.querySelectorAll(".fey-card")) {
      card.hidden = !!term && !card.dataset.search?.includes(term);
    }
  }

  async #onDropActor(event) {
    event.preventDefault();
    this.element.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    const data = getDragData(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = await fromUuid(data.uuid);
    if (!actor) return;

    const card = event.target.closest(".fey-card[data-type='npcs']");
    if (card) {
      await updateEntry("npcs", card.dataset.id, { actorUuid: actor.uuid, img: actor.img });
      ui.notifications.info(game.i18n.format("FEYHUB.NPC.Linked", { name: actor.name }));
    } else {
      await createEntry("npcs", { name: actor.name, description: "", actorUuid: actor.uuid, img: actor.img, disposition: "unknown" });
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #cardData(target) {
    const card = target.closest("[data-id][data-type]");
    return { type: card?.dataset.type, id: card?.dataset.id };
  }

  static #onSwitchTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static #onQuestFilter(event, target) {
    this.questFilter = target.dataset.filter;
    this.render();
  }

  static #onAdd(event, target) {
    FeyEntryEditor.open({ type: target.dataset.type });
  }

  static #onEdit(event, target) {
    const { type, id } = FeyHubApp.#cardData(target);
    FeyEntryEditor.open({ type, entryId: id });
  }

  static async #onDelete(event, target) {
    const { type, id } = FeyHubApp.#cardData(target);
    const found = getEntry(type, id);
    if (!found) return;
    const name = found.entry.title || found.entry.name || game.i18n.localize(`FEYHUB.Singular.${type}`);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "FEYHUB.Delete" },
      content: `<p>${game.i18n.format("FEYHUB.DeleteConfirm", { name: foundry.utils.escapeHTML?.(name) ?? name })}</p>`
    });
    if (confirmed) await deleteEntry(type, id);
  }

  static async #onToggleHidden(event, target) {
    if (!game.user.isGM) return;
    const { type, id } = FeyHubApp.#cardData(target);
    const found = getEntry(type, id);
    if (found) await setHidden(type, id, !found.hidden);
  }

  static async #onToggleObjective(event, target) {
    const { id } = FeyHubApp.#cardData(target);
    const found = getEntry("quests", id);
    if (!found || !canEdit()) {
      event.preventDefault();
      return;
    }
    const objectives = (found.entry.objectives ?? []).map(o =>
      o.id === target.dataset.objective ? { ...o, done: target.checked } : o
    );
    await updateEntry("quests", id, { objectives });
  }

  static async #onOpenActor(event, target) {
    const { id } = FeyHubApp.#cardData(target);
    const npc = getEntry("npcs", id)?.entry;
    const actor = npc?.actorUuid ? await fromUuid(npc.actorUuid) : null;
    if (!actor?.testUserPermission(game.user, "LIMITED")) {
      ui.notifications.warn("FEYHUB.NPC.NoAccess", { localize: true });
      return;
    }
    actor.sheet.render({ force: true });
  }

  static async #onUnlinkActor(event, target) {
    const { id } = FeyHubApp.#cardData(target);
    await updateEntry("npcs", id, { actorUuid: null });
  }

  static #onGotoNpc(event, target) {
    const npcId = target.dataset.npc;
    this.activeTab = "npcs";
    this.search = "";
    this.expanded.add(npcId);
    this.render().then(() => {
      const card = this.element.querySelector(`.fey-card[data-id="${npcId}"]`);
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
      card?.classList.add("flash");
    });
  }

  static #onPermissions() {
    new FeyHubPermissionsApp().render({ force: true });
  }
}
