import * as THREE from "three";

/** Blocks per cloud texel and cloud thickness (`LevelRenderer.buildClouds`) */
const CELL = 12;
const THICKNESS = 4;
/** Texels per side of clouds.png; the pattern repeats every CELL * SIZE blocks */
const SIZE = 256;
const PERIOD = CELL * SIZE;
/** Blocks per tick the clouds drift towards -X (`renderClouds`: ticks * 0.03) */
const DRIFT = 0.03 * 20;
/**
 * Overworld `cloud_height` is 192 in a 320-tall world; for this 128-tall
 * world the clouds sit at the pre-1.18 height instead
 */
export const CLOUD_HEIGHT = 128;
/** Face shades from `buildClouds`: top, bottom, x sides, z sides */
const SHADE_TOP = 1.0;
const SHADE_BOTTOM = 0.7;
const SHADE_X = 0.9;
const SHADE_Z = 0.8;

const vertexShader = /* glsl */ `
  attribute float shade;
  varying float vShade;
  varying vec3 vWorldPos;
  void main() {
    vShade = shade;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  uniform vec2 uFog;
  varying float vShade;
  varying vec3 vWorldPos;
  void main() {
    float dist = length(vWorldPos.xz - cameraPosition.xz);
    float fog = smoothstep(uFog.x, uFog.y, dist);
    vec3 c = mix(uColor * vShade, uFogColor, fog);
    // RenderType.clouds draws at alpha 0.8
    gl_FragColor = vec4(c, 0.8 * (1.0 - fog));
    #include <colorspace_fragment>
  }
`;

/**
 * Vanilla "fancy" clouds: every opaque texel of clouds.png is a 12x12x4 block
 * slab at the cloud height, with only the exposed sides built. The whole
 * 256x256 pattern is one mesh, drawn on the four tiles nearest the camera so
 * it wraps seamlessly while it drifts.
 */
export class Clouds {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly tiles: THREE.Mesh[] = [];
  private readonly uniforms = {
    uColor: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color() },
    uFog: { value: new THREE.Vector2(200, 400) },
  };

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.group.renderOrder = 1;
    new THREE.ImageLoader().load("/textures/environment/clouds.png", (img) =>
      this.build(img)
    );
  }

  private build(img: HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const solid = (x: number, z: number) =>
      data[(((z + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4 + 3] > 0;

    const pos: number[] = [];
    const shade: number[] = [];
    const idx: number[] = [];
    const quad = (
      a: number[],
      b: number[],
      c: number[],
      d: number[],
      s: number
    ) => {
      const base = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      shade.push(s, s, s, s);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (!solid(x, z)) continue;
        const x0 = x * CELL;
        const x1 = x0 + CELL;
        const z0 = z * CELL;
        const z1 = z0 + CELL;
        const y0 = 0;
        const y1 = THICKNESS;
        quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], SHADE_TOP);
        quad(
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
          SHADE_BOTTOM
        );
        if (!solid(x - 1, z))
          quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], SHADE_X);
        if (!solid(x + 1, z))
          quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], SHADE_X);
        if (!solid(x, z - 1))
          quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], SHADE_Z);
        if (!solid(x, z + 1))
          quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], SHADE_Z);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("shade", new THREE.Float32BufferAttribute(shade, 1));
    geometry.setIndex(idx);
    geometry.computeBoundingSphere();

    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.renderOrder = 1;
      this.tiles.push(mesh);
      this.group.add(mesh);
    }
  }

  setFog(color: THREE.Color, start: number, end: number) {
    this.uniforms.uFogColor.value.copy(color);
    this.uniforms.uFog.value.set(start, end);
  }

  /**
   * @param timeOfDay fraction of the day from noon (0 = noon, 0.5 = midnight)
   */
  update(time: number, timeOfDay: number, camera: THREE.Vector3) {
    // ClientLevel.getCloudColor: brightness from the sun angle, blue-tinted
    const f = THREE.MathUtils.clamp(
      Math.cos(timeOfDay * 2 * Math.PI) * 2 + 0.5,
      0,
      1
    );
    this.uniforms.uColor.value.setRGB(
      f * 0.9 + 0.1,
      f * 0.9 + 0.1,
      f * 0.85 + 0.15
    );

    // The pattern slides towards -X; snap the tile grid around the camera so
    // the nearest four tiles always cover everything in view
    const originX = -time * DRIFT;
    const tx = Math.floor((camera.x - originX) / PERIOD - 0.5);
    const tz = Math.floor(camera.z / PERIOD - 0.5);
    this.tiles.forEach((tile, i) => {
      tile.position.set(
        originX + (tx + (i & 1)) * PERIOD,
        CLOUD_HEIGHT,
        (tz + (i >> 1)) * PERIOD
      );
    });
  }
}
