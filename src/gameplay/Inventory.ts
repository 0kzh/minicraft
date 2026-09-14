import { BlockID } from "../Block";

export type ItemStack = { id: BlockID; count: number };

/**
 * Nine hotbar slots. Survival stacks are finite (up to 64); the creative
 * palette marks itself `infinite` so placing never consumes anything.
 */
export class Inventory {
  static SIZE = 9;
  static STACK = 64;

  slots: (ItemStack | null)[] = new Array(Inventory.SIZE).fill(null);
  selected = 0;
  infinite = false;

  static creative(palette: BlockID[]): Inventory {
    const inv = new Inventory();
    inv.infinite = true;
    palette.slice(0, Inventory.SIZE).forEach((id, i) => {
      inv.slots[i] = { id, count: 1 };
    });
    return inv;
  }

  get selectedStack(): ItemStack | null {
    return this.slots[this.selected];
  }

  get selectedBlock(): BlockID | null {
    return this.selectedStack?.id ?? null;
  }

  /** Adds `count` of a block, filling existing stacks first; returns the leftover */
  add(id: BlockID, count = 1): number {
    for (const stack of this.slots) {
      if (count === 0) break;
      if (stack && stack.id === id && stack.count < Inventory.STACK) {
        const n = Math.min(count, Inventory.STACK - stack.count);
        stack.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (this.slots[i] === null) {
        const n = Math.min(count, Inventory.STACK);
        this.slots[i] = { id, count: n };
        count -= n;
      }
    }
    return count;
  }

  /** Takes one item from the selected slot; no-op for infinite inventories */
  consumeSelected() {
    if (this.infinite) return;
    const stack = this.selectedStack;
    if (!stack) return;
    stack.count--;
    if (stack.count <= 0) this.slots[this.selected] = null;
  }

  clear() {
    this.slots.fill(null);
  }

  select(index: number) {
    this.selected =
      ((index % Inventory.SIZE) + Inventory.SIZE) % Inventory.SIZE;
  }

  toJSON(): (ItemStack | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  load(slots: (ItemStack | null)[]) {
    this.clear();
    slots.slice(0, Inventory.SIZE).forEach((s, i) => {
      if (s && s.count > 0) this.slots[i] = { id: s.id, count: s.count };
    });
  }
}
