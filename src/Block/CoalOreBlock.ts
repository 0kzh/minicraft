import * as THREE from "three";

import { RenderGeometry } from "./Block";
import { OreBlock } from "./OreBlock";
import { textures, uiTextures } from "./textures";

import { BlockID, oreConfig } from ".";

const coalOreMaterial = new THREE.MeshLambertMaterial({ map: textures.coal });

export const CoalOreBlock = class extends OreBlock {
  id = BlockID.CoalOre;
  scale = oreConfig["coal"].scale;
  scarcity = oreConfig["coal"].scarcity;
  material = coalOreMaterial;
  uiTexture = uiTextures.coal;
  geometry = RenderGeometry.Cube;
  transparent = false;
  canPassThrough = false;
};
