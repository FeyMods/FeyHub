import {
  MODULE_ID, TYPES, QUEST_STATUSES, RUMOUR_STATUSES,
  getHubJournal, getEntries, getEntry, canEdit, canDelete,
  createEntry, updateEntry, deleteEntry, setHidden, objectiveList, objectiveRecord
} from "../data/hub-store.mjs";
import { RICH_FIELDS, HTML_FORMAT, enrichEntry, htmlText, storedHTML } from "../data/rich-text.mjs";
import { rewardSummary } from "../data/rewards.mjs";
import { getLastSeen, isUnread, entryBadge, unreadLog, markSeen } from "../data/unread.mjs";
import { getState, canAdjust } from "../stash/store.mjs";
import { offerRewards } from "./rewards-prompt.mjs";
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
      payRewards: FeyHubApp.#onPayRewards,
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

  /**
   * The tab being looked at, and when the user had last seen it before opening it. Cards keep
   * their New/Updated badges against that time until the user leaves the tab or closes the hub,
   * even though the tab is marked seen as soon as it's shown.
   */
  #viewedTab = null;
  #viewedSince = null;

  /** Whether the open tab has unread changes, so _onRender should mark it seen. */
  #needsSeen = false;

  /** Tell the user how many entries changed since they last looked, if any. */
  static notifyUnread() {
    if (!getHubJournal()) return;
    const seen = getLastSeen();
    const count = TYPES.reduce((n, type) => n + getEntries(type).filter(e => isUnread(e, seen[type])).length, 0);
    if (count) ui.notifications.info(game.i18n.format("FEYHUB.Unread.Login", { count }));
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const ready = !!getHubJournal();
    const editable = ready && canEdit();
    const npcs = getEntries("npcs");
    const npcById = new Map(npcs.map(n => [n.id, n]));
    const counts = {};

    // Unread tracking: badge cards against the time the user last saw the open tab.
    const seen = getLastSeen();
    if (this.#viewedTab !== this.activeTab) {
      this.#viewedTab = this.activeTab;
      this.#viewedSince = seen[this.activeTab];
    }
    const sinceFor = type => (type === this.activeTab ? this.#viewedSince : seen[type]);

    // Enrich the rich text of the open tab's entries; only that tab is rendered.
    const richHTML = new Map();
    if (this.activeTab in RICH_FIELDS) {
      const entries = this.activeTab === "npcs" ? npcs : getEntries(this.activeTab);
      await Promise.all(entries.map(async e => richHTML.set(e.id, await enrichEntry(this.activeTab, e))));
    }

    // Searched as displayed, so players can't find a card by text in a GM-only secret block.
    const richText = e => htmlText(richHTML.get(e.id));

    const decorate = (type, e) => ({
      ...e,
      type,
      richHTML: richHTML.get(e.id) ?? "",
      badge: entryBadge(e, sinceFor(type)),
      badgeLabel: { new: game.i18n.localize("FEYHUB.Unread.New"), updated: game.i18n.localize("FEYHUB.Unread.Updated") }[entryBadge(e, sinceFor(type))],
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
    const stashCurrencies = getState().currencies;
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
        const objectives = objectiveList(q.objectives);
        const giver = npcRef(q.giverNpcId);
        const rewards = rewardSummary(q, stashCurrencies);
        return {
          ...decorate("quests", q),
          rewards,
          rewardsPaid: q.rewardsPaid ? game.i18n.format("FEYHUB.Reward.PaidBy", {
            name: q.rewardsPaid.user,
            date: new Date(q.rewardsPaid.time).toLocaleDateString()
          }) : null,
          canPayRewards: editable && canAdjust() && (q.status === "completed") && !q.rewardsPaid && rewards.any,
          objectives,
          doneCount: objectives.filter(o => o.done).length,
          statusLabel: game.i18n.localize(`FEYHUB.Quest.Status.${q.status ?? "active"}`),
          giver,
          searchText: [q.title, richText(q), giver?.name, ...objectives.map(o => o.text)].join(" ").toLowerCase()
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
        searchText: [richText(r), r.source, r.location, sourceNpc?.name].join(" ").toLowerCase()
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
        searchText: [n.name, richText(n), canView ? actor.name : ""].join(" ").toLowerCase()
      };
    });
    counts.npcs = npcList.length;

    // Notes
    const notes = getEntries("notes").sort(byUpdated).map(n => ({
      ...decorate("notes", n),
      searchText: [n.title, richText(n)].join(" ").toLowerCase()
    }));
    counts.notes = notes.length;

    // Unread counts per tab; the open tab is being looked at, so it shows none.
    const entriesByTab = { quests: allQuests, rumours, npcs: npcList, notes };
    const unread = {};
    for (const [tab, entries] of Object.entries(entriesByTab)) {
      unread[tab] = entries.filter(e => isUnread(e, seen[tab])).length;
    }
    unread.stash = unreadLog(getState().log, seen.stash).length;
    this.#needsSeen = (unread[this.activeTab] ?? 0) > 0;

    const tabs = TABS.map(t => ({
      ...t,
      label: game.i18n.localize(t.label),
      count: counts[t.id],
      hasCount: t.id in counts,
      unread: (t.id === this.activeTab) ? 0 : unread[t.id],
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

  /** Next time the hub opens, badge the open tab against a fresh last-seen time. */
  _onClose(options) {
    super._onClose(options);
    this.#viewedTab = null;
  }

  /** Keep half-typed stash entries when another user's change re-renders the hub. */
  _syncPartState(partId, newElement, priorElement, state) {
    syncStashDrafts(newElement, priorElement);
    super._syncPartState(partId, newElement, priorElement, state);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = this.element;

    // The open tab has now been seen.
    if (this.#needsSeen) {
      this.#needsSeen = false;
      markSeen(this.activeTab);
    }

    // Live search filter, applied in the DOM so the input keeps focus.
    const input = html.querySelector("input.fey-search-input");
    input?.addEventListener("input", event => {
      this.search = event.currentTarget.value;
      this.#applySearch();
    });
    this.#applySearch();

    // Secret blocks: enrichHTML wraps them in <secret-block> elements whose Reveal/Hide button
    // only fires a "change" event, so the hub saves the toggle itself. Only the GM may toggle;
    // players never see unrevealed secrets and shouldn't be able to hide revealed ones.
    for (const block of html.querySelectorAll(".fey-rich secret-block")) {
      if (game.user.isGM) block.addEventListener("change", this.#onRevealSecret.bind(this));
      else block.querySelector(":scope > .secret > button.reveal")?.remove();
    }

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

  /** Toggle a secret block's revealed state in the entry's stored text. */
  async #onRevealSecret(event) {
    event.stopPropagation();
    const block = event.currentTarget;
    const card = block.closest(".fey-card[data-type][data-id]");
    const type = card?.dataset.type;
    if (!game.user.isGM || !(type in RICH_FIELDS)) return;
    const found = getEntry(type, card.dataset.id);
    if (!found) return;
    const content = storedHTML(type, found.entry);
    const modified = block.toggleRevealed(content);
    if (modified === content) return;
    await updateEntry(type, card.dataset.id, { [RICH_FIELDS[type]]: modified, format: HTML_FORMAT });
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
    const objectiveId = target.dataset.objective;
    const stored = found.entry.objectives;
    // Change only this objective's key, so other users' ticks on the same quest aren't lost.
    // A quest still holding an old objectives array is rewritten as a record instead.
    const objectives = Array.isArray(stored)
      ? objectiveRecord(objectiveList(stored).map(o => (o.id === objectiveId ? { ...o, done: target.checked } : o)))
      : { [objectiveId]: { done: target.checked } };
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

  static #onPayRewards(event, target) {
    const { id } = FeyHubApp.#cardData(target);
    const quest = getEntry("quests", id)?.entry;
    if (quest && !quest.rewardsPaid) offerRewards(quest);
  }

  static #onPermissions() {
    new FeyHubPermissionsApp().render({ force: true });
  }
}
