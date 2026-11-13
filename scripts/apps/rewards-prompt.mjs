import { dispatch, getState } from "../stash/store.mjs";
import { rewardSummary } from "../data/rewards.mjs";

/**
 * Ask whether to pay a completed quest's rewards into the Party Stash, and do so if confirmed.
 * The active GM applies the payout, so a GM must be logged in.
 * @param {object} quest  The quest entry.
 */
export async function offerRewards(quest) {
  const { text } = rewardSummary(quest, getState().currencies);
  const esc = foundry.utils.escapeHTML;
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "FEYHUB.Reward.ConfirmTitle", icon: "fa-solid fa-sack-dollar" },
    content: `<p>${game.i18n.format("FEYHUB.Reward.Confirm", {
      title: `<strong>${esc(quest.title ?? "")}</strong>`,
      rewards: esc(text)
    })}</p>`
  });
  if (confirmed) dispatch("questReward", { questId: quest.id });
}
