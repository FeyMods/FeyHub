# FeyHub

A Foundry VTT **V13 and V14** module that gives the GM and players one shared hub for:

- **Quests**: status (Active, On Hold, Completed, Failed), quest giver, description and an objectives checklist.
- **Rumours**: what was heard, who or where it came from (free text and/or a linked NPC entry), where it was heard, and whether it's confirmed.
- **NPCs**: name, short description and disposition. You can optionally link an NPC to an Actor so players who have permission can open its sheet.
- **Notes**: short free-form notes.
- **Stash**: the Party Stash (formerly the separate *Fey Party* module). It has shared coin and custom currencies, party resources, transfers to and from character purses (dnd5e), dividing coin between characters, "Add to Party Stash" buttons on chat messages that contain only coin, and an activity log.

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

Stash changes are passed to the GM's client and applied there, so **a GM must be logged in** for players to change the stash. Everyone can still view it without a GM. The world setting *Players can manage the Party Stash* controls whether players can add or remove currency types and delete resources.

### Coming from Fey Party
The first time a GM logs in with this version, any existing Fey Party stash (coin, resources, activity log and the *players can manage* setting) is copied into FeyHub. Chat messages that were already added to the stash stay marked as added. After that, **disable the separate Fey Party module**, otherwise you'll get duplicate buttons. The GM is shown a reminder while both modules are enabled.

## Setup
1. In Foundry, go to *Add-on Modules → Install Module* and paste this manifest URL:
   `https://github.com/FeyMods/FeyHub/releases/latest/download/module.json`
   (For development, copy or symlink this folder into `{UserData}/Data/modules/FeyHub` instead.)
2. Enable **FeyHub** in your world.
3. Log in as GM once. The module creates two journal entries in a *FeyHub* folder (worlds set up before the rename keep their *Fey Manager* names):
   - **FeyHub**: the shared data. Everyone can read it.
   - **FeyHub (GM)**: holds entries the GM has hidden from players.

   Don't delete these journals. They store all of the hub's data.

## Who can edit
Open the **lock** icon in the hub toolbar, or go to *Game Settings → Configure Settings → FeyHub → Choose Editors*, and tick the players who may edit.

- **Editors** can add entries, edit any entry, and delete the entries **they created**.
- **Everyone else** has read-only access.
- **The GM** can do everything, and can also hide or reveal any entry (eye icon, or the *Hidden from players* checkbox in the editor).

Editors are made Owner of the hub journal, so they can make changes even when no GM is logged in. Hidden entries can only be created and changed while the GM is online.

## Linking NPCs to Actors
- Drag an Actor from the sidebar onto the **NPCs** tab to create a new NPC entry from it.
- Drag an Actor onto an existing NPC card to link that card to the Actor.
- You can also pick a *Linked actor* in the NPC editor.

The **Open Sheet** button only appears for users who have at least Limited permission on the Actor.

## Known limitations
Foundry has no server-side code for modules, so some rules are only enforced in the interface:

- **Hidden entries:** they never appear in a player's hub, but Foundry sends world data to every client. A player who digs through the browser console could still find them.
- **Deleting:** the "only delete your own entries" rule is enforced by the hub's interface. An editor could get around it through the console.
