import * as THREE from "three";

import { Block } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const leavesMaterial = new THREE.MeshLambertMaterial({ map: textures.leaves });
leavesMaterial.transparent = true;

export class LeavesBlock extends Block {
  id = BlockID.Leaves;
  material = leavesMaterial;
  uiTexture = uiTextures.leaves;
}
