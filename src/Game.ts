import TWEEN from "@tweenjs/tween.js";
import { Howl, Howler } from "howler";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";

import audioManager from "./audio/AudioManager";
import { BlockID } from "./Block";
import { getBlockDef } from "./Block/blocks";
import { buildBlockIcons, loadBlockTextures } from "./Block/textures";
import { ChunkMaterials } from "./chunk/ChunkMaterial";
import { createUI } from "./GUI";
import {
  randomSeed,
  SAVE_VERSION,
  WorldMeta,
  WorldStorage,
} from "./persistence/WorldStorage";
import { Physics } from "./Physics";
import { Player } from "./Player";
import { numberWithCommas } from "./util";
import { World } from "./World";

const vertexShader = `
  varying vec3 worldPosition;
  void main() {
      vec4 mPosition = modelMatrix * vec4( position, 1.0 );
      worldPosition = mPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const fragmentShader = `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform float exponent;

  varying vec3 worldPosition;

  void main() {

    float h = normalize( worldPosition + offset ).y;
    gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( h, exponent ), 0.0 ) ), 1.0 );

  }
`;

export default class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;

  private stats!: any;
  private gui: ReturnType<typeof createUI> | null = null;
  private debugVisible = false;
  private clock!: THREE.Clock;

  private storage!: WorldStorage;
  private meta!: WorldMeta;
  private lastSave = 0;
  /** Seconds between autosaves of edits and the player position */
  private saveInterval = 3;

  private sunSettings = {
    distance: 400,
    cycleLength: 600,
  };
  private fogRange = { near: 50, far: 100 };

  private sky!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private sun!: THREE.DirectionalLight;
  private sunHelper!: THREE.DirectionalLightHelper;
  world!: World;
  player!: Player;
  private physics!: Physics;

  private previousTime = 0;
  private lastShadowUpdate = 0;

  private dayColor = new THREE.Color(0xc0d8ff);
  private nightColor = new THREE.Color(0x10121e);
  private sunsetColor = new THREE.Color(0xcc7a00);

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
    this.initScene(new ChunkMaterials(textures), this.meta.seed);

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

  initPauseMenu() {
    const resume = document.getElementById("resume");
    resume?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      this.player.controls.lock();
    });

    const newWorld = document.getElementById("new-world");
    newWorld?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      if (!confirm("Create a new world? The current world will be deleted.")) {
        return;
      }
      this.newWorld();
    });

    const githubButton = document.getElementById("github");
    githubButton?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      window.open("https://github.com/0kzh/minicraft");
    });

    this.player.controls.addEventListener("lock", () =>
      this.setPauseVisible(false)
    );
    this.player.controls.addEventListener("unlock", () => {
      if (this.world.initialLoadComplete) this.setPauseVisible(true);
    });
    this.world.onInitialLoad = () => {
      this.setPauseVisible(true);
      this.flushSave();
    };
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
    return createUI(
      this.world,
      this.player,
      this.physics,
      this.fogRange,
      this.sunSettings,
      this.sunHelper,
      () => this.regenerateWorld()
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

  initStats() {
    this.stats = new (Stats as any)();
    this.stats.dom.style.display = "none";
    document.body.appendChild(this.stats.dom);
  }

  initScene(chunkMaterials: ChunkMaterials, seed: number) {
    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer();

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x80abfe);

    document.body.appendChild(this.renderer.domElement);

    // Skybox
    const uniforms = {
      topColor: { type: "c", value: new THREE.Color(0xa0c0ff) },
      bottomColor: { type: "c", value: new THREE.Color(0xffffff) },
      offset: { type: "f", value: 99 },
      exponent: { type: "f", value: 0.3 },
    };

    const skyGeo = new THREE.SphereGeometry(4000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      uniforms: uniforms,
      side: THREE.BackSide,
    });

    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    this.scene.fog = new THREE.Fog(
      0x80a0e0,
      this.fogRange.near,
      this.fogRange.far
    );
    this.scene.fog.color.copy(uniforms.bottomColor.value);

    this.sun = new THREE.DirectionalLight();
    this.sun.intensity = 1.5;

    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sunHelper = new THREE.DirectionalLightHelper(this.sun);
    this.sunHelper.visible = false;
    this.scene.add(this.sunHelper);

    const ambient = new THREE.AmbientLight();
    ambient.intensity = 0.2;
    this.scene.add(ambient);

    this.world = new World(seed, this.scene, chunkMaterials);
    this.scene.add(this.world);

    this.player = new Player(this.scene);
    this.physics = new Physics(this.scene);

    this.updateSunPosition(0);
  }

  initAudio() {
    const sound = new Howl({
      src: ["audio/ambient.mp3"],
      loop: true,
    });
    sound.play();
  }

  onMouseDown(event: MouseEvent) {
    if (this.player.controls.isLocked) {
      if (event.button === 0 && this.player.selectedCoords) {
        // Left click
        const { x, y, z } = this.player.selectedCoords;
        this.world.removeBlock(x, y, z);
      } else if (event.button === 2 && this.player.blockPlacementCoords) {
        if (this.player.activeBlockId != null) {
          const playerPos = new THREE.Vector3(
            Math.floor(this.player.position.x),
            Math.floor(this.player.position.y) - 1,
            Math.floor(this.player.position.z)
          );
          const blockPos = this.player.blockPlacementCoords.clone();

          if (playerPos.distanceTo(blockPos) <= this.player.radius * 2) return;

          this.world.addBlock(
            blockPos.x,
            blockPos.y,
            blockPos.z,
            this.player.activeBlockId
          );
        }
      }
    }
  }

  initListeners() {
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    document.addEventListener("mousedown", this.onMouseDown.bind(this), false);
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => {
      if (e.code === "F3") {
        e.preventDefault();
        this.toggleDebug();
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

  updateSkyColor() {
    const elapsedTime = this.clock.getElapsedTime();
    const cycleDuration = this.sunSettings.cycleLength; // Duration of a day in seconds
    const cycleTime = elapsedTime % cycleDuration;

    let topColor: THREE.Color;
    let bottomColor: THREE.Color;

    if (cycleTime < cycleDuration / 2) {
      // Day time
      topColor = this.dayColor
        .clone()
        .lerp(this.nightColor, cycleTime / (cycleDuration / 2));
      this.sun.intensity = 1 - cycleTime / (cycleDuration / 2); // Sun intensity decreases as the day progresses
    } else {
      // Night time
      topColor = this.nightColor
        .clone()
        .lerp(
          this.dayColor,
          (cycleTime - cycleDuration / 2) / (cycleDuration / 2)
        );
      this.sun.intensity =
        (cycleTime - cycleDuration / 2) / (cycleDuration / 2); // Sun intensity increases as the night progresses
    }

    const dayStart = 0;
    const sunsetStart = cycleDuration * 0.4; // Start sunset at 40% of the cycle
    const nightStart = cycleDuration * 0.5; // Start night at 50% of the cycle
    const sunriseStart = cycleDuration * 0.9; // Start sunrise at 90% of the cycle

    if (cycleTime >= dayStart && cycleTime < sunsetStart) {
      // Day time
      bottomColor = this.dayColor
        .clone()
        .lerp(
          this.sunsetColor,
          (cycleTime - dayStart) / (sunsetStart - dayStart)
        );
    } else if (cycleTime >= sunsetStart && cycleTime < nightStart) {
      // Sunset
      bottomColor = this.sunsetColor
        .clone()
        .lerp(
          this.nightColor,
          (cycleTime - sunsetStart) / (nightStart - sunsetStart)
        );
    } else if (cycleTime >= nightStart && cycleTime < sunriseStart) {
      // Night time
      bottomColor = this.nightColor
        .clone()
        .lerp(
          this.sunsetColor,
          (cycleTime - nightStart) / (sunriseStart - nightStart)
        );
    } else {
      // Sunrise
      bottomColor = this.sunsetColor
        .clone()
        .lerp(
          this.dayColor,
          (cycleTime - sunriseStart) / (cycleDuration - sunriseStart)
        );
    }

    this.sky.material.uniforms.topColor.value = topColor;
    this.sky.material.uniforms.bottomColor.value = bottomColor;
    this.world.materials.sunLight = this.sun.intensity;
    this.world.materials.time = elapsedTime;

    this.updateFog(topColor);

    if (
      performance.now() - this.lastShadowUpdate <
      this.sunSettings.cycleLength
    )
      return;

    const sunAngle =
      ((2 * Math.PI) / cycleDuration) * (cycleTime + cycleDuration / 6); // Calculate the angle of the sun based on the cycle time with a phase shift of T/4
    this.updateSunPosition(sunAngle);

    this.lastShadowUpdate = performance.now();
  }

  /**
   * Thick blue fog while the camera is submerged, otherwise a faint haze
   * matching the sky
   */
  private updateFog(skyColor: THREE.Color) {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.Fog)) return;
    const eye = this.player.camera.position;
    const eyeBlock = this.world.getBlock(
      Math.floor(eye.x),
      Math.floor(eye.y),
      Math.floor(eye.z)
    );
    const submerged = eyeBlock !== undefined && getBlockDef(eyeBlock).fluid;
    if (submerged) {
      const lava = eyeBlock === BlockID.Lava;
      fog.color.set(lava ? 0x7a1e00 : 0x0a2a55);
      fog.near = lava ? 0 : 1;
      fog.far = lava ? 4 : 22;
    } else {
      fog.color.copy(skyColor).multiplyScalar(0.2);
      fog.near = this.fogRange.near;
      fog.far = this.fogRange.far;
    }
  }

  updateSunPosition(angle: number) {
    const sunX = this.sunSettings.distance * Math.cos(angle); // Calculate the X position of the sun
    const sunY = this.sunSettings.distance * Math.sin(angle); // Calculate the Y position of the sun
    this.sun.position.set(sunX, sunY, this.player.camera.position.z); // Update the position of the sun
    this.sun.position.add(this.player.camera.position);

    this.sun.target.position.copy(this.player.camera.position);
    this.sun.target.updateMatrixWorld();

    this.sunHelper.update();
  }

  draw() {
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.previousTime) / 1000;

    requestAnimationFrame(() => {
      this.draw();
    });

    this.updateSkyColor();

    if (this.world.initialLoadComplete) {
      this.physics.update(deltaTime, this.player, this.world);
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

    TWEEN.update();

    this.renderer.render(this.scene, this.player.camera);

    this.previousTime = currentTime;
  }
}
