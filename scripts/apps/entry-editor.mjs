import {
  MODULE_ID, QUEST_STATUSES, RUMOUR_STATUSES, NPC_DISPOSITIONS,
  getEntries, getEntry, createEntry, updateEntry, objectiveList, objectiveRecord
} from "../data/hub-store.mjs";
import { RICH_FIELDS, HTML_FORMAT, storedHTML, isBlankHTML } from "../data/rich-text.mjs";
import { hasRewards, rewardItems } from "../data/rewards.mjs";
import { getState, canAdjust } from "../stash/store.mjs";
import { offerRewards } from "./rewards-prompt.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Build a {value: label} choices object from a list of keys. */
function choices(keys, prefix) {
  return Object.fromEntries(keys.map(k => [k, game.i18n.localize(`${prefix}.${k}`)]));
}

/**
 * Form for creating or editing a single hub entry.
 */
export class FeyEntryEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  /** Open an editor, or bring an existing one for the same entry to the front. */
  static open({ type, entryId }) {
    const id = `fey-editor-${type}-${entryId ?? foundry.utils.randomID()}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new FeyEntryEditor({ id, type, entryId }).render({ force: true });
  }

  constructor({ type, entryId, ...options } = {}) {
    super(options);
    this.type = type;
    this.entryId = entryId ?? null;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["fey-hub", "fey-editor"],
    window: {
      icon: "fa-solid fa-pen-to-square",
      resizable: true
    },
    position: { width: 480, height: "auto" },
    form: {
      handler: FeyEntryEditor.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      addObjective: FeyEntryEditor.#onAddObjective,
      removeObjective: FeyEntryEditor.#onRemoveObjective,
      removeReward: FeyEntryEditor.#onRemoveReward
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/entry-editor.hbs` }
  };

  get title() {
    const kind = game.i18n.localize(`FEYHUB.Singular.${this.type}`);
    const key = this.entryId ? "FEYHUB.EditTitle" : "FEYHUB.NewTitle";
    return game.i18n.format(key, { kind });
  }

  async _prepareContext(options) {
    const found = this.entryId ? getEntry(this.type, this.entryId) : null;
    const entry = found?.entry ?? {};
    const npcChoices = Object.fromEntries(
      getEntries("npcs")
        .filter(n => n.id !== this.entryId)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map(n => [n.id, n.name])
    );
    const actorChoices = Object.fromEntries(
      game.actors
        .filter(a => a.testUserPermission(game.user, "LIMITED"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(a => [a.uuid, a.name])
    );
    // Keep the current link selectable even if it isn't a visible world actor.
    if (entry.actorUuid && !(entry.actorUuid in actorChoices)) {
      actorChoices[entry.actorUuid] = fromUuidSync(entry.actorUuid)?.name ?? entry.actorUuid;
    }

    return {
      entry,
      isGM: game.user.isGM,
      hidden: found?.hidden ?? false,
      isQuest: this.type === "quests",
      isRumour: this.type === "rumours",
      isNPC: this.type === "npcs",
      isNote: this.type === "notes",
      richText: storedHTML(this.type, entry),
      rewardCurrencies: getState().currencies.map(c => ({
        id: c.id,
        abbr: c.abbr || c.label,
        amount: entry.rewards?.coins?.[c.id] || ""
      })),
      rewardItems: rewardItems(entry),
      rewardsPaid: entry.rewardsPaid ? game.i18n.format("FEYHUB.Reward.PaidBy", {
        name: entry.rewardsPaid.user,
        date: new Date(entry.rewardsPaid.time).toLocaleDateString()
      }) : null,
      objectives: objectiveList(entry.objectives).map(o => ({ ...o, key: o.id })),
      questStatuses: choices(QUEST_STATUSES, "FEYHUB.Quest.Status"),
      rumourStatuses: choices(RUMOUR_STATUSES, "FEYHUB.Rumour.Status"),
      dispositions: choices(NPC_DISPOSITIONS, "FEYHUB.NPC.Disposition"),
      npcChoices,
      actorChoices,
      submitLabel: game.i18n.localize(this.entryId ? "FEYHUB.Save" : "FEYHUB.Create")
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const zones = [
      [this.element.querySelector(".fey-drop-zone:not(.fey-reward-drop)"), this.#onDropActor],
      [this.element.querySelector(".fey-reward-drop"), this.#onDropReward]
    ];
    for (const [zone, handler] of zones) {
      if (!zone) continue;
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", handler.bind(this));
    }
  }

  /** Read Foundry drag data from a drop on one of the editor's drop zones. */
  static #dropData(event) {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    try {
      return JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return null;
    }
  }

  /** An Item dropped on the rewards: add it, or add one more of it if it's already listed. */
  async #onDropReward(event) {
    const data = FeyEntryEditor.#dropData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid);
    if (!(item instanceof Item)) return;

    const list = this.element.querySelector(".fey-reward-items");
    for (const row of list.querySelectorAll(".fey-reward-row")) {
      if (row.querySelector("input[name$='.uuid']")?.value !== item.uuid) continue;
      const quantity = row.querySelector("input[name$='.quantity']");
      quantity.value = (Math.trunc(Number(quantity.value)) || 0) + 1;
      return;
    }

    const key = foundry.utils.randomID();
    const esc = foundry.utils.escapeHTML;
    const row = document.createElement("li");
    row.className = "fey-reward-row";
    row.innerHTML = `
      <input type="hidden" name="rewards.items.${key}.uuid" value="${esc(item.uuid)}">
      <input type="hidden" name="rewards.items.${key}.name" value="${esc(item.name)}">
      <input type="hidden" name="rewards.items.${key}.img" value="${esc(item.img ?? "")}">
      <img src="${esc(item.img ?? "")}" alt="">
      <span class="fey-reward-name">${esc(item.name)}</span>
      <input type="number" name="rewards.items.${key}.quantity" value="1" min="1" step="1">
      <button type="button" class="fey-icon-btn" data-action="removeReward" data-tooltip="FEYHUB.Remove">
        <i class="fa-solid fa-xmark"></i>
      </button>`;
    list.append(row);
  }

  async #onDropActor(event) {
    const data = FeyEntryEditor.#dropData(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = await fromUuid(data.uuid);
    if (!actor) return;

    const form = this.element;
    const select = form.querySelector("select[name='actorUuid']");
    if (![...select.options].some(o => o.value === actor.uuid)) {
      select.add(new Option(actor.name, actor.uuid));
    }
    select.value = actor.uuid;
    form.querySelector("input[name='img']").value = actor.img ?? "";
    const name = form.querySelector("input[name='name']");
    if (!name.value.trim()) name.value = actor.name;
  }

  /* -------------------------------------------- */

  static #onAddObjective(event, target) {
    const list = this.element.querySelector(".fey-objectives");
    const key = foundry.utils.randomID();
    const row = document.createElement("li");
    row.className = "fey-objective-row";
    row.innerHTML = `
      <input type="hidden" name="objectives.${key}.id" value="${key}">
      <input type="checkbox" name="objectives.${key}.done">
      <input type="text" name="objectives.${key}.text" placeholder="${game.i18n.localize("FEYHUB.Quest.ObjectivePlaceholder")}">
      <button type="button" class="fey-icon-btn" data-action="removeObjective" data-tooltip="FEYHUB.Remove">
        <i class="fa-solid fa-xmark"></i>
      </button>`;
    list.append(row);
    row.querySelector("input[type='text']").focus();
  }

  static #onRemoveObjective(event, target) {
    target.closest(".fey-objective-row")?.remove();
  }

  static #onRemoveReward(event, target) {
    target.closest(".fey-reward-row")?.remove();
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const hidden = game.user.isGM ? !!data.hidden : undefined;
    delete data.hidden;

    // Normalise blank selects/inputs to null so links can be cleared.
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string") data[k] = v.trim() || null;
    }

    // The rich text field is saved as HTML from the editor; an empty paragraph counts as blank.
    const field = RICH_FIELDS[this.type];
    if (isBlankHTML(data[field])) data[field] = null;
    if (!data[field] && ["rumours", "notes"].includes(this.type)) {
      throw new Error(game.i18n.localize("FEYHUB.Warn.TextRequired"));
    }
    data.format = HTML_FORMAT;

    // Objectives and rewards are saved as records; keys removed in the form are deleted.
    const remove = {};
    const previous = this.entryId ? getEntry(this.type, this.entryId) : null;
    if (this.type === "quests") {
      const list = Object.values(data.objectives ?? {})
        .filter(o => o?.text?.trim())
        .map(o => ({ id: o.id || foundry.utils.randomID(), text: o.text.trim(), done: !!o.done }));
      data.objectives = objectiveRecord(list);
      const before = objectiveList(previous?.entry.objectives);
      remove.objectives = before.map(o => o.id).filter(id => !(id in data.objectives));

      data.rewards = FeyEntryEditor.#readRewards(data.rewards);
      remove["rewards.coins"] = Object.keys(previous?.entry.rewards?.coins ?? {}).filter(id => !(id in data.rewards.coins));
      remove["rewards.items"] = Object.keys(previous?.entry.rewards?.items ?? {}).filter(id => !(id in data.rewards.items));
    }

    // Keep the portrait in step with the linked actor.
    if ((this.type === "npcs") && data.actorUuid) {
      data.img = fromUuidSync(data.actorUuid)?.img ?? data.img;
    }

    const saved = this.entryId
      ? await updateEntry(this.type, this.entryId, data, { hidden, remove })
      : await createEntry(this.type, data, { hidden: !!hidden });

    // Completing a quest offers to pay its rewards into the stash.
    const completed = (this.type === "quests") && (data.status === "completed") && (previous?.entry.status !== "completed");
    if (saved && completed && canAdjust() && !saved.rewardsPaid && hasRewards(saved)) offerRewards(saved);
  }

  /** The rewards from the form: whole positive coin amounts, and items with a quantity of at least 1. */
  static #readRewards(raw = {}) {
    const toInt = value => Math.trunc(Number(value)) || 0;
    const coins = {};
    for (const [id, amount] of Object.entries(raw.coins ?? {})) {
      if (toInt(amount) > 0) coins[id] = toInt(amount);
    }
    const items = {};
    Object.entries(raw.items ?? {}).forEach(([id, item], sort) => {
      if (!item?.uuid) return;
      items[id] = { id, uuid: item.uuid, name: item.name ?? "", img: item.img ?? "", quantity: Math.max(1, toInt(item.quantity)), sort };
    });
    return { coins, items };
  }
}
