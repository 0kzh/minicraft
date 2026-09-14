import * as THREE from "three";

import { BlockID } from "../Block";
import { getBlockDef } from "../Block/blocks";
import { BlockTextures } from "../Block/textures";
import { Physics } from "../Physics";
import { World } from "../World";

const MAX_PARTICLES = 2048;
/** Fraction of a block texture each particle shows (a 4x4 texel patch) */
const PATCH = 0.25;

const vertexShader = /* glsl */ `
  in vec3 aUv;
  in vec2 aExtra;
  out vec3 vUv;
  out float vLight;
  out float vDist;
  uniform float uScale;

  void main() {
    vUv = aUv;
    vLight = aExtra.y;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDist = length(mvPosition.xyz);
    gl_PointSize = aExtra.x * uScale / max(-mvPosition.z, 0.01);
    gl_Position = projectionMatrix * mvPosition;
    if (aExtra.x <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform sampler2DArray uAtlas;
  uniform float uSunLight;
  uniform vec3 uFogColor;
  uniform vec3 uFog;
  in vec3 vUv;
  in float vLight;
  in float vDist;

  void main() {
    vec2 uv = vUv.xy + vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * PATCH;
    vec4 texel = texture(uAtlas, vec3(uv, vUv.z));
    if (texel.a < 0.5) discard;
    float light = (0.35 + 0.65 * vLight) * (uSunLight * 0.8 + 0.2);
    vec3 c = texel.rgb * light;
    c = mix(c, uFogColor, smoothstep(uFog.x, uFog.y, vDist));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Remaining life in ticks */
  life: number;
};

/**
 * Minecraft-style block-crack particles: small textured points cut from a
 * random patch of the block's texture, thrown out with a little upward kick,
 * pulled down by gravity and settling on solid blocks.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly uvs = new Float32Array(MAX_PARTICLES * 3);
  private readonly extra = new Float32Array(MAX_PARTICLES * 2);
  private readonly particles: (Particle | null)[] = new Array(
    MAX_PARTICLES
  ).fill(null);
  private next = 0;
  private accumulator = 0;
  private readonly uniforms: {
    uAtlas: THREE.IUniform<THREE.DataArrayTexture>;
    uScale: THREE.IUniform<number>;
    uSunLight: THREE.IUniform<number>;
    uFogColor: THREE.IUniform<THREE.Color>;
    uFog: THREE.IUniform<THREE.Vector3>;
  };

  constructor(textures: BlockTextures, private readonly world: World) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3)
    );
    geometry.setAttribute("aUv", new THREE.BufferAttribute(this.uvs, 3));
    geometry.setAttribute("aExtra", new THREE.BufferAttribute(this.extra, 2));
    this.uniforms = {
      uAtlas: { value: textures.array },
      uScale: { value: 1 },
      uSunLight: { value: 1 },
      uFogColor: { value: new THREE.Color() },
      uFog: { value: new THREE.Vector3(80, 124, 0) },
    };
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      defines: { PATCH: PATCH.toFixed(2) },
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
  }

  /** Bursts particles across the volume of a broken block (vanilla: 4x4x4) */
  burst(x: number, y: number, z: number, id: BlockID) {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++) {
          const px = x + (i + 0.5) / 4;
          const py = y + (j + 0.5) / 4;
          const pz = z + (k + 0.5) / 4;
          this.spawn(px, py, pz, px - x - 0.5, py - y - 0.5, pz - z - 0.5, id);
        }
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    id: BlockID
  ) {
    const def = getBlockDef(id);
    const rand = () => Math.random() * 2 - 1;
    let vx = dx + rand() * 0.4;
    let vy = dy + rand() * 0.4;
    let vz = dz + rand() * 0.4;
    const len = Math.hypot(vx, vy, vz) || 1;
    const speed = (Math.random() + Math.random() + 1) * 0.15 * 0.4;
    vx = (vx / len) * speed;
    vy = (vy / len) * speed + 0.1;
    vz = (vz / len) * speed;

    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.particles[i] = {
      x,
      y,
      z,
      vx,
      vy,
      vz,
      life: Math.floor(4 / (Math.random() * 0.9 + 0.1)),
    };
    // Faces: +X, -X, +Y, -Y, +Z, -Z; particles use the side texture
    this.uvs[i * 3] = Math.floor(Math.random() * 4) * PATCH * 0.75;
    this.uvs[i * 3 + 1] = Math.floor(Math.random() * 4) * PATCH * 0.75;
    this.uvs[i * 3 + 2] = def.faces[0];
    this.extra[i * 2] = 0.2 * (Math.random() * 0.5 + 0.5);
    this.extra[i * 2 + 1] = this.skyExposure(x, y, z);
    this.write(i);
  }

  /** 1 when open to the sky, otherwise dimmed like a cave */
  private skyExposure(x: number, y: number, z: number) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let by = Math.floor(y) + 1; by < this.world.chunkSize.height; by++) {
      const id = this.world.getBlock(bx, by, bz);
      if (id !== undefined && getBlockDef(id).opaque) return 0.3;
    }
    return 1;
  }

  private write(i: number) {
    const p = this.particles[i];
    if (p) {
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
    } else {
      this.extra[i * 2] = 0;
    }
  }

  setLighting(
    sunLight: number,
    fogColor: THREE.Color,
    fogStart: number,
    fogEnd: number
  ) {
    this.uniforms.uSunLight.value = sunLight;
    this.uniforms.uFogColor.value.copy(fogColor);
    this.uniforms.uFog.value.set(fogStart, fogEnd, 0);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, pixelRatio: number) {
    const fov = THREE.MathUtils.degToRad(camera.fov);
    this.uniforms.uScale.value =
      (window.innerHeight * pixelRatio) / (2 * Math.tan(fov / 2));

    this.accumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    let ticks = 0;
    while (this.accumulator >= Physics.TICK) {
      this.accumulator -= Physics.TICK;
      ticks++;
    }
    if (ticks === 0) return;

    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p) continue;
      any = true;
      for (let t = 0; t < ticks && this.particles[i]; t++) this.tick(i, p);
      this.write(i);
    }
    if (!any) return;
    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aUv.needsUpdate = true;
    geometry.attributes.aExtra.needsUpdate = true;
  }

  private tick(i: number, p: Particle) {
    if (--p.life <= 0) {
      this.particles[i] = null;
      return;
    }
    p.vy -= 0.04;
    const size = this.extra[i * 2] / 2;
    let onGround = false;

    // Axis by axis so chips slide along walls and settle on floors
    const nx = p.x + p.vx;
    if (this.solid(nx + Math.sign(p.vx) * size, p.y, p.z)) p.vx = 0;
    else p.x = nx;
    const nz = p.z + p.vz;
    if (this.solid(p.x, p.y, nz + Math.sign(p.vz) * size)) p.vz = 0;
    else p.z = nz;
    const ny = p.y + p.vy;
    if (this.solid(p.x, ny - size, p.z)) {
      if (p.vy < 0) {
        onGround = true;
        p.y = Math.floor(ny - size) + 1 + size;
      }
      p.vy = 0;
    } else {
      p.y = ny;
    }

    p.vx *= 0.98;
    p.vy *= 0.98;
    p.vz *= 0.98;
    if (onGround) {
      p.vx *= 0.7;
      p.vz *= 0.7;
    }
  }

  private solid(x: number, y: number, z: number) {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return id !== undefined && !getBlockDef(id).passable;
  }
}
