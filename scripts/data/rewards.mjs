/**
 * Quest rewards: coin and items paid into the Party Stash when a quest is completed.
 *
 * Stored on the quest as
 *   rewards: { coins: { [stashCurrencyId]: amount }, items: { [key]: { id, uuid, name, img, quantity, sort } } }
 *   rewardsPaid: { user, time }  once paid, so a quest only pays out once.
 * Both are records rather than arrays so edits merge (see updateEntry).
 */

const toInt = value => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
};

/** The quest's coin rewards, as [{ id, amount }]. */
export function rewardCoins(quest) {
  return Object.entries(quest?.rewards?.coins ?? {})
    .map(([id, amount]) => ({ id, amount: toInt(amount) }))
    .filter(c => c.amount > 0);
}

/** The quest's item rewards in order. */
export function rewardItems(quest) {
  return Object.values(quest?.rewards?.items ?? {})
    .filter(i => i?.uuid)
    .map((i, index) => ({ ...i, quantity: Math.max(1, toInt(i.quantity) || 1), sort: Number.isFinite(i.sort) ? i.sort : index }))
    .sort((a, b) => a.sort - b.sort);
}

export function hasRewards(quest) {
  return (rewardCoins(quest).length > 0) || (rewardItems(quest).length > 0);
}

/**
 * The quest's rewards ready to display, matched to the stash's currencies. Coin in a
 * currency the stash no longer has is left out.
 * @param {object} quest
 * @param {object[]} currencies  The stash's currencies.
 */
export function rewardSummary(quest, currencies) {
  const coins = rewardCoins(quest).flatMap(({ id, amount }) => {
    const currency = currencies.find(c => c.id === id);
    return currency ? [{ id, amount, label: currency.label, abbr: currency.abbr }] : [];
  });
  const items = rewardItems(quest);
  const text = [
    ...coins.map(c => `${c.amount} ${c.abbr || c.label}`),
    ...items.map(i => `${i.quantity} × ${i.name}`)
  ].join(", ");
  return { coins, items, text, any: (coins.length + items.length) > 0 };
}
