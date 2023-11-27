import * as THREE from "three";

import { Block, RenderGeometry } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const tallGrassMaterial = new THREE.MeshLambertMaterial({
  map: textures.tallGrass,
});

tallGrassMaterial.transparent = true;
tallGrassMaterial.side = THREE.DoubleSide;
tallGrassMaterial.depthWrite = false;

export class TallGrassBlock extends Block {
  id = BlockID.TallGrass;
  material = tallGrassMaterial;
  uiTexture = uiTextures.tallGrass;
  geometry = RenderGeometry.Cross;
  transparent = true;
  canPassThrough = true;
}
