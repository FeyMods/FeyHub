import {
  MODULE_ID, QUEST_STATUSES, RUMOUR_STATUSES, NPC_DISPOSITIONS,
  getEntries, getEntry, createEntry, updateEntry
} from "../data/hub-store.mjs";

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
      removeObjective: FeyEntryEditor.#onRemoveObjective
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
      objectives: (entry.objectives ?? []).map(o => ({ ...o, key: o.id })),
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
    const zone = this.element.querySelector(".fey-drop-zone");
    if (!zone) return;
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", this.#onDropActor.bind(this));
  }

  async #onDropActor(event) {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
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

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const hidden = game.user.isGM ? !!data.hidden : undefined;
    delete data.hidden;

    // Normalise blank selects/inputs to null so links can be cleared.
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string") data[k] = v.trim() || null;
    }

    if (this.type === "quests") {
      data.objectives = Object.values(data.objectives ?? {})
        .filter(o => o?.text?.trim())
        .map(o => ({ id: o.id || foundry.utils.randomID(), text: o.text.trim(), done: !!o.done }));
    }

    // Keep the portrait in step with the linked actor.
    if ((this.type === "npcs") && data.actorUuid) {
      data.img = fromUuidSync(data.actorUuid)?.img ?? data.img;
    }

    if (this.entryId) await updateEntry(this.type, this.entryId, data, { hidden });
    else await createEntry(this.type, data, { hidden: !!hidden });
  }
}
