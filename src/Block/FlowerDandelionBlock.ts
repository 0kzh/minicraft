import * as THREE from "three";

import { Block, RenderGeometry } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const flowerDandelionMaterial = new THREE.MeshBasicMaterial({
  map: textures.flowerDandelion,
});

flowerDandelionMaterial.transparent = true;
flowerDandelionMaterial.side = THREE.DoubleSide;
flowerDandelionMaterial.depthWrite = false;

export class FlowerDandelionBlock extends Block {
  id = BlockID.FlowerDandelion;
  material = flowerDandelionMaterial;
  uiTexture = uiTextures.flowerDandelion;
  geometry = RenderGeometry.Cross;
  transparent = true;
  canPassThrough = true;
}
