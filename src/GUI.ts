import GUI from "lil-gui";

import { Physics } from "./Physics";
import { Player } from "./Player";
import { World } from "./World";

export function createUI(
  world: World,
  player: Player,
  physics: Physics,
  fogRange: { near: number; far: number },
  sunSettings: { distance: number; cycleLength: number },
  sunHelper: THREE.DirectionalLightHelper,
  regenerate: () => void
): GUI {
  const gui = new GUI({ title: "Debug (F3)" });
  gui.hide();
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
  worldFolder.add(sunHelper, "visible").name("Show Sun Helper");
  worldFolder
    .add(sunSettings, "cycleLength", 0, 1000, 1)
    .name("Day Length (s)");
  worldFolder.add(world, "renderDistance", 1, 32, 1).name("Render Distance");
  worldFolder.add(fogRange, "near", 1, 400, 1).name("Fog Near");
  worldFolder.add(fogRange, "far", 1, 600, 1).name("Fog Far");

  const terrainFolder = gui.addFolder("Terrain");
  terrainFolder
    .add(world, "wireframeMode")
    .name("X-ray Mode (Disable Textures)");
  terrainFolder.add(world.chunkSize, "width", 8, 128, 1).name("Width");
  terrainFolder.add(world.chunkSize, "height", 8, 255, 1).name("Height");
  terrainFolder.add(world.params, "seed", 0, 2 ** 31 - 1, 1).name("Seed");
  const terrain = world.params.terrain;
  terrainFolder.add(terrain, "seaLevel", 0, 120, 1).name("Sea Level");
  terrainFolder.add(terrain, "amplitude", 0, 2.5, 0.05).name("Mountains");
  terrainFolder
    .add(terrain, "continentScale", 100, 2000, 10)
    .name("Continent Scale");
  terrainFolder
    .add(terrain, "erosionScale", 100, 2000, 10)
    .name("Erosion Scale");
  terrainFolder.add(terrain, "ridgeScale", 40, 500, 5).name("Ridge Scale");
  terrainFolder.add(terrain, "detailScale", 10, 120, 1).name("Detail Scale");
  terrainFolder.add(terrain, "biomeScale", 100, 2000, 10).name("Biome Scale");
  terrainFolder.add(terrain, "rivers").name("Rivers");
  terrainFolder.add(terrain, "riverScale", 100, 1500, 10).name("River Scale");

  const cavesFolder = terrainFolder.addFolder("Caves");
  const caves = world.params.caves;
  cavesFolder.add(caves, "enabled").name("Enabled");
  cavesFolder.add(caves, "ravines").name("Ravines");
  cavesFolder.add(caves, "cheeseScale", 16, 128, 1).name("Cavern Scale");
  cavesFolder
    .add(caves, "cheeseThreshold", 0.2, 0.9, 0.01)
    .name("Cavern Threshold");
  cavesFolder.add(caves, "spaghettiScale", 8, 96, 1).name("Tunnel Scale");
  cavesFolder
    .add(caves, "spaghettiRadius", 0.02, 0.2, 0.005)
    .name("Tunnel Radius");
  cavesFolder.add(caves, "lavaLevel", 0, 40, 1).name("Lava Level");

  const decorFolder = terrainFolder.addFolder("Decoration");
  decorFolder.add(world.params.trees, "density", 0, 3, 0.05).name("Trees");
  decorFolder
    .add(world.params.vegetation, "density", 0, 3, 0.05)
    .name("Plants");
  decorFolder.add(world.params.ores, "density", 0, 3, 0.05).name("Ores");

  gui.add({ regenerate }, "regenerate").name("Generate (wipes edits)");
  return gui;
}
