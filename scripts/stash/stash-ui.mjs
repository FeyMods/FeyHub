import { getState, canManage, dispatch } from "./store.mjs";
import { transfer, transferActors, openSplitDialog } from "./purse.mjs";

/**
 * The Party Stash interface, shared by the standalone stash window and the hub's Stash tab.
 * Both render templates/party-stash.hbs, register STASH_ACTIONS, call attachStashListeners()
 * once and syncStashDrafts() on every re-render.
 */

const { DialogV2 } = foundry.applications.api;

/** Template context for the stash; `logOpen` is the owning app's activity-log state. */
export function prepareStashContext(logOpen = false) {
  const state = getState();
  return {
    currencies: state.currencies,
    resources: state.resources,
    log: state.log.map(entry => ({ ...entry, timeLabel: new Date(entry.time).toLocaleString() })),
    actors: transferActors().map(a => ({ uuid: a.uuid, name: a.name, selected: a === game.user.character })),
    canManage: canManage(),
    isGM: game.user.isGM,
    logOpen
  };
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/** Shift = x10, Ctrl/Cmd = x100. */
function step(event) {
  if (event.ctrlKey || event.metaKey) return 100;
  if (event.shiftKey) return 10;
  return 1;
}

function rowId(target) {
  return target.closest("[data-id]")?.dataset.id;
}

function draft(target, name) {
  return target.closest(".fp-form")?.querySelector(`[data-draft="${name}"]`);
}

function onAdjustCurrency(event, target) {
  const delta = Number(target.dataset.delta) * step(event);
  dispatch("currencyAdjust", { id: rowId(target), delta });
}

function onTransaction(event, target) {
  const amountInput = draft(target, "txAmount");
  const noteInput = draft(target, "txNote");
  const currencyId = draft(target, "txCurrency")?.value;
  const actorUuid = draft(target, "txActor")?.value;
  const amount = Math.trunc(Number(amountInput?.value));
  if (!currencyId || !(amount > 0)) {
    ui.notifications.warn("FEYPARTY.Notify.InvalidAmount", { localize: true });
    return;
  }
  const direction = target.dataset.direction;
  let sent;

  // Moving coin to or from a character's purse.
  if (actorUuid) {
    const actor = fromUuidSync(actorUuid);
    if (!actor) return;
    sent = transfer(actor, direction, { [currencyId]: amount }, noteInput?.value);
  }

  // Adjusting the stash alone.
  else {
    const withdraw = direction === "withdraw";
    if (withdraw) {
      const currency = getState().currencies.find(c => c.id === currencyId);
      if (!currency || currency.amount < amount) {
        ui.notifications.warn(game.i18n.format("FEYPARTY.Notify.Insufficient", {
          currency: currency?.label ?? "", amount: currency?.amount ?? 0
        }));
        return;
      }
    }
    sent = dispatch("currencyAdjust", { id: currencyId, delta: withdraw ? -amount : amount, note: noteInput?.value });
  }

  if (!sent) return;
  amountInput.value = "";
  if (noteInput) noteInput.value = "";
}

function onAddCurrency(event, target) {
  const labelInput = draft(target, "currencyLabel");
  const abbrInput = draft(target, "currencyAbbr");
  if (!labelInput?.value.trim()) return labelInput?.focus();
  dispatch("currencyAdd", { label: labelInput.value, abbr: abbrInput?.value });
  labelInput.value = "";
  if (abbrInput) abbrInput.value = "";
}

async function onRemoveCurrency(event, target) {
  const id = rowId(target);
  const currency = getState().currencies.find(c => c.id === id);
  if (!currency) return;
  const confirmed = await DialogV2.confirm({
    window: { title: "FEYPARTY.Confirm.RemoveCurrencyTitle" },
    content: `<p>${game.i18n.format("FEYPARTY.Confirm.RemoveCurrency", {
      currency: foundry.utils.escapeHTML(currency.label), amount: currency.amount
    })}</p>`
  });
  if (confirmed) dispatch("currencyRemove", { id });
}

function onAdjustResource(event, target) {
  const delta = Number(target.dataset.delta) * step(event);
  dispatch("resourceAdjust", { id: rowId(target), delta });
}

function onAddResource(event, target) {
  const nameInput = draft(target, "resourceName");
  const qtyInput = draft(target, "resourceQty");
  const notesInput = draft(target, "resourceNotes");
  if (!nameInput?.value.trim()) return nameInput?.focus();
  dispatch("resourceAdd", {
    name: nameInput.value,
    quantity: qtyInput?.value === "" ? 1 : qtyInput?.value,
    notes: notesInput?.value
  });
  nameInput.value = "";
  if (qtyInput) qtyInput.value = "";
  if (notesInput) notesInput.value = "";
  nameInput.focus();
}

async function onRemoveResource(event, target) {
  const id = rowId(target);
  const resource = getState().resources.find(r => r.id === id);
  if (!resource) return;
  const confirmed = await DialogV2.confirm({
    window: { title: "FEYPARTY.Confirm.RemoveResourceTitle" },
    content: `<p>${game.i18n.format("FEYPARTY.Confirm.RemoveResource", {
      name: foundry.utils.escapeHTML(resource.name)
    })}</p>`
  });
  if (confirmed) dispatch("resourceRemove", { id });
}

async function onOpenResourceItem(event, target) {
  const resource = getState().resources.find(r => r.id === rowId(target));
  const item = resource?.itemUuid ? await fromUuid(resource.itemUuid) : null;
  if (!item) {
    ui.notifications.warn("FEYPARTY.Notify.ItemMissing", { localize: true });
    return;
  }
  item.sheet.render(true);
}

function onUnlinkResource(event, target) {
  dispatch("resourceUnlink", { id: rowId(target) });
}

async function onClearLog() {
  const confirmed = await DialogV2.confirm({
    window: { title: "FEYPARTY.Confirm.ClearLogTitle" },
    content: `<p>${game.i18n.localize("FEYPARTY.Confirm.ClearLog")}</p>`
  });
  if (confirmed) dispatch("logClear");
}

export const STASH_ACTIONS = {
  adjustCurrency: onAdjustCurrency,
  transaction: onTransaction,
  split: () => openSplitDialog(),
  addCurrency: onAddCurrency,
  removeCurrency: onRemoveCurrency,
  adjustResource: onAdjustResource,
  addResource: onAddResource,
  removeResource: onRemoveResource,
  openResourceItem: onOpenResourceItem,
  unlinkResource: onUnlinkResource,
  clearLog: onClearLog
};

/* -------------------------------------------- */
/*  Listeners                                   */
/* -------------------------------------------- */

/** Inline edits of existing rows commit on change (blur or Enter). */
function onFieldChange(event) {
  const input = event.target;
  const field = input.dataset?.field;
  if (!field || !input.closest(".fey-stash")) return;
  const id = rowId(input);
  switch (field) {
    case "currencyAmount": return dispatch("currencySet", { id, value: input.value });
    case "resourceQty": return dispatch("resourceSet", { id, value: input.value });
    case "resourceName": return dispatch("resourceUpdate", { id, name: input.value });
    case "resourceNotes": return dispatch("resourceUpdate", { id, notes: input.value });
  }
}

/** Enter inside a "new entry" form presses that form's default button. */
function onKeyDown(event) {
  if (event.key !== "Enter" || !event.target.dataset?.draft) return;
  const button = event.target.closest(".fp-form")?.querySelector("[data-default]");
  if (!button) return;
  event.preventDefault();
  button.click();
}

/** The drop target under a drag: a resource row if over one, otherwise the resources section. */
function dropTarget(event) {
  const section = event.target.closest?.(".fey-stash .fp-resources");
  return section && (event.target.closest(".fp-resource") ?? section);
}

function clearDragOver(element) {
  element.querySelectorAll(".fey-stash .drag-over").forEach(el => el.classList.remove("drag-over"));
}

function onDragOver(event) {
  const target = dropTarget(event);
  if (!target) return;
  event.preventDefault();
  if (target.classList.contains("drag-over")) return;
  clearDragOver(event.currentTarget);
  target.classList.add("drag-over");
}

function onDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) clearDragOver(event.currentTarget);
}

/** Items dropped on the resources create or link resources. */
function onDrop(event) {
  const target = dropTarget(event);
  clearDragOver(event.currentTarget);
  if (!target) return;
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  if (data?.type !== "Item" || !data.uuid) return;
  event.preventDefault();
  dispatch("resourceDropItem", { itemUuid: data.uuid, id: target.matches(".fp-resource") ? target.dataset.id : undefined });
}

/**
 * Attach the stash's delegated listeners to an app's root element. Call once, from _onFirstRender.
 * The activity log's open state is kept on `app.stashLogOpen`.
 */
export function attachStashListeners(app) {
  const element = app.element;
  element.addEventListener("change", onFieldChange);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("dragover", onDragOver);
  element.addEventListener("dragleave", onDragLeave);
  element.addEventListener("drop", onDrop);
  element.addEventListener("toggle", event => {
    if (event.target.matches?.("details.fp-log")) app.stashLogOpen = event.target.open;
  }, true);
}

/** Keep half-typed values in the "new entry" fields when another player's change re-renders the stash. */
export function syncStashDrafts(newElement, priorElement) {
  for (const input of priorElement.querySelectorAll("[data-draft]")) {
    const target = newElement.querySelector(`[data-draft="${input.dataset.draft}"]`);
    if (target) target.value = input.value;
  }
}
