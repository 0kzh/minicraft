import GUI from "lil-gui";

import { oreConfig } from "./Block";
import { Player } from "./Player";
import { World } from "./World";

export function createUI(world: World, player: Player) {
  const gui = new GUI();

  const playerFolder = gui.addFolder("Player");
  playerFolder.add(player, "maxSpeed", 1, 50, 1).name("Max Speed");
  playerFolder.add(player.cameraHelper, "visible").name("Camera Helper");

  const terrainFolder = gui.addFolder("Terrain");
  terrainFolder.add(world.size, "width", 8, 128, 1).name("Width");
  terrainFolder.add(world.size, "height", 8, 64, 1).name("Height");
  terrainFolder.add(world.params, "seed", 1, 10000, 1).name("Seed");
  terrainFolder.add(world.params.terrain, "scale", 10, 100, 1).name("Scale");
  terrainFolder.add(world.params.terrain, "magnitude", 0, 1).name("Magnitude");
  terrainFolder.add(world.params.terrain, "offset", 0, 1).name("Offset");

  const resourcesFolder = gui.addFolder("Resources");

  for (const resource of Object.keys(oreConfig)) {
    const resourceFolder = resourcesFolder.addFolder(resource);
    resourceFolder
      .add(oreConfig[resource as keyof typeof oreConfig], "scarcity", 0, 1)
      .name("Scarcity");

    const scaleFolder = resourceFolder.addFolder("Scale");
    scaleFolder
      .add(oreConfig[resource as keyof typeof oreConfig].scale, "x", 1, 100)
      .name("X Scale");
    scaleFolder
      .add(oreConfig[resource as keyof typeof oreConfig].scale, "y", 1, 100)
      .name("Y Scale");
    scaleFolder
      .add(oreConfig[resource as keyof typeof oreConfig].scale, "z", 1, 100)
      .name("Z Scale");
  }

  gui.add(world, "generate").name("Generate");
}
