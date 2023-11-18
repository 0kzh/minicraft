import { Block } from "./Block";

export abstract class OreBlock extends Block {
  abstract scale: { x: number; y: number; z: number };
  abstract scarcity: number;
}
