import { getBlockDef } from "../Block/blocks";

import { Inventory } from "./Inventory";
import { MAX_AIR, MAX_HEALTH, Vitals } from "./Vitals";

const byId = (id: string) => document.getElementById(id);

/** Hotbar icons/counts, hearts, air bubbles and the damage flash */
export class Hud {
  private readonly hearts: HTMLElement[] = [];
  private readonly bubbles: HTMLElement[] = [];
  private readonly counts: HTMLElement[] = [];

  constructor() {
    const health = byId("health");
    const air = byId("air");
    for (let i = 0; i < MAX_HEALTH / 2; i++) {
      const heart = document.createElement("div");
      heart.className = "icon heart";
      health?.appendChild(heart);
      this.hearts.push(heart);
    }
    for (let i = 0; i < 10; i++) {
      const bubble = document.createElement("div");
      bubble.className = "icon bubble";
      air?.appendChild(bubble);
      this.bubbles.push(bubble);
    }
    for (let i = 1; i <= Inventory.SIZE; i++) {
      const count = document.createElement("span");
      count.className = "count";
      byId(`toolbar-slot-${i}`)?.appendChild(count);
      this.counts.push(count);
    }
  }

  /** Survival shows hearts and bubbles; creative hides them */
  setSurvival(survival: boolean) {
    const hud = byId("hud");
    if (hud) hud.style.display = survival ? "flex" : "none";
  }

  renderHotbar(inventory: Inventory) {
    for (let i = 0; i < Inventory.SIZE; i++) {
      const slot = byId(`toolbar-slot-${i + 1}`);
      const stack = inventory.slots[i];
      if (slot) {
        slot.style.backgroundImage = stack
          ? `url('${getBlockDef(stack.id).uiTexture}')`
          : "none";
      }
      this.counts[i].textContent =
        stack && !inventory.infinite && stack.count > 1
          ? String(stack.count)
          : "";
    }
    byId("toolbar-active-border")?.setAttribute(
      "style",
      `left: ${inventory.selected * 11}%`
    );
  }

  renderVitals(vitals: Vitals) {
    this.hearts.forEach((heart, i) => {
      const hp = vitals.health - i * 2;
      heart.className =
        hp >= 2
          ? "icon heart full"
          : hp === 1
          ? "icon heart half"
          : "icon heart";
    });
    const air = byId("air");
    if (air) air.style.visibility = vitals.air < MAX_AIR ? "visible" : "hidden";
    const perBubble = MAX_AIR / this.bubbles.length;
    this.bubbles.forEach((bubble, i) => {
      const remaining = vitals.air - i * perBubble;
      bubble.style.visibility = remaining > -perBubble ? "visible" : "hidden";
      bubble.className =
        remaining <= 0 && remaining > -perBubble
          ? "icon bubble pop"
          : "icon bubble";
    });
  }

  update(vitals: Vitals) {
    const overlay = byId("hurt-overlay");
    if (overlay) overlay.style.opacity = String(vitals.hurtFlash * 1.6);
  }
}
