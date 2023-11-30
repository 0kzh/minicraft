import TWEEN from "@tweenjs/tween.js";
import { Howl, Howler } from "howler";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Stats from "three/examples/jsm/libs/stats.module";

import audioManager from "./audio/AudioManager";
import { createUI } from "./GUI";
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
  private orbitCamera!: THREE.PerspectiveCamera;

  private controls!: OrbitControls;
  private stats!: any;
  private clock!: THREE.Clock;

  private sunSettings = {
    distance: 400,
    cycleLength: 600,
  };

  private sky!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private sun!: THREE.DirectionalLight;
  private sunHelper!: THREE.DirectionalLightHelper;
  private shadowHelper!: THREE.CameraHelper;
  private world!: World;
  private player!: Player;
  private physics!: Physics;

  private previousTime = 0;
  private lastShadowUpdate = 0;

  private dayColor = new THREE.Color(0xc0d8ff);
  private nightColor = new THREE.Color(0x10121e);
  private sunsetColor = new THREE.Color(0xcc7a00);

  constructor() {
    this.previousTime = performance.now();
    this.clock = new THREE.Clock();
    this.initMainMenu();
  }

  initMainMenu() {
    const mainMenu = document.getElementById("main-menu");
    const loadingScreen = document.getElementById("loading");
    const startGameButton = document.getElementById("start-game");
    startGameButton?.addEventListener("click", () => {
      if (mainMenu) mainMenu.style.display = "none";
      if (loadingScreen) loadingScreen.style.display = "block";
      audioManager.play("gui.button.press");

      this.initScene();
      this.initStats();
      this.initListeners();
      this.initAudio();
    });

    const githubButton = document.getElementById("github");
    githubButton?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      window.open("https://github.com/0kzh/minicraft");
    });

    const websiteButton = document.getElementById("website");
    websiteButton?.addEventListener("click", () => {
      audioManager.play("gui.button.press");
      window.open("https://kelvinzhang.com");
    });
  }

  initStats() {
    this.stats = new (Stats as any)();
    document.body.appendChild(this.stats.dom);
  }

  initScene() {
    this.scene = new THREE.Scene();

    this.orbitCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight
    );
    this.orbitCamera.position.set(-32, 64, -32);

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x80abfe);

    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(
      this.orbitCamera,
      this.renderer.domElement
    );
    this.controls.target.set(0, 0, 0);
    this.controls.update();

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

    this.scene.fog = new THREE.Fog(0x80a0e0, 50, 100);
    this.scene.fog.color.copy(uniforms.bottomColor.value);

    this.sun = new THREE.DirectionalLight();
    // this.sun.position.set(50, 50, 50);
    this.sun.intensity = 1.5;
    this.sun.castShadow = true;

    // Set the size of the sun's shadow box
    this.sun.shadow.camera.left = -80;
    this.sun.shadow.camera.right = 80;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.camera.near = 0.1;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -0.005;
    this.sun.shadow.mapSize = new THREE.Vector2(512, 512);

    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sunHelper = new THREE.DirectionalLightHelper(this.sun);
    this.sunHelper.visible = false;
    this.scene.add(this.sunHelper);

    this.shadowHelper = new THREE.CameraHelper(this.sun.shadow.camera);
    this.shadowHelper.visible = false;
    this.scene.add(this.shadowHelper);

    const ambient = new THREE.AmbientLight();
    ambient.intensity = 0.2;
    this.scene.add(ambient);

    this.world = new World(0, this.scene);
    this.scene.add(this.world);

    this.player = new Player(this.scene);
    this.physics = new Physics(this.scene);

    this.updateSunPosition(0);

    createUI(
      this.world,
      this.player,
      this.physics,
      this.scene,
      this.renderer,
      this.sunSettings,
      this.sunHelper,
      this.shadowHelper
    );

    this.draw();
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
        this.world.removeBlock(
          Math.ceil(this.player.selectedCoords.x - 0.5),
          Math.ceil(this.player.selectedCoords.y - 0.5),
          Math.ceil(this.player.selectedCoords.z - 0.5)
        );
      } else if (event.button === 2 && this.player.blockPlacementCoords) {
        // console.log("adding block", this.player.activeBlockId);
        if (this.player.activeBlockId != null) {
          const playerPos = new THREE.Vector3(
            Math.floor(this.player.position.x),
            Math.floor(this.player.position.y) - 1,
            Math.floor(this.player.position.z)
          );
          const blockPos = new THREE.Vector3(
            Math.floor(this.player.blockPlacementCoords.x - 0.5),
            Math.floor(this.player.blockPlacementCoords.y - 0.5),
            Math.floor(this.player.blockPlacementCoords.z - 0.5)
          );

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
  }

  onWindowResize() {
    this.orbitCamera.aspect = window.innerWidth / window.innerHeight;
    this.orbitCamera.updateProjectionMatrix();
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

    // Desaturate the fog slightly
    this.scene.fog?.color.copy(topColor).multiplyScalar(0.2);

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

  updateSunPosition(angle: number) {
    const sunX = this.sunSettings.distance * Math.cos(angle); // Calculate the X position of the sun
    const sunY = this.sunSettings.distance * Math.sin(angle); // Calculate the Y position of the sun
    this.sun.position.set(sunX, sunY, this.player.camera.position.z); // Update the position of the sun
    this.sun.position.add(this.player.camera.position);

    this.sun.target.position.copy(this.player.camera.position);
    this.sun.target.updateMatrixWorld();

    this.sunHelper.update();
    this.shadowHelper.update();
  }

  draw() {
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.previousTime) / 1000;

    requestAnimationFrame(() => {
      this.draw();
    });

    this.updateSkyColor();

    this.physics.update(deltaTime, this.player, this.world);
    this.world.update(this.player);

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

    // if (this.controls) {
    //   this.controls.autoRotate = false;
    //   this.controls.autoRotateSpeed = 2.0;
    // }

    if (this.stats) this.stats.update();

    if (this.controls) this.controls.update();

    TWEEN.update();

    this.renderer.render(
      this.scene,
      this.player.controls.isLocked ? this.player.camera : this.orbitCamera
    );

    this.previousTime = currentTime;
  }
}
