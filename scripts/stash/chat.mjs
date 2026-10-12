import { depositedFlag } from "./constants.mjs";
import { getState, dispatch } from "./store.mjs";
import { messageText, parseCoins } from "./coins.mjs";

/**
 * A chat message made only of coin ("10g, 6s, 105c") gets an "Add to Party Stash" button.
 * The GM re-reads the message when applying it and flags it, so each message is added once.
 */
export function registerChatIntegration() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.isRoll) return;
    const content = html.querySelector(".message-content");
    if (!content || !parseCoins(messageText(message), getState().currencies)) return;

    const footer = document.createElement("div");
    footer.className = "fey-party-chat";
    const added = depositedFlag(message);
    if (added) {
      footer.innerHTML = `<i class="fa-solid fa-check" inert></i> ${foundry.utils.escapeHTML(
        game.i18n.format("FEYPARTY.Chat.Added", { name: added.user })
      )}`;
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<i class="fa-solid fa-sack-dollar" inert></i> ${game.i18n.localize("FEYPARTY.Chat.Add")}`;
      button.addEventListener("click", event => {
        event.preventDefault();
        if (dispatch("chatDeposit", { messageId: message.id })) button.disabled = true;
      });
      footer.append(button);
    }
    content.append(footer);
  });
}
