import * as THREE from "three";

import { Block, RenderGeometry } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const bedrockMaterial = new THREE.MeshLambertMaterial({
  map: textures.bedrock,
});
export class BedrockBlock extends Block {
  id = BlockID.Bedrock;
  material = bedrockMaterial;
  uiTexture = uiTextures.bedrock;
  geometry = RenderGeometry.Cube;
  transparent = false;
  canPassThrough = false;
}
