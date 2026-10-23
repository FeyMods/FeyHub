import { MODULE_ID, PREVIOUS_ID } from "../data/hub-store.mjs";
import { defaultCurrencies } from "./systems.mjs";

export { MODULE_ID };
export const SOCKET = `module.${MODULE_ID}`;
export const LOG_LIMIT = 100;

/** The standalone module the Party Stash came from; its world data is imported once. */
export const LEGACY_ID = "fey-party";

/** A new, empty stash holding the coins of the world's game system. */
export function defaultState() {
  return { currencies: defaultCurrencies(), resources: [], log: [] };
}

/**
 * Who added a coin chat message to the stash, if anyone. Messages added before the stash
 * moved into this module, or before this module was renamed, carry an older flag, which is
 * read directly because getFlag() rejects scopes of inactive modules.
 */
export function depositedFlag(message) {
  const flags = message?.flags ?? {};
  return flags[MODULE_ID]?.deposited ?? flags[PREVIOUS_ID]?.deposited ?? flags[LEGACY_ID]?.deposited ?? null;
}
