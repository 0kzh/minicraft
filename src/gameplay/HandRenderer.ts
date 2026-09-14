import * as THREE from "three";

import { BlockID } from "../Block";
import { getBlockDef, RenderGeometry } from "../Block/blocks";
import { BlockTextures } from "../Block/textures";
import { Physics } from "../Physics";
import { Player } from "../Player";

/** Vanilla first-person hand FOV (`GameRenderer.getFov(…, false)`) */
const HAND_FOV = 70;
const DEG = Math.PI / 180;

/** Steve skin: right arm cube at (40, 16), 4x12x4 pixels on a 64x64 sheet */
const SKIN_SIZE = 64;
const ARM_UV = { u: 40, v: 16, w: 4, h: 12, d: 4 };

/** Same per-face shade as the chunk shader: +X, -X, +Y, -Y, +Z, -Z */
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];

const itemVertexShader = /* glsl */ `
  in float aLayer;
  in float aShade;
  out vec2 vUv;
  out float vLayer;
  out float vShade;
  void main() {
    vUv = uv;
    vLayer = aLayer;
    vShade = aShade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const itemFragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform sampler2DArray uAtlas;
  uniform vec3 uLight;
  in vec2 vUv;
  in float vLayer;
  in float vShade;
  void main() {
    vec4 texel = texture(uAtlas, vec3(vUv, vLayer));
    if (texel.a < 0.5) discard;
    gl_FragColor = vec4(texel.rgb * uLight * vShade, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * First-person arm / held block, drawn in its own pass over the world like
 * vanilla `ItemInHandRenderer`. Transforms follow the 1.8 `ItemRenderer`
 * (`renderPlayerArm` / `transformFirstPersonItem`); the held block's own
 * display transform is approximated as a centred 0.4-scale cube.
 */
export class HandRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(HAND_FOV, 1, 0.05, 20);
  private readonly arm: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly item: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly light = new THREE.Vector3(1, 1, 1);

  /** Vanilla `equippedProgress`: 1 = fully raised, dips to 0 on item change */
  private equipProgress = 1;
  private prevEquipProgress = 1;
  private renderedBlock: BlockID | null = null;
  private tickAccumulator = 0;

  constructor(textures: BlockTextures) {
    const skin = new THREE.TextureLoader().load("entity/steve.png");
    skin.magFilter = THREE.NearestFilter;
    skin.minFilter = THREE.NearestFilter;
    skin.colorSpace = THREE.SRGBColorSpace;
    const armGeometry = new THREE.BoxGeometry(
      ARM_UV.w / 16,
      ARM_UV.h / 16,
      ARM_UV.d / 16
    );
    HandRenderer.applySkinUVs(armGeometry);
    this.arm = new THREE.Mesh(
      armGeometry,
      new THREE.MeshBasicMaterial({ map: skin })
    );
    this.arm.matrixAutoUpdate = false;
    this.scene.add(this.arm);

    this.item = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: itemVertexShader,
        fragmentShader: itemFragmentShader,
        uniforms: {
          uAtlas: { value: textures.array },
          uLight: { value: this.light },
        },
        side: THREE.DoubleSide,
      })
    );
    this.item.matrixAutoUpdate = false;
    this.item.visible = false;
    this.scene.add(this.item);
  }

  /** Maps a box's six faces onto the skin's cube layout (top/bottom/sides) */
  private static applySkinUVs(geometry: THREE.BoxGeometry) {
    const { u, v, w, h, d } = ARM_UV;
    // Box face order in three: +X, -X, +Y, -Y, +Z, -Z. The model is y-down
    // like vanilla's `ModelPart`, so +Y is the hand end (skin "bottom"
    // region) and the side regions run top-to-bottom along -Y..+Y.
    const regions: [number, number, number, number][] = [
      [u, v + d, d, h],
      [u + d + w, v + d, d, h],
      [u + d + w, v, w, d],
      [u + d, v, w, d],
      [u + d, v + d, w, h],
      [u + d + w + d, v + d, w, h],
    ];
    const uv = geometry.attributes.uv;
    regions.forEach(([x, y, rw, rh], face) => {
      const corners = [
        [x, y + rh],
        [x + rw, y + rh],
        [x, y],
        [x + rw, y],
      ];
      corners.forEach(([cx, cy], i) => {
        uv.setXY(face * 4 + i, cx / SKIN_SIZE, 1 - cy / SKIN_SIZE);
      });
    });
    uv.needsUpdate = true;
  }

  private buildItem(id: BlockID) {
    const def = getBlockDef(id);
    const positions: number[] = [];
    const uvs: number[] = [];
    const layers: number[] = [];
    const shades: number[] = [];
    const indices: number[] = [];

    const quad = (
      corners: [number, number, number][],
      layer: number,
      shade: number
    ) => {
      const base = positions.length / 3;
      corners.forEach(([x, y, z], i) => {
        positions.push(x, y, z);
        uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 0 : 1);
        layers.push(layer);
        shades.push(shade);
      });
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    if (def.geometry === RenderGeometry.Cross) {
      const layer = def.faces[0];
      quad(
        [
          [0, 1, 0],
          [1, 1, 1],
          [1, 0, 1],
          [0, 0, 0],
        ],
        layer,
        1
      );
      quad(
        [
          [1, 1, 0],
          [0, 1, 1],
          [0, 0, 1],
          [1, 0, 0],
        ],
        layer,
        1
      );
    } else {
      const [x0, y0, z0, x1, y1, z1] = def.box;
      const faces: [number, number, number][][] = [
        [
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
          [x1, y0, z0],
        ],
        [
          [x0, y1, z1],
          [x0, y1, z0],
          [x0, y0, z0],
          [x0, y0, z1],
        ],
        [
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y0, z0],
          [x0, y0, z0],
        ],
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        [
          [x1, y1, z0],
          [x0, y1, z0],
          [x0, y0, z0],
          [x1, y0, z0],
        ],
      ];
      faces.forEach((corners, f) => quad(corners, def.faces[f], FACE_SHADE[f]));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute(
      "aLayer",
      new THREE.Float32BufferAttribute(layers, 1)
    );
    geometry.setAttribute(
      "aShade",
      new THREE.Float32BufferAttribute(shades, 1)
    );
    geometry.setIndex(indices);
    geometry.translate(-0.5, -0.5, -0.5);
    this.item.geometry.dispose();
    this.item.geometry = geometry;
  }

  /** Vanilla `ItemInHandRenderer.tick`: the hand dips and re-raises on item change */
  private tick(held: BlockID | null) {
    this.prevEquipProgress = this.equipProgress;
    const target = held === this.renderedBlock ? 1 : 0;
    this.equipProgress += THREE.MathUtils.clamp(
      target - this.equipProgress,
      -0.4,
      0.4
    );
    if (this.equipProgress < 0.1 && held !== this.renderedBlock) {
      this.renderedBlock = held;
      if (held !== null) this.buildItem(held);
    }
  }

  /**
   * Light on the hand: the chunk lightmap at the eye, approximated from the
   * sun and whether the sky is visible above the player.
   */
  setLight(daylight: number, skyVisible: boolean) {
    const sky = skyVisible ? 1 : 0.35;
    const skyB = (sky / (4 - 3 * sky)) * (daylight * 0.8 + 0.2);
    const skyColor = new THREE.Color(0.45, 0.55, 1).lerp(
      new THREE.Color(1, 1, 1),
      daylight
    );
    this.light.set(
      Math.min(1, skyB * skyColor.r) * 0.96 + 0.03,
      Math.min(1, skyB * skyColor.g) * 0.96 + 0.03,
      Math.min(1, skyB * skyColor.b) * 0.96 + 0.03
    );
    this.arm.material.color.setRGB(this.light.x, this.light.y, this.light.z);
  }

  /** Compiles both hand programs so the first swing doesn't hitch */
  precompile(renderer: THREE.WebGLRenderer) {
    this.buildItem(BlockID.Stone);
    this.item.visible = true;
    renderer.compile(this.scene, this.camera);
    this.item.visible = false;
  }

  update(dt: number, player: Player) {
    this.tickAccumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    while (this.tickAccumulator >= Physics.TICK) {
      this.tickAccumulator -= Physics.TICK;
      this.tick(player.activeBlockId);
    }
  }

  render(renderer: THREE.WebGLRenderer, player: Player, alpha: number) {
    const partial = this.tickAccumulator / Physics.TICK;
    const equip = THREE.MathUtils.lerp(
      this.prevEquipProgress,
      this.equipProgress,
      partial
    );
    const f = 1 - equip;
    const swing = player.swingProgress(alpha);
    const held = this.renderedBlock;

    const m = new THREE.Matrix4();
    const t = new THREE.Matrix4();
    const translate = (x: number, y: number, z: number) =>
      m.multiply(t.makeTranslation(x, y, z));
    const rotateX = (deg: number) => m.multiply(t.makeRotationX(deg * DEG));
    const rotateY = (deg: number) => m.multiply(t.makeRotationY(deg * DEG));
    const rotateZ = (deg: number) => m.multiply(t.makeRotationZ(deg * DEG));

    if (held !== null) {
      const sq = Math.sqrt(swing);
      translate(
        -0.4 * Math.sin(sq * Math.PI),
        0.2 * Math.sin(sq * Math.PI * 2),
        -0.2 * Math.sin(swing * Math.PI)
      );
      // transformFirstPersonItem
      translate(0.56, -0.52, -0.72);
      translate(0, f * -0.6, 0);
      rotateY(45);
      const f1 = Math.sin(swing * swing * Math.PI);
      const f2 = Math.sin(sq * Math.PI);
      rotateY(f1 * -20);
      rotateZ(f2 * -20);
      rotateX(f2 * -80);
      m.multiply(t.makeScale(0.4, 0.4, 0.4));
      this.item.matrix.copy(m);
      this.item.visible = true;
      this.arm.visible = false;
    } else {
      // renderPlayerArm
      const sq = Math.sqrt(swing);
      translate(
        -0.3 * Math.sin(sq * Math.PI),
        0.4 * Math.sin(sq * Math.PI * 2),
        -0.4 * Math.sin(swing * Math.PI)
      );
      translate(0.64, -0.6, -0.72);
      translate(0, f * -0.6, 0);
      rotateY(45);
      const f4 = Math.sin(swing * swing * Math.PI);
      const f5 = Math.sin(sq * Math.PI);
      rotateY(f5 * 70);
      rotateZ(f4 * -20);
      translate(-1, 3.6, 3.5);
      rotateZ(120);
      rotateX(200);
      rotateY(-135);
      translate(5.6, 0, 0);
      // ModelPlayer right arm: pivot (-5, 2, 0), box (-3, -2, -2) 4x12x4, y down
      translate(-5 / 16, 2 / 16, 0);
      translate(-1 / 16, 4 / 16, 0);
      this.arm.matrix.copy(m);
      this.arm.visible = true;
      this.item.visible = false;
    }

    const { width, height } = renderer.getSize(new THREE.Vector2());
    const aspect = width / height;
    let fov = HAND_FOV;
    if (player.eyeSubmerged) fov *= 60 / 70;
    if (this.camera.aspect !== aspect || this.camera.fov !== fov) {
      this.camera.aspect = aspect;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
