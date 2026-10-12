import { MODULE_ID } from "../data/hub-store.mjs";

export { MODULE_ID };
export const SOCKET = `module.${MODULE_ID}`;
export const LOG_LIMIT = 100;

/** The standalone module the Party Stash came from; its world data is imported once. */
export const LEGACY_ID = "fey-party";

export const DEFAULT_STATE = {
  currencies: [
    { id: "pp", label: "Platinum", abbr: "pp", amount: 0 },
    { id: "gp", label: "Gold", abbr: "gp", amount: 0 },
    { id: "ep", label: "Electrum", abbr: "ep", amount: 0 },
    { id: "sp", label: "Silver", abbr: "sp", amount: 0 },
    { id: "cp", label: "Copper", abbr: "cp", amount: 0 }
  ],
  resources: [],
  log: []
};

/**
 * Who added a coin chat message to the stash, if anyone. Messages added before the stash
 * moved into this module carry the old module's flag, which is read directly because
 * getFlag() rejects scopes of inactive modules.
 */
export function depositedFlag(message) {
  return message?.flags?.[MODULE_ID]?.deposited ?? message?.flags?.[LEGACY_ID]?.deposited ?? null;
}
