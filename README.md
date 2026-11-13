# FeyHub

A Foundry VTT **V13 and V14** module that gives the GM and players one shared hub for:

- **Quests**: status (Active, On Hold, Completed, Failed), quest giver, description and an objectives checklist.
- **Rumours**: what was heard, who or where it came from (free text and/or a linked NPC entry), where it was heard, and whether it's confirmed.
- **NPCs**: name, short description and disposition. You can optionally link an NPC to an Actor so players who have permission can open its sheet.
- **Notes**: short free-form notes.
- **Stash**: the Party Stash. It has shared coin and custom currencies, party resources, transfers to and from character purses, dividing coin between characters (Dungeons & Dragons 5e and Pathfinder 2e, detected automatically), "Add to Party Stash" buttons on chat messages that contain only coin, and an activity log.

## Opening the hub
Click the **book** icon (<i>fa-book-atlas</i>) in the **Token controls** on the left-hand toolbar. Click it again to close the hub.
Macros and other modules can also open it:

```js
game.modules.get("FeyHub").api.toggle();
```

## Opening the Party Stash
The stash is a tab in the hub, and it also keeps its own ways in:
- The **sack-of-coins** icon in the Token controls opens the stash in its own window.
- The **sack-of-coins** button beside the coins on a character sheet, and the same entry in the sheet's header menu, open a dialog for moving coin between that character and the stash.
- You can bind a key to *Toggle Party Stash* under *Configure Controls*.
- Macros can call `game.modules.get("FeyHub").api.stash.toggle()`.

Stash changes are passed to the GM's client and applied there, so **a GM must be logged in** for players to change the stash. Everyone can still view it without a GM. Three world settings control what players can do:
- *Players can manage the Party Stash*: add or remove currency types, delete resources, and divide the stash among characters.
- *Players can change stash coin directly*: use the ± buttons, type new totals, deposit or withdraw coin without a character, and pay quest rewards into the stash. With this off, players can still move coin between their own characters and the stash.
- *Players can add coin to the stash from chat*: see the *Add to Party Stash* button on chat messages that contain only coin.

All three are on by default. They're checked on the GM's client, so the buttons can't be brought back through the console. Chat messages already on screen when the chat setting is turned off keep their button until reloaded, but the GM refuses the request.

## Installing in Foundry

In Foundry's **Add-on Modules → Install Module**, paste this manifest URL:


   ```
   https://github.com/FeyMods/FeyHub/releases/latest/download/module.json
   ```

Log in as GM once after enabling the module. It creates two journal entries in a *FeyHub* folder:
- **FeyHub**: the shared data. Everyone can read it.
- **FeyHub (GM)**: holds entries the GM has hidden from players.

Don't delete these journals. They store all of the hub's data.

## Who can edit
Open the **lock** icon in the hub toolbar, or go to *Game Settings → Configure Settings → FeyHub → Choose Editors*, and tick the players who may edit.

- **Editors** can add entries, edit any entry, and delete the entries **they created**.
- **Everyone else** has read-only access.
- **The GM** can do everything, and can also hide or reveal any entry (eye icon, or the *Hidden from players* checkbox in the editor).

Editors are made Owner of the hub journal, so they can make changes even when no GM is logged in. Hidden entries can only be created and changed while the GM is online.

## Quest rewards
A quest can have rewards that are paid into the Party Stash when it is completed:
- In the quest editor, enter coin amounts for any of the stash's currencies, and drag Items from the sidebar or a compendium onto *Rewards*.
- When the quest is saved as **Completed**, you're asked whether to pay its rewards into the stash. Coin is added to the stash's currencies and items become party resources linked to the item, so they can be handed out later.
- Rewards are only paid once. If you skip the prompt, the quest's card has a **Pay into stash** button.
- The GM and hub editors can pay rewards. Like other stash changes, a GM must be logged in.

## Chat announcements
Turn on *Announce hub changes in chat* in the module settings to post a chat message when:
- a quest, rumour or NPC is added (or a hidden one is revealed)
- a quest's status changes
- a rumour is confirmed or proven false
- quest rewards are paid into the stash

Hidden entries are never announced, and rumour quotes leave out secret blocks that haven't been revealed.

## What's new
Each player's tabs show how many entries someone else added or changed since that player last looked, and those cards get a **New** or **Updated** badge. The Stash tab counts new activity log lines. After you log in, a notification says how many hub entries have changed. Looking at a tab marks it as seen. The badges stay on its cards until you switch tabs or close the hub.

## Formatting and links
Quest and NPC descriptions, rumours and notes use Foundry's rich text editor, so they can have headings, lists, bold text and so on.

- Drag an Item, Actor, Scene, Journal entry or other document into the text to add a link to it, or type a link such as `@UUID[Item.abc123]{Ring of Warding}`. Links open the document when clicked.
- Inline rolls like `[[/r 1d20]]` can be clicked to roll.
- **Secret** blocks from the editor's toolbar are only shown to the GM in the hub. Like hidden entries, their text is still sent to every client.

Entries written with an older version of FeyHub are converted to rich text the first time a GM logs in.

## Linking NPCs to Actors
- Drag an Actor from the sidebar onto the **NPCs** tab to create a new NPC entry from it.
- Drag an Actor onto an existing NPC card to link that card to the Actor.
- You can also pick a *Linked actor* in the NPC editor.

The **Open Sheet** button only appears for users who have at least Limited permission on the Actor.

## Known limitations
Foundry has no server-side code for modules, so some rules are only enforced in the interface:

- **Hidden entries:** they never appear in a player's hub, but Foundry sends world data to every client. A player who digs through the browser console could still find them.
- **Deleting:** the "only delete your own entries" rule is enforced by the hub's interface. An editor could get around it through the console.

## License
FeyHub is released under the [MIT License](LICENSE).
