import * as THREE from "three";

import { Block, RenderGeometry } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const dirtMaterial = new THREE.MeshLambertMaterial({ map: textures.dirt });

export class DirtBlock extends Block {
  id = BlockID.Dirt;
  material = dirtMaterial;
  uiTexture = uiTextures.dirt;
  geometry = RenderGeometry.Cube;
  transparent = false;
  canPassThrough = false;
}
