import { AirBlock } from "./AirBlock";
import { BedrockBlock } from "./BedrockBlock";
import { Block } from "./Block";
import { CoalOreBlock } from "./CoalOreBlock";
import { DirtBlock } from "./DirtBlock";
import { GrassBlock } from "./GrassBlock";
import { IronOreBlock } from "./IronOreBlock";
import { LeavesBlock } from "./LeavesBlock";
import { OakLogBlock } from "./OakLogBlock";
import { StoneBlock } from "./StoneBlock";

import { BlockID } from ".";

// Flyweight pattern to avoid creating new block instances
export class BlockFactory {
  private static blockTypes: { [id: number]: any } = {
    [BlockID.Air]: AirBlock,
    [BlockID.Grass]: GrassBlock,
    [BlockID.Stone]: StoneBlock,
    [BlockID.Dirt]: DirtBlock,
    [BlockID.Bedrock]: BedrockBlock,
    [BlockID.CoalOre]: CoalOreBlock,
    [BlockID.IronOre]: IronOreBlock,
    [BlockID.OakLog]: OakLogBlock,
    [BlockID.Leaves]: LeavesBlock,
  };

  private static blockInstances: { [id: number]: Block } = {};

  static getBlock(id: BlockID): Block {
    if (!this.blockInstances[id]) {
      const BlockType = this.blockTypes[id];
      if (BlockType) {
        this.blockInstances[id] = new BlockType();
      } else {
        throw new Error(`No block type registered for ID ${id}`);
      }
    }
    return this.blockInstances[id];
  }
}
