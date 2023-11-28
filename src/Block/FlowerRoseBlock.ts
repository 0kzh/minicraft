import * as THREE from "three";

import { Block, RenderGeometry } from "./Block";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const flowerRoseMaterial = new THREE.MeshBasicMaterial({
  map: textures.flowerRose,
});

flowerRoseMaterial.transparent = true;
flowerRoseMaterial.side = THREE.DoubleSide;
flowerRoseMaterial.depthWrite = false;

export class FlowerRoseBlock extends Block {
  id = BlockID.FlowerRose;
  material = flowerRoseMaterial;
  uiTexture = uiTextures.tallGrass;
  geometry = RenderGeometry.Cross;
  transparent = true;
  canPassThrough = true;
}
