/**
 * Game system support for character purses. Each system keeps coin differently:
 * - dnd5e: plain numbers at actor.system.currency.{pp,gp,ep,sp,cp}.
 * - pf2e: coin items in the actor's inventory, read and changed through actor.inventory.
 * Any other system with a dnd5e-style system.currency record is treated like dnd5e.
 */

const DND5E_CURRENCIES = [
  { id: "pp", label: "Platinum", abbr: "pp" },
  { id: "gp", label: "Gold", abbr: "gp" },
  { id: "ep", label: "Electrum", abbr: "ep" },
  { id: "sp", label: "Silver", abbr: "sp" },
  { id: "cp", label: "Copper", abbr: "cp" }
];

const SYSTEMS = {
  dnd5e: {
    currencies: DND5E_CURRENCIES,

    getPurse(actor) {
      const purse = actor?.system?.currency;
      return purse && typeof purse === "object" ? purse : null;
    },

    async adjustPurse(actor, deltas) {
      const purse = this.getPurse(actor);
      const update = {};
      for (const [key, delta] of Object.entries(deltas)) {
        update[`system.currency.${key}`] = (Math.trunc(Number(purse[key])) || 0) + delta;
      }
      await actor.update(update);
    }
  },

  pf2e: {
    currencies: DND5E_CURRENCIES.filter(c => c.id !== "ep"),

    getPurse(actor) {
      const coins = actor?.inventory?.coins;
      if (!coins) return null;
      return { pp: coins.pp ?? 0, gp: coins.gp ?? 0, sp: coins.sp ?? 0, cp: coins.cp ?? 0 };
    },

    async adjustPurse(actor, deltas) {
      const add = {};
      const remove = {};
      for (const [key, delta] of Object.entries(deltas)) {
        if (delta > 0) add[key] = delta;
        else if (delta < 0) remove[key] = -delta;
      }
      // Take the exact denominations asked for, rather than making change from larger coins.
      if (Object.keys(remove).length && !(await actor.inventory.removeCoins(remove, { byValue: false }))) {
        throw new Error(`Could not remove coins from ${actor.name}`);
      }
      if (Object.keys(add).length) await actor.inventory.addCoins(add);
    }
  }
};

/** The id of the supported system this world runs, falling back to dnd5e's purse layout. */
export function systemId() {
  return game.system.id in SYSTEMS ? game.system.id : "dnd5e";
}

const system = () => SYSTEMS[systemId()];

/** The coins a new stash starts with in this system. */
export function defaultCurrencies() {
  return system().currencies.map(c => ({ ...c, amount: 0 }));
}

/** The actor's coin as a record of purse key → amount, or null if it has no purse. */
export function getPurse(actor) {
  return system().getPurse(actor);
}

/**
 * Change the coin in an actor's purse.
 * @param {Actor} actor
 * @param {Record<string, number>} deltas  Purse key → amount to add (negative to remove).
 */
export function adjustPurse(actor, deltas) {
  return system().adjustPurse(actor, deltas);
}

/** The actors to tick by default when dividing the stash: the pf2e party's members, if there is one. */
export function partyMembers() {
  const party = systemId() === "pf2e" ? game.actors.party : null;
  return party?.members?.length ? new Set(party.members) : null;
}
