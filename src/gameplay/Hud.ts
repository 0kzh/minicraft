import { getBlockDef } from "../Block/blocks";

import { Inventory } from "./Inventory";

const byId = (id: string) => document.getElementById(id);

/** Hotbar icons and the selected-slot border */
export class Hud {
  renderHotbar(inventory: Inventory) {
    for (let i = 0; i < Inventory.SIZE; i++) {
      const slot = byId(`toolbar-slot-${i + 1}`);
      const id = inventory.slots[i];
      if (slot) {
        slot.style.backgroundImage =
          id === null ? "none" : `url('${getBlockDef(id).uiTexture}')`;
      }
    }
    byId("toolbar")?.style.setProperty("--selected", `${inventory.selected}`);
  }
}
