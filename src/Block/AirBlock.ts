import { Block, RenderGeometry } from "./Block";

import { BlockID } from ".";

export class AirBlock extends Block {
  id = BlockID.Air;
  material = [];
  uiTexture = "";
  geometry = RenderGeometry.Cube;
  transparent = true;
  canPassThrough = true;
}
