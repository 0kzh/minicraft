import { BlockID } from "../Block";

/** Nine creative hotbar slots; placing never consumes anything */
export class Inventory {
  static SIZE = 9;

  slots: (BlockID | null)[] = new Array(Inventory.SIZE).fill(null);
  selected = 0;

  static creative(palette: BlockID[]): Inventory {
    const inv = new Inventory();
    palette.slice(0, Inventory.SIZE).forEach((id, i) => {
      inv.slots[i] = id;
    });
    return inv;
  }

  get selectedBlock(): BlockID | null {
    return this.slots[this.selected];
  }

  select(index: number) {
    this.selected =
      ((index % Inventory.SIZE) + Inventory.SIZE) % Inventory.SIZE;
  }
}
