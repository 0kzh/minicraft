import * as THREE from "three";

import { RenderGeometry } from "./Block";
import { LightSourceBlock } from "./LightSourceBlock";
import { textures, uiTextures } from "./textures";

import { BlockID } from ".";

const redstoneLampMaterial = new THREE.MeshBasicMaterial({
  map: textures.redstoneLamp,
});

export class RedstoneLampBlock extends LightSourceBlock {
  id = BlockID.RedstoneLamp;
  material = redstoneLampMaterial;
  uiTexture = uiTextures.redstoneLamp;
  geometry = RenderGeometry.Cube;
  transparent = true;
  canPassThrough = false;

  // Light properties
  color = 0xdfa658;
  intensity = 15;
  distance = 10;
  decay = 1;
}
