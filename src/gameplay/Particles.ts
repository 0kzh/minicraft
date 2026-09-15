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
  in vec3 iPosition;
  in vec3 iUv;
  in vec2 iExtra;
  out vec3 vUv;
  out float vLight;
  out float vDist;

  void main() {
    // Camera-facing quad like SingleQuadParticle: corners offset in view space
    vec4 mvPosition = modelViewMatrix * vec4(iPosition, 1.0);
    mvPosition.xy += position.xy * iExtra.x;
    vUv = vec3(iUv.xy + uv * PATCH, iUv.z);
    vLight = iExtra.y;
    vDist = length(mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
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
    vec4 texel = texture(uAtlas, vUv);
    if (texel.a < 0.5) discard;
    // TerrainParticle tints chips to 60% of the block colour
    float light = 0.6 * (0.35 + 0.65 * vLight) * (uSunLight * 0.8 + 0.2);
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
  /** Position at the previous tick, for render interpolation */
  px: number;
  py: number;
  pz: number;
  /** Remaining life in ticks */
  life: number;
};

/**
 * Vanilla `TerrainParticle`s: small camera-facing quads cut from a random
 * patch of the block's texture, thrown out with a little upward kick
 * (`Particle` constructor velocities), pulled down by gravity 0.04/tick with
 * 0.98 drag and settling on solid blocks; lifetime 4 / (rand * 0.9 + 0.1)
 * ticks. All particles share one instanced draw; live ones are kept packed
 * at the front of the buffers so only they are uploaded and drawn, with
 * positions interpolated between ticks each frame.
 */
export class Particles {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly uvs = new Float32Array(MAX_PARTICLES * 3);
  private readonly extra = new Float32Array(MAX_PARTICLES * 2);
  private readonly particles: Particle[] = [];
  private accumulator = 0;
  private readonly uniforms: {
    uAtlas: THREE.IUniform<THREE.DataArrayTexture>;
    uSunLight: THREE.IUniform<number>;
    uFogColor: THREE.IUniform<THREE.Color>;
    uFog: THREE.IUniform<THREE.Vector3>;
  };

  constructor(textures: BlockTextures, private readonly world: World) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute("position", quad.attributes.position);
    this.geometry.setAttribute("uv", quad.attributes.uv);
    for (const [name, array, size] of [
      ["iPosition", this.positions, 3],
      ["iUv", this.uvs, 3],
      ["iExtra", this.extra, 2],
    ] as const) {
      const attribute = new THREE.InstancedBufferAttribute(array, size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute);
    }
    this.geometry.instanceCount = 0;
    this.uniforms = {
      uAtlas: { value: textures.array },
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
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * `ParticleEngine.destroy`: fills the block's shape with chips on a grid of
   * max(2, ceil(extent / 0.25)) per axis (4x4x4 for a full cube), each thrown
   * away from the block centre
   */
  burst(x: number, y: number, z: number, id: BlockID) {
    const [x0, y0, z0, x1, y1, z1] = getBlockDef(id).box;
    const dx = Math.min(1, x1 - x0);
    const dy = Math.min(1, y1 - y0);
    const dz = Math.min(1, z1 - z0);
    const nx = Math.max(2, Math.ceil(dx / 0.25));
    const ny = Math.max(2, Math.ceil(dy / 0.25));
    const nz = Math.max(2, Math.ceil(dz / 0.25));
    const light = this.skyExposure(x, y, z);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++)
        for (let k = 0; k < nz; k++) {
          const px = ((i + 0.5) / nx) * dx + x0;
          const py = ((j + 0.5) / ny) * dy + y0;
          const pz = ((k + 0.5) / nz) * dz + z0;
          this.spawn(
            x + px,
            y + py,
            z + pz,
            px - 0.5,
            py - 0.5,
            pz - 0.5,
            id,
            light
          );
        }
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    id: BlockID,
    light: number
  ) {
    if (this.particles.length >= MAX_PARTICLES) return;
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

    const i = this.particles.length;
    this.particles.push({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      px: x,
      py: y,
      pz: z,
      life: Math.floor(4 / (Math.random() * 0.9 + 0.1)),
    });
    // TerrainParticle: a 4x4 texel patch at a random offset (uo = rand * 3) of
    // the side texture (faces: +X, -X, +Y, -Y, +Z, -Z)
    this.uvs[i * 3] = (Math.random() * 3) / 4;
    this.uvs[i * 3 + 1] = (Math.random() * 3) / 4;
    this.uvs[i * 3 + 2] = def.faces[0];
    // SingleQuadParticle quadSize 0.1 * (rand * 0.5 + 0.5) * 2, halved by
    // TerrainParticle, drawn as a quad of twice that half-extent
    this.extra[i * 2] = 0.2 * (Math.random() * 0.5 + 0.5);
    this.extra[i * 2 + 1] = light;
    this.write(i, 1);
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

  private write(i: number, alpha: number) {
    const p = this.particles[i];
    this.positions[i * 3] = p.px + (p.x - p.px) * alpha;
    this.positions[i * 3 + 1] = p.py + (p.y - p.py) * alpha;
    this.positions[i * 3 + 2] = p.pz + (p.z - p.pz) * alpha;
  }

  /** Swap-remove so live particles stay packed at the front */
  private kill(i: number) {
    const last = this.particles.length - 1;
    if (i !== last) {
      this.particles[i] = this.particles[last];
      this.uvs.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.extra.copyWithin(i * 2, last * 2, last * 2 + 2);
    }
    this.particles.pop();
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

  update(dt: number) {
    this.accumulator += Math.min(dt, Physics.MAX_FRAME_TIME);
    let ticks = 0;
    while (this.accumulator >= Physics.TICK) {
      this.accumulator -= Physics.TICK;
      ticks++;
    }
    const count = this.particles.length;
    if (count === 0) {
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return;
    }

    for (let t = 0; t < ticks; t++) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        if (--p.life <= 0) this.kill(i);
        else this.tick(i, p);
      }
    }
    const alpha = this.accumulator / Physics.TICK;
    for (let i = 0; i < this.particles.length; i++) this.write(i, alpha);
    this.upload();
  }

  private upload() {
    const count = this.particles.length;
    this.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    for (const [name, size] of [
      ["iPosition", 3],
      ["iUv", 3],
      ["iExtra", 2],
    ] as const) {
      const attribute = this.geometry.getAttribute(
        name
      ) as THREE.InstancedBufferAttribute;
      attribute.updateRange.offset = 0;
      attribute.updateRange.count = count * size;
      attribute.needsUpdate = true;
    }
  }

  private tick(i: number, p: Particle) {
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
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
