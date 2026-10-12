import { getState, dispatch, canManage } from "./store.mjs";

/**
 * Character purse integration (dnd5e: coin lives at actor.system.currency.{pp,gp,ep,sp,cp}).
 * Stash currencies are matched to purse keys by id, then by abbreviation, so a custom stash
 * currency with no purse equivalent simply can't be moved to or from a character.
 */

const { DialogV2 } = foundry.applications.api;

/** The actor's coin record, or null if it has none. */
export function getPurse(actor) {
  const purse = actor?.system?.currency;
  return purse && typeof purse === "object" ? purse : null;
}

/** The purse key matching a stash currency, or null. */
export function purseKey(actor, currency) {
  const purse = getPurse(actor);
  if (!purse) return null;
  for (const key of [currency.id, currency.abbr?.toLowerCase()]) {
    if (key && key in purse) return key;
  }
  return null;
}

/** Characters the current user can move coin to and from, their assigned character first. */
export function transferActors() {
  const mine = game.user.character;
  return game.actors
    .filter(a => getPurse(a) && (game.user.isGM ? a.type === "character" : a.isOwner))
    .sort((a, b) => (b === mine) - (a === mine) || a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * Validate and send a transfer between a character's purse and the stash.
 * @param {Actor} actor
 * @param {"deposit"|"withdraw"} direction
 * @param {Record<string, number>} amounts  Stash currency id → amount.
 * @param {string} [note]
 * @returns {boolean} Whether the request was sent.
 */
export function transfer(actor, direction, amounts, note) {
  const state = getState();
  const purse = getPurse(actor);
  const valid = {};
  for (const [id, raw] of Object.entries(amounts)) {
    const amount = Math.trunc(Number(raw));
    if (!(amount > 0)) continue;
    const currency = state.currencies.find(c => c.id === id);
    const key = currency && purseKey(actor, currency);
    if (!key) continue;
    const deposit = direction === "deposit";
    const available = deposit ? Number(purse[key]) || 0 : currency.amount;
    if (amount > available) {
      ui.notifications.warn(game.i18n.format(`FEYPARTY.Notify.${deposit ? "InsufficientPurse" : "Insufficient"}`, {
        name: actor.name, amount: available, currency: currency.label
      }));
      return false;
    }
    valid[id] = amount;
  }
  if (!Object.keys(valid).length) {
    ui.notifications.warn("FEYPARTY.Notify.InvalidAmount", { localize: true });
    return false;
  }
  const type = direction === "deposit" ? "actorDeposit" : "actorWithdraw";
  return dispatch(type, { actorUuid: actor.uuid, amounts: valid, note });
}

/** Dialog for moving several denominations at once between a character and the stash. */
export async function openTransferDialog(actor) {
  const purse = getPurse(actor);
  const rows = getState().currencies
    .map(currency => ({ currency, key: purseKey(actor, currency) }))
    .filter(r => r.key);
  if (!purse || !rows.length) {
    ui.notifications.warn("FEYPARTY.Notify.NoMatchingCurrency", { localize: true });
    return;
  }

  const esc = foundry.utils.escapeHTML;
  const i18n = key => game.i18n.localize(`FEYPARTY.Transfer.${key}`);
  const content = `
    <table class="fp-transfer-table">
      <thead><tr>
        <th>${i18n("Currency")}</th><th>${i18n("Purse")}</th><th>${i18n("Stash")}</th><th>${i18n("Amount")}</th>
      </tr></thead>
      <tbody>${rows.map(({ currency, key }) => `
        <tr>
          <td>${esc(currency.label)}</td>
          <td>${Number(purse[key]) || 0}</td>
          <td>${currency.amount}</td>
          <td><input type="number" name="${esc(currency.id)}" min="0" step="1" placeholder="0"></td>
        </tr>`).join("")}
      </tbody>
    </table>
    <input type="text" name="note" maxlength="120" placeholder="${game.i18n.localize("FEYPARTY.Note")}">`;

  const read = direction => (event, button) => {
    const { note, ...amounts } = new foundry.applications.ux.FormDataExtended(button.form).object;
    return { direction, amounts, note };
  };
  const result = await DialogV2.wait({
    window: {
      title: game.i18n.format("FEYPARTY.Transfer.Title", { name: actor.name }),
      icon: "fa-solid fa-sack-dollar"
    },
    classes: ["fey-party-transfer"],
    content,
    buttons: [
      { action: "deposit", label: "FEYPARTY.Transfer.Deposit", icon: "fa-solid fa-piggy-bank", default: true, callback: read("deposit") },
      { action: "withdraw", label: "FEYPARTY.Transfer.Withdraw", icon: "fa-solid fa-hand-holding-dollar", callback: read("withdraw") }
    ],
    rejectClose: false
  });
  if (result) transfer(actor, result.direction, result.amounts, result.note);
}

/** Characters the stash can be divided among: player characters, plus any character for a GM. */
function splitActors() {
  return game.actors
    .filter(a => a.type === "character" && getPurse(a) && (a.hasPlayerOwner || game.user.isGM))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/** Dialog for dividing the stash's coin evenly among several characters. Remainders stay in the stash. */
export async function openSplitDialog() {
  if (!canManage()) return;
  const actors = splitActors();
  const currencies = getState().currencies.filter(c => c.amount > 0 && actors.some(a => purseKey(a, c)));
  if (!actors.length || !currencies.length) {
    ui.notifications.warn(`FEYPARTY.Notify.${actors.length ? "NothingToSplit" : "NoSplitActors"}`, { localize: true });
    return;
  }

  const esc = foundry.utils.escapeHTML;
  const i18n = key => game.i18n.localize(`FEYPARTY.Split.${key}`);
  const content = `
    <fieldset class="fp-split-actors">
      <legend>${i18n("Characters")}</legend>
      ${actors.map(a => `
        <label><input type="checkbox" name="actor" value="${esc(a.uuid)}" ${a.hasPlayerOwner ? "checked" : ""}> ${esc(a.name)}</label>`).join("")}
    </fieldset>
    <table class="fp-transfer-table">
      <thead><tr>
        <th></th><th>${i18n("Currency")}</th><th>${i18n("Stash")}</th><th>${i18n("Each")}</th><th>${i18n("Left")}</th>
      </tr></thead>
      <tbody>${currencies.map(c => `
        <tr data-id="${esc(c.id)}">
          <td><input type="checkbox" name="currency" value="${esc(c.id)}" checked></td>
          <td>${esc(c.label)}</td>
          <td>${c.amount}</td>
          <td class="fp-each"></td>
          <td class="fp-left"></td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  // Live preview of each share and what stays behind.
  const preview = (event, dialog) => {
    const form = dialog.element.querySelector("form") ?? dialog.element;
    const update = () => {
      const count = form.querySelectorAll('[name="actor"]:checked').length;
      for (const c of currencies) {
        const row = form.querySelector(`tr[data-id="${CSS.escape(c.id)}"]`);
        const each = count && row.querySelector('[name="currency"]').checked ? Math.floor(c.amount / count) : 0;
        row.querySelector(".fp-each").textContent = each;
        row.querySelector(".fp-left").textContent = c.amount - each * count;
      }
    };
    form.addEventListener("change", update);
    update();
  };

  const result = await DialogV2.wait({
    window: { title: "FEYPARTY.Split.Title", icon: "fa-solid fa-people-arrows" },
    classes: ["fey-party-transfer"],
    content,
    render: preview,
    buttons: [{
      action: "split",
      label: "FEYPARTY.Split.Confirm",
      icon: "fa-solid fa-people-arrows",
      default: true,
      callback: (event, button) => {
        const checked = name => [...button.form.querySelectorAll(`[name="${name}"]:checked`)].map(i => i.value);
        return { actorUuids: checked("actor"), currencyIds: checked("currency") };
      }
    }],
    rejectClose: false
  });
  if (!result) return;
  if (!result.actorUuids.length || !result.currencyIds.length) {
    ui.notifications.warn("FEYPARTY.Notify.NothingToSplit", { localize: true });
    return;
  }
  dispatch("splitStash", result);
}

/** Add "Party Stash" buttons to character sheets. */
export function registerSheetIntegration() {
  // A button beside the coins on the dnd5e sheet's inventory tab.
  Hooks.on("renderActorSheetV2", (app, element) => {
    const actor = app.document;
    if (!actor?.isOwner || !getPurse(actor)) return;
    const section = element.querySelector("section.currency");
    if (!section || section.querySelector(".fey-stash-sheet-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "unbutton always-interactive fey-stash-sheet-button";
    button.dataset.tooltip = "FEYPARTY.Transfer.Button";
    button.ariaLabel = game.i18n.localize("FEYPARTY.Transfer.Button");
    button.innerHTML = '<i class="fa-solid fa-sack-dollar" inert></i>';
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openTransferDialog(actor);
    });
    section.prepend(button);
  });

  // The same, in the sheet's header menu (works on any sheet layout).
  Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
    const actor = app.document;
    if (!actor?.isOwner || !getPurse(actor)) return;
    app.options.actions.feyManagerStashTransfer ??= function() { openTransferDialog(this.document); };
    controls.push({ icon: "fa-solid fa-sack-dollar", label: "FEYPARTY.Transfer.Button", action: "feyManagerStashTransfer" });
  });
}
