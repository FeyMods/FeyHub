# Fey Manager – Party Hub

A Foundry VTT **V13** module that gives the GM and players one shared hub for:

- **Quests**: status (Active, On Hold, Completed, Failed), quest giver, description and an objectives checklist.
- **Rumours**: what was heard, who or where it came from (free text and/or a linked NPC entry), where it was heard, and whether it's confirmed.
- **NPCs**: name, short description and disposition. You can optionally link an NPC to an Actor so players who have permission can open its sheet.
- **Notes**: short free-form notes.

## Opening the hub
Click the **book** icon (<i>fa-book-atlas</i>) in the **Token controls** on the left-hand toolbar. Click it again to close the hub.
Macros and other modules can also open it:

```js
game.modules.get("fey-manager").api.toggle();
```

## Setup
1. Copy or symlink this folder into `{UserData}/Data/modules/fey-manager`.
2. Enable **Fey Manager – Party Hub** in your world.
3. Log in as GM once. The module creates two journal entries in a *Fey Manager* folder:
   - **Fey Manager Hub**: the shared data. Everyone can read it.
   - **Fey Manager Hub (GM)**: holds entries the GM has hidden from players.

   Don't delete these journals. They store all of the hub's data.

## Who can edit
Open the **lock** icon in the hub toolbar, or go to *Game Settings → Configure Settings → Fey Manager → Choose Editors*, and tick the players who may edit.

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
