import { MODULE_ID, SOCKET, LOG_LIMIT, DEFAULT_STATE, depositedFlag } from "./constants.mjs";
import { getPurse, purseKey } from "./purse.mjs";
import { messageText, parseCoins } from "./coins.mjs";

/**
 * Shared party state lives in a world setting. Only GMs may write world settings,
 * so player changes are sent over the module socket as small operations and the
 * active GM applies them one at a time. Sending operations (rather than whole
 * snapshots) means simultaneous edits by different players never clobber each other.
 */

/** Return a mutable copy of the current shared state. */
export function getState() {
  const stored = game.settings.get(MODULE_ID, "stash") ?? {};
  return foundry.utils.deepClone({
    currencies: Array.isArray(stored.currencies) ? stored.currencies : DEFAULT_STATE.currencies,
    resources: Array.isArray(stored.resources) ? stored.resources : [],
    log: Array.isArray(stored.log) ? stored.log : []
  });
}

/** Whether a user may add/remove currency types and delete resources. */
export function canManage(user = game.user) {
  return user.isGM || game.settings.get(MODULE_ID, "playersManage");
}

/**
 * Request a change to the shared state. GMs apply directly; players relay to the active GM.
 * @returns {boolean} Whether the request was sent.
 */
export function dispatch(type, payload = {}) {
  if (game.user.isGM) {
    enqueue(type, payload, game.user.id);
    return true;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn("FEYPARTY.Notify.NoGM", { localize: true });
    return false;
  }
  game.socket.emit(SOCKET, { type, payload, userId: game.user.id });
  return true;
}

export function registerSocket() {
  game.socket.on(SOCKET, ({ type, payload, userId } = {}) => {
    if (type === "notify") {
      if (payload?.userId === game.user.id) ui.notifications.warn(game.i18n.format(payload.key, payload.data));
      return;
    }
    // Exactly one GM handles each request.
    if (game.user !== game.users.activeGM) return;
    enqueue(type, payload, userId);
  });
}

/** A request the GM refused; the requesting user is told why. */
class Rejection extends Error {
  constructor(key, data = {}) {
    super(key);
    this.key = `FEYPARTY.Notify.${key}`;
    this.data = data;
  }
}

function notify(userId, key, data) {
  if (userId === game.user.id) ui.notifications.warn(game.i18n.format(key, data));
  else game.socket.emit(SOCKET, { type: "notify", payload: { userId, key, data } });
}

let queue = Promise.resolve();

function enqueue(type, payload, userId) {
  queue = queue
    .then(() => apply(type, payload, userId))
    .catch(err => console.error(`${MODULE_ID} | Failed to apply "${type}"`, err));
  return queue;
}

async function apply(type, payload, userId) {
  const op = OPERATIONS[type];
  const user = game.users.get(userId);
  if (!op || !user) return;
  if (op.gmOnly && !user.isGM) return;
  if (op.manage && !canManage(user)) return;

  const state = getState();
  let message;
  try {
    message = await op.fn(state, payload ?? {}, user);
  } catch (err) {
    if (!(err instanceof Rejection)) throw err;
    return notify(userId, err.key, err.data);
  }
  if (message === false) return;
  if (message) {
    state.log.unshift({ id: foundry.utils.randomID(), time: Date.now(), user: user.name, text: message });
    state.log.length = Math.min(state.log.length, LOG_LIMIT);
  }
  await game.settings.set(MODULE_ID, "stash", state);
}

/* -------------------------------------------- */
/*  Operations                                  */
/* -------------------------------------------- */

const toInt = value => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
};
const clean = (value, max = 64) => String(value ?? "").trim().slice(0, max);
const fmt = (key, data) => game.i18n.format(`FEYPARTY.Log.${key}`, data);
const withNote = (text, note) => (note ? `${text} — ${note}` : text);

/** Validate a character transfer request and pair each stash currency with its purse key. */
function resolveTransfer(state, actorUuid, amounts, user) {
  const actor = typeof actorUuid === "string" ? fromUuidSync(actorUuid) : null;
  if (!(actor instanceof Actor) || !getPurse(actor)) throw new Rejection("NoActor");
  if (!actor.testUserPermission(user, "OWNER")) throw new Rejection("NotOwner", { name: actor.name });
  const moves = [];
  for (const [id, raw] of Object.entries(amounts ?? {})) {
    const amount = toInt(raw);
    if (amount <= 0) continue;
    const currency = state.currencies.find(c => c.id === id);
    const key = currency && purseKey(actor, currency);
    if (key) moves.push({ currency, key, amount });
  }
  if (!moves.length) throw new Rejection("InvalidAmount");
  return { actor, moves };
}

const describe = moves => moves.map(m => `${m.amount} ${m.currency.label}`).join(", ");

const OPERATIONS = {
  currencyAdjust: {
    fn(state, { id, delta, note }) {
      const c = state.currencies.find(c => c.id === id);
      if (!c) return false;
      const before = c.amount;
      c.amount = Math.max(0, before + toInt(delta));
      const diff = c.amount - before;
      if (!diff) return false;
      const key = diff > 0 ? "Deposit" : "Withdraw";
      return withNote(fmt(key, { amount: Math.abs(diff), currency: c.label }), clean(note, 120));
    }
  },

  currencySet: {
    fn(state, { id, value }) {
      const c = state.currencies.find(c => c.id === id);
      if (!c) return false;
      const before = c.amount;
      c.amount = Math.max(0, toInt(value));
      if (c.amount === before) return false;
      return fmt("SetCurrency", { currency: c.label, amount: c.amount, before });
    }
  },

  currencyAdd: {
    manage: true,
    fn(state, { label, abbr }) {
      label = clean(label, 32);
      if (!label) return false;
      abbr = clean(abbr, 6) || label.slice(0, 2).toLowerCase();
      state.currencies.push({ id: foundry.utils.randomID(), label, abbr, amount: 0 });
      return fmt("AddCurrency", { currency: label });
    }
  },

  currencyRemove: {
    manage: true,
    fn(state, { id }) {
      const index = state.currencies.findIndex(c => c.id === id);
      if (index < 0) return false;
      const [c] = state.currencies.splice(index, 1);
      return fmt("RemoveCurrency", { currency: c.label, amount: c.amount });
    }
  },

  resourceAdd: {
    fn(state, { name, quantity, notes }) {
      name = clean(name);
      if (!name) return false;
      quantity = Math.max(0, toInt(quantity ?? 1));
      state.resources.push({ id: foundry.utils.randomID(), name, quantity, notes: clean(notes, 500) });
      return fmt("AddResource", { name, quantity });
    }
  },

  resourceUpdate: {
    fn(state, { id, name, notes }) {
      const r = state.resources.find(r => r.id === id);
      if (!r) return false;
      if (name !== undefined) {
        name = clean(name);
        if (!name || name === r.name) return false;
        const before = r.name;
        r.name = name;
        return fmt("RenameResource", { before, name });
      }
      if (notes !== undefined) {
        notes = clean(notes, 500);
        if (notes === r.notes) return false;
        r.notes = notes;
        return fmt("ResourceNotes", { name: r.name });
      }
      return false;
    }
  },

  resourceAdjust: {
    fn(state, { id, delta }) {
      const r = state.resources.find(r => r.id === id);
      if (!r) return false;
      const before = r.quantity;
      r.quantity = Math.max(0, before + toInt(delta));
      if (r.quantity === before) return false;
      return fmt("SetResource", { name: r.name, quantity: r.quantity, before });
    }
  },

  resourceSet: {
    fn(state, { id, value }) {
      const r = state.resources.find(r => r.id === id);
      if (!r) return false;
      const before = r.quantity;
      r.quantity = Math.max(0, toInt(value));
      if (r.quantity === before) return false;
      return fmt("SetResource", { name: r.name, quantity: r.quantity, before });
    }
  },

  /**
   * An Item dropped on the resources. Dropped on a row, it links that resource to the item;
   * otherwise it adds the item's quantity to the resource already linked to it, or creates one.
   */
  resourceDropItem: {
    async fn(state, { itemUuid, id }) {
      const item = typeof itemUuid === "string" ? await fromUuid(itemUuid) : null;
      if (!(item instanceof Item)) throw new Rejection("NoItem");

      if (id) {
        const r = state.resources.find(r => r.id === id);
        if (!r || r.itemUuid === item.uuid) return false;
        r.itemUuid = item.uuid;
        r.img = item.img;
        return fmt("LinkResource", { name: r.name, item: item.name });
      }

      const quantity = Math.max(1, toInt(item.system?.quantity ?? 1));
      const existing = state.resources.find(r => r.itemUuid === item.uuid);
      if (existing) {
        const before = existing.quantity;
        existing.quantity += quantity;
        existing.img = item.img;
        return fmt("SetResource", { name: existing.name, quantity: existing.quantity, before });
      }
      const name = clean(item.name) || item.uuid;
      state.resources.push({ id: foundry.utils.randomID(), name, quantity, notes: "", itemUuid: item.uuid, img: item.img });
      return fmt("AddResource", { name, quantity });
    }
  },

  resourceUnlink: {
    fn(state, { id }) {
      const r = state.resources.find(r => r.id === id);
      if (!r?.itemUuid) return false;
      delete r.itemUuid;
      delete r.img;
      return fmt("UnlinkResource", { name: r.name });
    }
  },

  resourceRemove: {
    manage: true,
    fn(state, { id }) {
      const index = state.resources.findIndex(r => r.id === id);
      if (index < 0) return false;
      const [r] = state.resources.splice(index, 1);
      return fmt("RemoveResource", { name: r.name });
    }
  },

  /** Move coin from a character's purse into the stash, as one step. */
  actorDeposit: {
    async fn(state, { actorUuid, amounts, note }, user) {
      const { actor, moves } = resolveTransfer(state, actorUuid, amounts, user);
      const purse = getPurse(actor);
      const update = {};
      for (const { currency, key, amount } of moves) {
        const available = toInt(purse[key]);
        if (amount > available) throw new Rejection("InsufficientPurse", {
          name: actor.name, amount: available, currency: currency.label
        });
        update[`system.currency.${key}`] = available - amount;
      }
      await actor.update(update);
      for (const { currency, amount } of moves) currency.amount += amount;
      return withNote(fmt("DepositFrom", { amounts: describe(moves), name: actor.name }), clean(note, 120));
    }
  },

  /** Move coin from the stash into a character's purse, as one step. */
  actorWithdraw: {
    async fn(state, { actorUuid, amounts, note }, user) {
      const { actor, moves } = resolveTransfer(state, actorUuid, amounts, user);
      const purse = getPurse(actor);
      const update = {};
      for (const { currency, key, amount } of moves) {
        if (amount > currency.amount) throw new Rejection("Insufficient", {
          amount: currency.amount, currency: currency.label
        });
        update[`system.currency.${key}`] = toInt(purse[key]) + amount;
      }
      await actor.update(update);
      for (const { currency, amount } of moves) currency.amount -= amount;
      return withNote(fmt("WithdrawTo", { amounts: describe(moves), name: actor.name }), clean(note, 120));
    }
  },

  /** Divide coin evenly among characters' purses; whatever doesn't divide evenly stays in the stash. */
  splitStash: {
    manage: true,
    async fn(state, { actorUuids, currencyIds }) {
      const actors = [...new Set(Array.isArray(actorUuids) ? actorUuids : [])]
        .map(uuid => (typeof uuid === "string" ? fromUuidSync(uuid) : null))
        .filter(a => a instanceof Actor && getPurse(a));
      if (!actors.length) throw new Rejection("NoSplitActors");
      const moves = [];
      for (const id of Array.isArray(currencyIds) ? currencyIds : []) {
        const currency = state.currencies.find(c => c.id === id);
        if (!currency || !actors.every(a => purseKey(a, currency))) continue;
        const amount = Math.floor(currency.amount / actors.length);
        if (amount > 0) moves.push({ currency, amount });
      }
      if (!moves.length) throw new Rejection("NothingToSplit");
      await Promise.all(actors.map(actor => {
        const purse = getPurse(actor);
        const update = {};
        for (const { currency, amount } of moves) {
          const key = purseKey(actor, currency);
          update[`system.currency.${key}`] = toInt(purse[key]) + amount;
        }
        return actor.update(update);
      }));
      for (const { currency, amount } of moves) currency.amount -= amount * actors.length;
      return fmt("Split", { amounts: describe(moves), names: actors.map(a => a.name).join(", ") });
    }
  },

  /** Add the coin written in a chat message, once per message. */
  chatDeposit: {
    async fn(state, { messageId }, user) {
      const message = game.messages.get(messageId);
      if (!message) return false;
      if (depositedFlag(message)) throw new Rejection("AlreadyAdded");
      const amounts = parseCoins(messageText(message), state.currencies);
      if (!amounts) throw new Rejection("InvalidAmount");
      const moves = Object.entries(amounts).map(([id, amount]) => ({ currency: state.currencies.find(c => c.id === id), amount }));
      await message.setFlag(MODULE_ID, "deposited", { user: user.name, time: Date.now() });
      for (const { currency, amount } of moves) currency.amount += amount;
      return fmt("DepositChat", { amounts: describe(moves) });
    }
  },

  logClear: {
    gmOnly: true,
    fn(state) {
      state.log = [];
      return null;
    }
  }
};
