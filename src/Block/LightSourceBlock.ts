import { Block } from "./Block";

export abstract class LightSourceBlock extends Block {
  abstract color: number;
  abstract intensity: number;
  abstract distance: number;
  abstract decay: number;
}
