import * as THREE from "three";

import { Block, RenderGeometry } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const stoneBrickMaterial = new THREE.MeshLambertMaterial({
  map: textures.stoneBrick,
});

export class StoneBrickBlock extends Block {
  id = BlockID.StoneBrick;
  material = stoneBrickMaterial;
  uiTexture = uiTextures.stoneBrick;
  geometry = RenderGeometry.Cube;
  transparent = false;
  canPassThrough = false;
}
