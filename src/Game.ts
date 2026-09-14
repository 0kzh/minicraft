import { Howl } from "howler";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";

import audioManager from "./audio/AudioManager";
import { BlockID } from "./Block";
import { getBlockDef } from "./Block/blocks";
import {
  BlockTextures,
  buildBlockIcons,
  loadBlockTextures,
} from "./Block/textures";
import { ChunkMaterials } from "./chunk/ChunkMaterial";
import { BlockBreaker } from "./gameplay/BlockBreaker";
import { blockStats, CREATIVE_PALETTE } from "./gameplay/blockStats";
import { HandRenderer } from "./gameplay/HandRenderer";
import { Hud } from "./gameplay/Hud";
import { Inventory } from "./gameplay/Inventory";
import { Particles } from "./gameplay/Particles";
import { Vitals } from "./gameplay/Vitals";
import { createUI } from "./GUI";
import {
  GameMode,
  loadRenderDistance,
  randomSeed,
  SAVE_VERSION,
  saveRenderDistance,
  WorldMeta,
  WorldStorage,
} from "./persistence/WorldStorage";
import { Physics } from "./Physics";
import { Player } from "./Player";
import { Sky } from "./Sky";
import { numberWithCommas } from "./util";
import { World } from "./World";

const MIN_RENDER_DISTANCE = 2;
const MAX_RENDER_DISTANCE = 32;
const DEFAULT_MODE: GameMode = "survival";

const UNDERWATER_FOG = new THREE.Color(0x0a2a55);
const LAVA_FOG = new THREE.Color(0x7a1e00);

export default class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;

  private stats!: Stats;
  private gui: ReturnType<typeof createUI> | null = null;
  private debugVisible = false;
  private clock!: THREE.Clock;

  private storage!: WorldStorage;
  private meta!: WorldMeta;
  private lastSave = 0;
  /** Seconds between autosaves of edits and the player position */
  private saveInterval = 3;

  private sky!: Sky;
  world!: World;
  player!: Player;
  private physics!: Physics;
  private particles!: Particles;
  private breaker!: BlockBreaker;
  private hand!: HandRenderer;
  private vitals = new Vitals();
  private hud = new Hud();
  private survivalInventory = new Inventory();
  private creativeInventory = Inventory.creative(CREATIVE_PALETTE);
  mode: GameMode = DEFAULT_MODE;
  /** Deferred right-click repeat, like vanilla's 4-tick place delay */
  private placeCooldown = 0;
  private placing = false;

  private previousTime = 0;
  private readonly fogColor = new THREE.Color();

  constructor() {
    this.previousTime = performance.now();
    this.clock = new THREE.Clock();
    this.start();
  }

  /**
   * Boots straight into the saved world (or a brand new one with a random
   * seed) and shows the pause menu once the terrain around the player is in.
   */
  async start() {
    const loadingScreen = document.getElementById("loading");
    if (loadingScreen) loadingScreen.style.display = "block";

    const [textures, storage] = await Promise.all([
      loadBlockTextures(),
      WorldStorage.open(),
    ]);
    buildBlockIcons(textures.icons);
    this.storage = storage;

    const saved = await storage.loadMeta();
    this.meta = saved ?? Game.newMeta();
    this.initScene(textures, this.meta.seed);
    this.world.renderDistance = THREE.MathUtils.clamp(
      loadRenderDistance(this.world.renderDistance),
      MIN_RENDER_DISTANCE,
      MAX_RENDER_DISTANCE
    );

    if (saved) {
      this.world.dataStore.load(await storage.loadChunks());
      if (saved.player) {
        const { x, y, z, yaw, pitch } = saved.player;
        this.world.restore(this.player, new THREE.Vector3(x, y, z));
        this.player.setLook(yaw, pitch);
      }
      if (saved.survival && saved.survival.health > 0) {
        this.vitals.health = saved.survival.health;
        this.vitals.food = saved.survival.food ?? this.vitals.food;
        this.vitals.saturation =
          saved.survival.saturation ?? this.vitals.saturation;
        this.survivalInventory.load(saved.survival.inventory);
      }
    } else {
      await storage.saveMeta(this.meta);
    }
    this.setMode(saved?.mode ?? DEFAULT_MODE, false);

    this.initStats();
    this.initListeners();
    this.initPauseMenu();
    this.initAudio();
    this.updateSeedLabel();
    this.draw();
  }

  private static newMeta(): WorldMeta {
    const now = Date.now();
    return {
      version: SAVE_VERSION,
      seed: randomSeed(),
      createdAt: now,
      updatedAt: now,
      mode: DEFAULT_MODE,
    };
  }

  /** Wipes the save and generates a fresh world from a random seed */
  async newWorld() {
    await this.flushSave();
    this.meta = { ...Game.newMeta(), mode: this.mode };
    this.world.dataStore.clear();
    await this.storage.clear();
    this.survivalInventory.clear();
    this.vitals.reset();
    this.refreshHotbar();
    await this.storage.saveMeta(this.meta);
    this.world.seed = this.meta.seed;
    this.updateSeedLabel();
    this.setPauseVisible(false);
    this.world.regenerate(this.player);
  }

  /** Regenerates with the current (debug-tweaked) params, discarding edits */
  async regenerateWorld() {
    await this.flushSave();
    this.meta = { ...Game.newMeta(), seed: this.world.seed, mode: this.mode };
    this.world.dataStore.clear();
    await this.storage.clear();
    await this.storage.saveMeta(this.meta);
    this.updateSeedLabel();
    this.world.regenerate(this.player);
  }

  // ---------------------------------------------------------------- game modes

  get survival() {
    return this.mode === "survival";
  }

  setMode(mode: GameMode, announce = true) {
    this.mode = mode;
    this.meta.mode = mode;
    const survival = mode === "survival";
    this.player.canFly = !survival;
    this.player.flying = false;
    this.player.hotbar = survival
      ? this.survivalInventory
      : this.creativeInventory;
    this.hud.setSurvival(survival);
    this.refreshHotbar();
    this.hud.renderVitals(this.vitals);
    if (this.breaker) this.breaker.stop();

    const label = document.getElementById("game-mode");
    if (label) {
      label.textContent = `Game Mode: ${survival ? "Survival" : "Creative"}`;
    }
    if (announce) this.flushSave();
  }

  private refreshHotbar() {
    this.hud.renderHotbar(this.player.hotbar);
  }

  setRenderDistance(value: number) {
    const rd = THREE.MathUtils.clamp(
      Math.round(value),
      MIN_RENDER_DISTANCE,
      MAX_RENDER_DISTANCE
    );
    this.world.renderDistance = rd;
    saveRenderDistance(rd);
    const label = document.getElementById("render-distance");
    if (label) label.textContent = `Render Distance: ${rd} chunks`;
    const slider = document.getElementById("render-distance-slider");
    if (slider instanceof HTMLInputElement) slider.value = String(rd);
  }

  private onDeath() {
    this.player.dead = true;
    this.player.releaseKeys();
    this.breaker.stop();
    this.placing = false;
    this.player.controls.unlock();
    const death = document.getElementById("death");
    if (death) death.style.display = "flex";
    const cause = document.getElementById("death-cause");
    if (cause) {
      cause.textContent = this.player.inLava
        ? "You tried to swim in lava"
        : this.player.eyeSubmerged
        ? "You drowned"
        : this.player.pos.y < 0
        ? "You fell out of the world"
        : "You hit the ground too hard";
    }
  }

  private respawn() {
    const death = document.getElementById("death");
    if (death) death.style.display = "none";
    // Vanilla drops the whole inventory on death; items simply vanish here
    this.survivalInventory.clear();
    this.vitals.reset();
    const spawn = this.world.getSpawn();
    this.player.placeFeet(spawn.x, spawn.y + 1, spawn.z);
    this.player.dead = false;
    this.refreshHotbar();
    this.flushSave();
    this.lockControls();
  }

  // ----------------------------------------------------------------- menus

  initPauseMenu() {
    const click = (id: string, handler: () => void) => {
      document.getElementById(id)?.addEventListener("click", () => {
        audioManager.play("gui.button.press");
        handler();
      });
    };

    click("resume", () => this.lockControls());
    click("game-mode", () =>
      this.setMode(this.survival ? "creative" : "survival")
    );
    click("new-world", () => {
      if (confirm("Create a new world? The current world will be deleted.")) {
        this.newWorld();
      }
    });
    click("github", () => window.open("https://github.com/0kzh/minicraft"));
    click("respawn", () => this.respawn());

    const slider = document.getElementById("render-distance-slider");
    if (slider instanceof HTMLInputElement) {
      slider.min = String(MIN_RENDER_DISTANCE);
      slider.max = String(MAX_RENDER_DISTANCE);
      slider.addEventListener("input", () =>
        this.setRenderDistance(Number(slider.value))
      );
      slider.addEventListener("change", () =>
        audioManager.play("gui.button.press")
      );
    }
    this.setRenderDistance(this.world.renderDistance);

    this.player.controls.addEventListener("lock", () =>
      this.setPauseVisible(false)
    );
    this.player.controls.addEventListener("unlock", () => {
      this.breaker.stop();
      this.placing = false;
      if (this.world.initialLoadComplete && !this.player.dead) {
        this.setPauseVisible(true);
      }
    });
    this.world.onInitialLoad = () => {
      this.setPauseVisible(true);
      this.flushSave();
    };
  }

  private lockControls() {
    if (this.player.dead || !this.world.initialLoadComplete) return;
    try {
      this.player.controls.lock();
    } catch (e) {
      // Browsers throw when pointer lock is requested too soon after an
      // Esc-triggered exit; the menu just stays up until the next attempt
      console.warn("Pointer lock unavailable", e);
    }
  }

  /** Esc toggles between the pause menu and the game */
  private togglePause() {
    if (this.player.controls.isLocked) {
      this.player.controls.unlock();
    } else {
      this.lockControls();
    }
  }

  private setPauseVisible(visible: boolean) {
    const pause = document.getElementById("pause");
    if (pause) pause.style.display = visible ? "flex" : "none";
  }

  private updateSeedLabel() {
    const label = document.getElementById("seed-label");
    if (label) label.textContent = `Seed: ${this.meta.seed}`;
    const debugSeed = document.getElementById("world-seed");
    if (debugSeed) debugSeed.textContent = `seed: ${this.meta.seed}`;
  }

  /** Shows/hides the debug overlay, FPS panel and tuning controls (F3) */
  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    const debug = document.getElementById("debug");
    if (debug) debug.style.display = this.debugVisible ? "flex" : "none";
    if (this.stats) {
      this.stats.dom.style.display = this.debugVisible ? "block" : "none";
    }
    if (this.debugVisible) {
      if (!this.gui) this.gui = this.createGUI();
      this.gui.show();
    } else {
      this.gui?.hide();
    }
  }

  private createGUI() {
    return createUI(this.world, this.player, this.physics, this.sky, () =>
      this.regenerateWorld()
    );
  }

  /** Persists dirty chunk edits, the player's position and survival progress */
  private async flushSave() {
    if (!this.world.initialLoadComplete) return;
    const dirty = this.world.dataStore.takeDirty();
    const look = this.player.getLook();
    const p = this.player.position;
    this.meta.player = {
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: look.yaw,
      pitch: look.pitch,
    };
    this.meta.mode = this.mode;
    this.meta.survival = {
      health: this.vitals.health,
      food: this.vitals.food,
      saturation: this.vitals.saturation,
      inventory: this.survivalInventory.toJSON(),
    };
    this.meta.updatedAt = Date.now();
    await Promise.all([
      dirty.length ? this.storage.saveChunks(dirty) : undefined,
      this.storage.saveMeta(this.meta),
    ]);
  }

  // ----------------------------------------------------------------- setup

  initStats() {
    this.stats = new Stats();
    this.stats.dom.style.display = "none";
    document.body.appendChild(this.stats.dom);
  }

  initScene(textures: BlockTextures, seed: number) {
    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x80abfe);
    // The hand is drawn in a second pass over the world, so clear by hand
    this.renderer.autoClear = false;
    document.body.appendChild(this.renderer.domElement);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.world = new World(seed, this.scene, new ChunkMaterials(textures));
    this.scene.add(this.world);

    this.player = new Player(this.scene);
    this.player.onHotbarChange = () => this.refreshHotbar();
    this.player.onExhaustion = (amount) => {
      if (this.survival) this.vitals.addExhaustion(amount);
    };
    this.physics = new Physics(this.scene);
    this.hand = new HandRenderer(textures);

    this.particles = new Particles(textures, this.world);
    this.scene.add(this.particles.points);
    this.breaker = new BlockBreaker(this.particles);
    this.scene.add(this.breaker.crack);
    this.breaker.onBreak = (_x, _y, _z, id) => {
      if (!this.survival) return;
      const drop = blockStats(id).drop;
      if (drop !== null) {
        this.survivalInventory.add(drop);
        this.refreshHotbar();
      }
    };

    this.vitals.onChange = () => this.hud.renderVitals(this.vitals);
    this.vitals.onDeath = () => this.onDeath();

    // Compile the crack, particle and hand programs now rather than stalling
    // the frame the first time a block is hit
    this.breaker.crack.visible = true;
    this.renderer.compile(this.scene, this.player.camera);
    this.breaker.crack.visible = false;
    this.hand.precompile(this.renderer);
  }

  initAudio() {
    const sound = new Howl({
      src: ["audio/ambient.mp3"],
      loop: true,
    });
    sound.play();
  }

  initListeners() {
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    document.addEventListener("mousedown", this.onMouseDown.bind(this), false);
    document.addEventListener("mouseup", this.onMouseUp.bind(this), false);
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => {
      if (e.code === "F3") {
        e.preventDefault();
        this.toggleDebug();
      } else if (e.code === "Escape") {
        // Browsers release pointer lock on Esc themselves (firing `unlock`);
        // when the menu is already up, Esc goes back into the game
        if (!this.player.controls.isLocked) this.togglePause();
      }
    });
    // Save before the tab goes away; IndexedDB writes started here complete
    window.addEventListener("pagehide", () => this.flushSave());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushSave();
    });
  }

  onWindowResize() {
    this.player.camera.aspect = window.innerWidth / window.innerHeight;
    this.player.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------ interaction

  onMouseDown(event: MouseEvent) {
    if (!this.player.controls.isLocked || this.player.dead) return;
    if (event.button === 0) {
      // Minecraft.startAttack swings even when nothing is hit
      this.player.swing();
      this.breaker.start();
    } else if (event.button === 2) {
      this.placing = true;
      this.placeCooldown = 0;
    }
  }

  onMouseUp(event: MouseEvent) {
    if (event.button === 0) this.breaker.stop();
    if (event.button === 2) this.placing = false;
  }

  /** Places the selected block; survival consumes one from the stack */
  private tryPlace() {
    const target = this.player.blockPlacementCoords;
    const id = this.player.activeBlockId;
    if (!target || id === null) return;
    const def = getBlockDef(id);
    if (
      !def.passable &&
      this.player.intersectsBlock(target.x, target.y, target.z)
    )
      return;
    if (this.world.addBlock(target.x, target.y, target.z, id)) {
      this.player.swing();
      this.player.hotbar.consumeSelected();
      this.refreshHotbar();
    }
  }

  private updateInteraction(dt: number) {
    if (!this.player.controls.isLocked || this.player.dead) return;
    this.breaker.update(dt, this.player, this.world, !this.survival);
    if (this.placing) {
      this.placeCooldown -= dt;
      if (this.placeCooldown <= 0) {
        this.tryPlace();
        this.placeCooldown = 4 * Physics.TICK;
      }
    }
  }

  // ----------------------------------------------------------- atmosphere

  private updateAtmosphere() {
    const time = this.clock.getElapsedTime();
    this.sky.update(time, this.player.camera.position);
    this.world.materials.sunLight = this.sky.daylight;
    this.world.materials.time = time;

    // Fog fades terrain out over the last chunks of the render distance so
    // the edge of the loaded world melts into the horizon instead of ending
    // in a hard silhouette. Cylindrical distance keeps the fade at the same
    // radius no matter how high the camera is.
    let start: number;
    let end: number;
    let cylindrical = true;
    if (this.player.eyeSubmerged) {
      const lava = this.player.inLava;
      this.fogColor.copy(lava ? LAVA_FOG : UNDERWATER_FOG);
      start = lava ? 0 : 1;
      end = lava ? 4 : 22;
      cylindrical = false;
    } else {
      this.fogColor.copy(this.sky.horizon);
      const radius =
        (this.world.renderDistance + 0.5) * this.world.chunkSize.width;
      start = radius * 0.62;
      end = radius * 0.96;
      this.sky.fogEnd = end;
    }
    this.world.materials.setFog(this.fogColor, start, end, cylindrical);
    this.particles.setLighting(this.sky.daylight, this.fogColor, start, end);
    this.renderer.setClearColor(this.fogColor);
    this.hand.setLight(this.sky.daylight, this.skyVisibleAbovePlayer());
  }

  /** Whether nothing opaque sits above the eyes (rough stand-in for sky light) */
  private skyVisibleAbovePlayer() {
    const p = this.player.position;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    for (let y = Math.floor(p.y) + 1; y < this.world.chunkSize.height; y++) {
      const id = this.world.getBlock(x, y, z);
      if (id !== undefined && id !== BlockID.Air && getBlockDef(id).opaque) {
        return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ loop

  draw() {
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.previousTime) / 1000;

    requestAnimationFrame(() => {
      this.draw();
    });

    this.updateAtmosphere();

    if (this.world.initialLoadComplete) {
      this.player.sprintAllowed = !this.survival || this.vitals.canSprint;
      this.physics.update(deltaTime, this.player, this.world);
      if (this.survival) this.vitals.update(deltaTime, this.player);
      this.updateInteraction(deltaTime);
      this.hand.update(deltaTime, this.player);
    }
    this.world.update(this.player);
    this.particles.update(
      deltaTime,
      this.player.camera,
      this.renderer.getPixelRatio()
    );
    if (this.survival) this.hud.update(deltaTime, this.vitals);
    if (this.world.initialLoadComplete) {
      this.world.fluids.update(Math.min(deltaTime, 0.25));
      if (currentTime - this.lastSave > this.saveInterval * 1000) {
        this.lastSave = currentTime;
        this.flushSave();
      }
    }

    // update triangle count
    const triangleCount = document.getElementById("triangle-count");
    if (triangleCount) {
      triangleCount.innerHTML = `triangles: ${numberWithCommas(
        this.renderer.info.render.triangles
      )}`;
    }

    const renderCalls = document.getElementById("render-calls");
    if (renderCalls) {
      renderCalls.innerHTML = `draw calls: ${numberWithCommas(
        this.renderer.info.render.calls
      )}`;
    }

    if (this.stats) this.stats.update();

    this.renderWorldAndHand();

    this.previousTime = currentTime;
  }

  /** World pass with the vanilla hurt roll, then the first-person hand on top */
  private renderWorldAndHand() {
    const camera = this.player.camera;
    const roll = this.survival ? this.vitals.hurtRoll : 0;
    const look = camera.quaternion.clone();
    if (roll !== 0) {
      camera.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          roll
        )
      );
    }
    this.renderer.clear();
    this.renderer.render(this.scene, camera);
    camera.quaternion.copy(look);
    if (this.world.initialLoadComplete) {
      this.hand.render(
        this.renderer,
        this.player,
        this.physics.accumulator / Physics.TICK,
        roll
      );
    }
  }
}
