import * as THREE from "three";

import { Block } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const stoneMaterial = new THREE.MeshLambertMaterial({ map: textures.stone });

export class StoneBlock extends Block {
  id = BlockID.Stone;
  material = stoneMaterial;
  uiTexture = uiTextures.stone;
}
