import { BlockID } from ".";

export enum RenderGeometry {
  Cube,
  Cross,
}

export abstract class Block {
  abstract id: BlockID;
  abstract material: THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[];
  abstract uiTexture: string;
  abstract geometry: RenderGeometry;
  abstract transparent: boolean;
  abstract canPassThrough: boolean;
}
