import GUI from 'lil-gui';
import { World } from './World';

export function createUI(world: World) {
    const gui = new GUI();

    gui.add(world.size, 'width', 8, 128, 1).name("Width")
    gui.add(world.size, 'height', 8, 64, 1).name("Height")
    gui.add(world, 'generate');
}