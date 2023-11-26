import * as THREE from "three";

import { Block } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const dirtMaterial = new THREE.MeshLambertMaterial({ map: textures.dirt });

export class DirtBlock extends Block {
  id = BlockID.Dirt;
  material = dirtMaterial;
  uiTexture = uiTextures.dirt;
}
