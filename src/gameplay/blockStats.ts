import { BlockID } from "../Block";

/** Survival mining data for a block */
export type BlockStats = {
  /** Seconds to break by hand; Infinity for unbreakable */
  breakTime: number;
  /** Block added to the inventory when broken, or null for nothing */
  drop: BlockID | null;
};

/**
 * Vanilla hardness -> seconds: `hardness * 1.5` by hand. There is no tool
 * system yet, so mineral blocks use the stone-pickaxe time (`* 1.5 / 4`)
 * instead of the punishing no-tool time, and drop themselves.
 */
const hand = (hardness: number) => hardness * 1.5;
const pick = (hardness: number) => (hardness * 1.5) / 4;

const STATS: Partial<Record<BlockID, BlockStats>> = {
  [BlockID.Grass]: { breakTime: hand(0.6), drop: BlockID.Dirt },
  [BlockID.Dirt]: { breakTime: hand(0.5), drop: BlockID.Dirt },
  [BlockID.SnowGrass]: { breakTime: hand(0.6), drop: BlockID.Dirt },
  [BlockID.Sand]: { breakTime: hand(0.5), drop: BlockID.Sand },
  [BlockID.Gravel]: { breakTime: hand(0.6), drop: BlockID.Gravel },
  [BlockID.Stone]: { breakTime: pick(1.5), drop: BlockID.Stone },
  [BlockID.StoneBrick]: { breakTime: pick(1.5), drop: BlockID.StoneBrick },
  [BlockID.Sandstone]: { breakTime: pick(0.8), drop: BlockID.Sandstone },
  [BlockID.CoalOre]: { breakTime: pick(3), drop: BlockID.CoalOre },
  [BlockID.IronOre]: { breakTime: pick(3), drop: BlockID.IronOre },
  [BlockID.GoldOre]: { breakTime: pick(3), drop: BlockID.GoldOre },
  [BlockID.DiamondOre]: { breakTime: pick(3), drop: BlockID.DiamondOre },
  [BlockID.Bedrock]: { breakTime: Infinity, drop: null },
  [BlockID.OakLog]: { breakTime: hand(2), drop: BlockID.OakLog },
  [BlockID.BirchLog]: { breakTime: hand(2), drop: BlockID.BirchLog },
  [BlockID.SpruceLog]: { breakTime: hand(2), drop: BlockID.SpruceLog },
  [BlockID.Leaves]: { breakTime: hand(0.2), drop: null },
  [BlockID.BirchLeaves]: { breakTime: hand(0.2), drop: null },
  [BlockID.SpruceLeaves]: { breakTime: hand(0.2), drop: null },
  [BlockID.TallGrass]: { breakTime: 0, drop: null },
  [BlockID.DeadBush]: { breakTime: 0, drop: null },
  [BlockID.FlowerRose]: { breakTime: 0, drop: BlockID.FlowerRose },
  [BlockID.FlowerDandelion]: { breakTime: 0, drop: BlockID.FlowerDandelion },
  [BlockID.RedstoneLamp]: { breakTime: hand(0.3), drop: BlockID.RedstoneLamp },
  [BlockID.Snow]: { breakTime: hand(0.2), drop: null },
  [BlockID.SnowLayer]: { breakTime: hand(0.1), drop: null },
  [BlockID.Cactus]: { breakTime: hand(0.4), drop: BlockID.Cactus },
};

const DEFAULT: BlockStats = { breakTime: 1, drop: null };

export const blockStats = (id: BlockID): BlockStats => STATS[id] ?? DEFAULT;

/** Blocks offered on the creative hotbar */
export const CREATIVE_PALETTE: BlockID[] = [
  BlockID.Grass,
  BlockID.Dirt,
  BlockID.Stone,
  BlockID.StoneBrick,
  BlockID.RedstoneLamp,
  BlockID.OakLog,
  BlockID.Leaves,
  BlockID.Sand,
  BlockID.Water,
];
