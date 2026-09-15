import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";

import { AdaptiveRenderDistance } from "./AdaptiveRenderDistance";
import audioManager from "./audio/AudioManager";
import { MusicManager } from "./audio/MusicManager";
import { BlockID } from "./Block";
import { getBlockDef } from "./Block/blocks";
import {
  BlockTextures,
  buildBlockIcons,
  loadBlockTextures,
} from "./Block/textures";
import { ChunkMaterials } from "./chunk/ChunkMaterial";
import { Clouds } from "./Clouds";
import { BlockBreaker } from "./gameplay/BlockBreaker";
import { HandRenderer } from "./gameplay/HandRenderer";
import { Hud } from "./gameplay/Hud";
import { Particles } from "./gameplay/Particles";
import { createUI } from "./GUI";
import {
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

/** Chromium's pointer-lock cooldown after an Esc exit is 1.25 s */
const LOCK_RETRY_MS = 1300;

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
  private breaker!: BlockBreaker;
  private hand!: HandRenderer;
  private particles!: Particles;
  private hud = new Hud();
  private adaptive!: AdaptiveRenderDistance;
  private music = new MusicManager();
  private clouds!: Clouds;
  /** Deferred right-click repeat, like vanilla's 4-tick place delay */
  private placeCooldown = 0;
  private placing = false;
  private wantLock = false;
  private lockRetried = false;
  private lockRetry = 0;

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
    this.adaptive = new AdaptiveRenderDistance(
      this.world.renderDistance,
      (distance) => {
        this.world.renderDistance = distance;
        this.refreshRenderDistanceLabel();
      }
    );

    if (saved) {
      this.world.dataStore.load(await storage.loadChunks());
      if (saved.player) {
        const { x, y, z, yaw, pitch } = saved.player;
        this.world.restore(this.player, new THREE.Vector3(x, y, z));
        this.player.setLook(yaw, pitch);
      }
    } else {
      await storage.saveMeta(this.meta);
    }
    this.refreshHotbar();

    this.initStats();
    this.initListeners();
    this.initPauseMenu();
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
    };
  }

  /** Wipes the save and generates a fresh world from a random seed */
  async newWorld() {
    await this.flushSave();
    this.meta = Game.newMeta();
    this.world.dataStore.clear();
    await this.storage.clear();
    await this.storage.saveMeta(this.meta);
    this.world.seed = this.meta.seed;
    this.updateSeedLabel();
    this.setPauseVisible(false);
    this.world.regenerate(this.player);
  }

  /** Regenerates with the current (debug-tweaked) params, discarding edits */
  async regenerateWorld() {
    await this.flushSave();
    this.meta = { ...Game.newMeta(), seed: this.world.seed };
    this.world.dataStore.clear();
    await this.storage.clear();
    await this.storage.saveMeta(this.meta);
    this.updateSeedLabel();
    this.world.regenerate(this.player);
  }

  // ------------------------------------------------------------------ hud

  private refreshHotbar() {
    this.hud.renderHotbar(this.player.hotbar);
  }

  setRenderDistance(value: number) {
    const rd = THREE.MathUtils.clamp(
      Math.round(value),
      MIN_RENDER_DISTANCE,
      MAX_RENDER_DISTANCE
    );
    saveRenderDistance(rd);
    this.adaptive.setMax(rd);
    this.refreshRenderDistanceLabel();
    const slider = document.getElementById("render-distance-slider");
    if (slider instanceof HTMLInputElement) slider.value = String(rd);
  }

  private refreshRenderDistanceLabel() {
    const label = document.getElementById("render-distance");
    if (!label) return;
    const { max, current } = this.adaptive;
    label.textContent =
      current < max
        ? `Render Distance: ${max} chunks (auto ${current})`
        : `Render Distance: ${max} chunks`;
  }

  // ----------------------------------------------------------------- menus

  initPauseMenu() {
    const click = (id: string, handler: () => void) => {
      document.getElementById(id)?.addEventListener("click", () => {
        audioManager.play("ui.button.click");
        handler();
      });
    };

    click("resume", () => this.lockControls());
    // Clicking the dimmed world behind the menu also resumes, since Esc alone
    // cannot re-lock the pointer in Chromium
    document.getElementById("pause")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) this.lockControls();
    });
    click("new-world", () => {
      if (confirm("Create a new world? The current world will be deleted.")) {
        this.newWorld();
      }
    });
    click("github", () => window.open("https://github.com/0kzh/minicraft"));

    const slider = document.getElementById("render-distance-slider");
    if (slider instanceof HTMLInputElement) {
      slider.min = String(MIN_RENDER_DISTANCE);
      slider.max = String(MAX_RENDER_DISTANCE);
      slider.addEventListener("input", () =>
        this.setRenderDistance(Number(slider.value))
      );
      slider.addEventListener("change", () =>
        audioManager.play("ui.button.click")
      );
    }
    this.setRenderDistance(this.adaptive.max);

    const musicSlider = document.getElementById("music-volume-slider");
    const musicLabel = document.getElementById("music-volume");
    if (musicSlider instanceof HTMLInputElement && musicLabel) {
      const show = () =>
        (musicLabel.textContent = `Music: ${Math.round(
          this.music.volume * 100
        )}%`);
      musicSlider.value = String(Math.round(this.music.volume * 100));
      show();
      musicSlider.addEventListener("input", () => {
        this.music.setVolume(Number(musicSlider.value) / 100);
        show();
      });
      musicSlider.addEventListener("change", () =>
        audioManager.play("ui.button.click")
      );
    }

    this.player.controls.addEventListener("lock", () => {
      this.wantLock = false;
      this.setPauseVisible(false);
    });
    document.addEventListener("pointerlockerror", () =>
      this.onPointerLockError()
    );
    this.player.controls.addEventListener("unlock", () => {
      this.wantLock = false;
      window.clearTimeout(this.lockRetry);
      this.breaker.stop();
      this.placing = false;
      if (this.world.initialLoadComplete) this.setPauseVisible(true);
    });
    this.world.onInitialLoad = () => {
      this.setPauseVisible(true);
      this.flushSave();
    };
  }

  private lockControls() {
    if (!this.world.initialLoadComplete || this.player.controls.isLocked)
      return;
    window.clearTimeout(this.lockRetry);
    this.wantLock = true;
    this.lockRetried = false;
    this.player.controls.lock();
  }

  /**
   * Chromium refuses pointer lock for ~1.25 s after an Esc-triggered exit
   * (`pointerlockerror`); one retry after the cooldown covers a click that
   * landed inside it. Esc itself never counts as a user gesture in Chromium,
   * so a request it triggered can fail for good: the menu then stays up until
   * the player clicks.
   */
  private onPointerLockError() {
    if (!this.wantLock || this.lockRetried) return;
    this.lockRetried = true;
    window.clearTimeout(this.lockRetry);
    this.lockRetry = window.setTimeout(
      () => this.player.controls.lock(),
      LOCK_RETRY_MS
    );
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
    this.music.setMuted(visible);
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

  /** Persists dirty chunk edits and the player's position */
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
    this.clouds = new Clouds();
    this.scene.add(this.clouds.group);

    this.world = new World(seed, this.scene, new ChunkMaterials(textures));
    this.scene.add(this.world);

    this.player = new Player(this.scene);
    this.player.onHotbarChange = () => this.refreshHotbar();
    this.physics = new Physics(this.scene);
    this.hand = new HandRenderer(textures);

    this.particles = new Particles(textures, this.world);
    this.scene.add(this.particles.mesh);
    this.breaker = new BlockBreaker(this.particles);

    // Compile the particle and hand programs now rather than stalling the
    // frame the first time a block is hit
    this.renderer.compile(this.scene, this.player.camera);
    this.hand.precompile(this.renderer);
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
    if (!this.player.controls.isLocked) return;
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
    }
  }

  private updateInteraction(dt: number) {
    if (!this.player.controls.isLocked) return;
    this.breaker.update(dt, this.player, this.world);
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
    // FogRenderer.setupFog(FOG_TERRAIN): clouds fade only over the last
    // viewDistance / 10 blocks (4..64), so they stay visible past the terrain
    this.clouds.setFog(
      this.fogColor,
      cylindrical ? end - THREE.MathUtils.clamp(end / 10, 4, 64) : start,
      end
    );
    this.clouds.update(time, this.sky.timeOfDay, this.player.camera.position);
    this.renderer.setClearColor(this.fogColor);
    this.particles.setLighting(this.sky.daylight, this.fogColor, start, end);
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
    this.music.update(deltaTime);
    this.adaptive.update(
      deltaTime,
      this.world.initialLoadComplete && this.player.controls.isLocked
    );

    if (this.world.initialLoadComplete) {
      this.physics.update(deltaTime, this.player, this.world);
      this.updateInteraction(deltaTime);
      this.hand.update(deltaTime, this.player);
      this.particles.update(deltaTime);
    }
    this.world.update(this.player);
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

  /** World pass, then the first-person hand on top */
  private renderWorldAndHand() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.player.camera);
    if (this.world.initialLoadComplete) {
      this.hand.render(
        this.renderer,
        this.player,
        this.physics.accumulator / Physics.TICK
      );
    }
  }
}
