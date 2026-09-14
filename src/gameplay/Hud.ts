import { getBlockDef } from "../Block/blocks";

import { Inventory } from "./Inventory";
import { MAX_AIR, MAX_HEALTH, Vitals } from "./Vitals";

const byId = (id: string) => document.getElementById(id);

/**
 * Hotbar icons/counts and the survival status bars, laid out like vanilla
 * `Gui.renderPlayerHealth`: hearts on the left, food on the right and air
 * above the food while under water, all 9px icons on an 8px pitch.
 */
export class Hud {
  private readonly hearts: HTMLElement[] = [];
  private readonly food: HTMLElement[] = [];
  private readonly bubbles: HTMLElement[] = [];
  private readonly counts: HTMLElement[] = [];
  /** Health shown before the last change, for the blink overlay */
  private lastHealth = MAX_HEALTH;
  private lastRenderedHealth = MAX_HEALTH;
  private tickCount = 0;
  private tickAccumulator = 0;
  private rng = 0;

  constructor() {
    const icons = (parent: string, cls: string, into: HTMLElement[]) => {
      for (let i = 0; i < 10; i++) {
        const el = document.createElement("div");
        el.className = `icon ${cls}`;
        byId(parent)?.appendChild(el);
        into.push(el);
      }
    };
    icons("health", "heart", this.hearts);
    icons("food", "hunger", this.food);
    icons("air", "bubble", this.bubbles);
    for (let i = 1; i <= Inventory.SIZE; i++) {
      const count = document.createElement("span");
      count.className = "count";
      byId(`toolbar-slot-${i}`)?.appendChild(count);
      this.counts.push(count);
    }
  }

  /** Survival shows the status bars; creative hides them */
  setSurvival(survival: boolean) {
    const hud = byId("hud");
    if (hud) hud.style.display = survival ? "block" : "none";
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

  /** Redraws everything that depends on vitals; called on change and each tick */
  renderVitals(vitals: Vitals) {
    if (vitals.health !== this.lastRenderedHealth) {
      this.lastHealth = this.lastRenderedHealth;
      this.lastRenderedHealth = vitals.health;
    }
    // Gui: hearts blink every 3 ticks during the second half of invulnerableTime
    const blink =
      vitals.invulnerableTime >= 10 &&
      Math.floor(vitals.invulnerableTime / 3) % 2 === 1;
    this.seed(this.tickCount * 312871);
    this.hearts.forEach((heart, i) => {
      const hp = vitals.health - i * 2;
      const last = this.lastHealth - i * 2;
      const classes = ["icon", "heart"];
      if (blink) {
        classes.push("blink");
        if (last >= 2) classes.push("flash-full");
        else if (last === 1) classes.push("flash-half");
      }
      if (hp >= 2) classes.push("full");
      else if (hp === 1) classes.push("half");
      heart.className = classes.join(" ");
      // Low health makes the hearts jitter
      heart.style.setProperty(
        "--jitter",
        String(vitals.health <= 4 ? this.nextInt(2) : 0)
      );
    });

    // Empty saturation makes the food bar shake every few ticks
    const shake =
      vitals.saturation <= 0 && this.tickCount % (vitals.food * 3 + 1) === 0;
    this.food.forEach((icon, i) => {
      const points = vitals.food - i * 2;
      icon.className =
        points >= 2
          ? "icon hunger full"
          : points === 1
          ? "icon hunger half"
          : "icon hunger";
      icon.style.setProperty(
        "--jitter",
        String(shake ? this.nextInt(3) - 1 : 0)
      );
    });

    // Gui: air is only drawn while the eyes are under water
    const air = byId("air");
    if (air) air.style.display = vitals.underwater ? "" : "none";
    const count = Math.ceil(((vitals.air - 2) * 10) / MAX_AIR);
    const extra = Math.ceil((vitals.air * 10) / MAX_AIR) - count;
    this.bubbles.forEach((bubble, i) => {
      bubble.style.visibility = i < count + extra ? "visible" : "hidden";
      bubble.className = i < count ? "icon bubble" : "icon bubble pop";
    });
  }

  update(dt: number, vitals: Vitals) {
    this.tickAccumulator += dt;
    let ticked = false;
    while (this.tickAccumulator >= 0.05) {
      this.tickAccumulator -= 0.05;
      this.tickCount++;
      ticked = true;
    }
    if (ticked) this.renderVitals(vitals);
  }

  private seed(seed: number) {
    this.rng = seed >>> 0 || 1;
  }

  /** Small xorshift stand-in for `Random.nextInt(bound)` */
  private nextInt(bound: number) {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng % bound;
  }
}
