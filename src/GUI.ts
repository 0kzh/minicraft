import GUI from "lil-gui";

import { oreConfig } from "./Block";
import { Physics } from "./Physics";
import { Player } from "./Player";
import { World } from "./World";

export function createUI(
  world: World,
  player: Player,
  physics: Physics,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  sunSettings: { distance: number; cycleLength: number },
  sunHelper: THREE.DirectionalLightHelper,
  shadowHelper: THREE.CameraHelper
) {
  const gui = new GUI();
  const custom = { volume: 0.3 };

  const soundFolder = gui.addFolder("Sound");
  soundFolder
    .add(custom, "volume", 0, 1, 0.01)
    .name("Volume")
    .onChange((value: number) => {
      Howler.volume(value);
    });

  const playerFolder = gui.addFolder("Player");
  playerFolder.add(player, "maxSpeed", 1, 50, 1).name("Max Speed");
  playerFolder.add(player, "jumpSpeed", 1, 10, 1).name("Jump Speed");
  playerFolder.add(player.cameraHelper, "visible").name("Camera Helper");
  playerFolder.add(player.boundsHelper, "visible").name("Show Player Bounds");

  const physicsFolder = gui.addFolder("Physics");
  physicsFolder.add(physics.helpers, "visible").name("Visualize Collisions");
  physicsFolder
    .add(physics, "simulationRate", 10, 1000)
    .name("Simulation Rate");

  const worldFolder = gui.addFolder("World");
  worldFolder.add(renderer.shadowMap, "enabled").name("Enable Shadows");
  worldFolder.add(sunHelper, "visible").name("Show Sun Helper");
  worldFolder.add(shadowHelper, "visible").name("Show Shadow Helper");
  worldFolder
    .add(sunSettings, "cycleLength", 0, 1000, 1)
    .name("Day Length (s)");
  worldFolder.add(world, "renderDistance", 1, 16, 1).name("Render Distance");
  if (scene.fog) {
    worldFolder.add(scene.fog, "near", 1, 200, 1).name("Fog Near");
    worldFolder.add(scene.fog, "far", 1, 200, 1).name("Fog Far");
  }

  const terrainFolder = gui.addFolder("Terrain");
  terrainFolder.add(world.chunkSize, "width", 8, 128, 1).name("Width");
  terrainFolder.add(world.chunkSize, "height", 8, 64, 1).name("Height");
  terrainFolder.add(world.params, "seed", 1, 10000, 1).name("Seed");
  terrainFolder.add(world.params.terrain, "scale", 10, 100, 1).name("Scale");
  terrainFolder.add(world.params.terrain, "magnitude", 0, 1).name("Magnitude");
  terrainFolder.add(world.params.terrain, "offset", 0, 1).name("Offset");

  const treesFolder = terrainFolder.addFolder("Trees");
  treesFolder.add(world.params.trees, "frequency", 0, 1, 0.1).name("Frequency");
  treesFolder
    .add(world.params.trees.trunkHeight, "min", 0, 10, 1)
    .name("Min Trunk Height");
  treesFolder
    .add(world.params.trees.trunkHeight, "max", 0, 10, 1)
    .name("Max Trunk Height");
  treesFolder
    .add(world.params.trees.canopy.size, "min", 0, 10, 1)
    .name("Min Canopy Size");
  treesFolder
    .add(world.params.trees.canopy.size, "max", 0, 10, 1)
    .name("Max Canopy Size");

  const grassFolder = terrainFolder.addFolder("Grass");
  grassFolder.add(world.params.grass, "frequency", 0, 1, 0.1).name("Frequency");
  grassFolder
    .add(world.params.grass, "patchSize", 1, 10, 1)
    .name("Grass Patch Size");

  terrainFolder
    .add(world.params.flowers, "frequency", 0, 1, 0.1)
    .name("Frequency");

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

  gui.add(world, "regenerate").name("Generate");
}
