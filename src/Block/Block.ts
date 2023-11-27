import { BlockID } from ".";

export enum RenderGeometry {
  Cube,
  Cross,
}

type MaterialType = THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;

export abstract class Block {
  abstract id: BlockID;
  abstract material: MaterialType | MaterialType[];
  abstract uiTexture: string;
  abstract geometry: RenderGeometry;
  abstract transparent: boolean;
  abstract canPassThrough: boolean;
}
