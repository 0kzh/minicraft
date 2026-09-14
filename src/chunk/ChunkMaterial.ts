import * as THREE from "three";

import { BlockTextures } from "../Block/textures";

import { UV_SCALE } from "./mesher";

/** Max animated texture layers the shader cycles */
const MAX_ANIMATIONS = 4;

const vertexShader = /* glsl */ `
  in float aLayer;
  in float aFlags;
  in vec2 aLight;

  out vec2 vUv;
  out float vLayer;
  out float vShade;
  out float vEmissive;
  out vec2 vLight;
  out vec3 vViewPos;
  out vec3 vWorldPos;

  uniform float uTime;
  // (base layer, first frame layer, frame count, fps) per animated texture
  uniform vec4 uAnim[MAX_ANIMATIONS];

  // Per-face directional shading: +X, -X, +Y, -Y, +Z, -Z
  const float FACE_SHADE[6] = float[6](0.6, 0.6, 1.0, 0.5, 0.8, 0.8);

  void main() {
    vUv = uv / UV_SCALE;
    vLayer = aLayer;
    for (int i = 0; i < MAX_ANIMATIONS; i++) {
      if (uAnim[i].z > 0.0 && abs(aLayer - uAnim[i].x) < 0.5) {
        float frame = mod(floor(uTime * uAnim[i].w), uAnim[i].z);
        vLayer = uAnim[i].y + frame;
      }
    }
    vLight = aLight;
    int flags = int(aFlags + 0.5);
    // Ambient occlusion: 0..3 -> 0.4..1.0
    float ao = 0.4 + float((flags >> 4) & 3) * 0.2;
    vShade = FACE_SHADE[flags & 7] * ao;
    vEmissive = float((flags >> 3) & 1);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPosition.xyz;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor

  uniform sampler2DArray uAtlas;
  uniform float uSunLight;
  uniform bool uWireframe;
  uniform float uAlpha;
  uniform vec3 uFogColor;
  // x: start distance, y: end distance, z: 1 = cylindrical (horizontal
  // distance, so terrain fades at the render distance regardless of height),
  // 0 = spherical (underwater)
  uniform vec3 uFog;

  in vec2 vUv;
  in float vLayer;
  in float vShade;
  in float vEmissive;
  in vec2 vLight;
  in vec3 vViewPos;
  in vec3 vWorldPos;

  // Minecraft's light-level brightness curve: 0 -> 0, 0.5 -> 0.2, 1 -> 1
  float brightness(float level) {
    return level / (4.0 - 3.0 * level);
  }

  // Day/night lightmap: cool sky light scaled by the sun, warm block light
  vec3 lightmap(float sky, float block) {
    float skyB = brightness(sky) * (uSunLight * 0.8 + 0.2);
    float blockB = brightness(block);
    vec3 skyColor = mix(vec3(0.45, 0.55, 1.0), vec3(1.0), uSunLight);
    vec3 blockColor = vec3(1.0, blockB * 0.6 + 0.4, blockB * blockB * 0.6 + 0.4);
    vec3 c = skyB * skyColor + blockB * blockColor;
    return clamp(c, 0.0, 1.0) * 0.96 + 0.03;
  }

  void main() {
    vec4 texel = uWireframe
      ? vec4(1.0)
      : texture(uAtlas, vec3(vUv, vLayer));
    #ifdef CUTOUT
      if (texel.a < 0.5) discard;
    #endif

    vec3 light = lightmap(vLight.x, vLight.y) * vShade;
    light = max(light, vec3(vEmissive));
    #ifdef TRANSLUCENT
      // Emissive liquids (lava) render solid
      gl_FragColor = vec4(texel.rgb * light, mix(uAlpha, 1.0, vEmissive));
    #else
      gl_FragColor = vec4(texel.rgb * light, 1.0);
    #endif

    float dist = mix(
      length(vViewPos),
      length(vWorldPos.xz - cameraPosition.xz),
      uFog.z
    );
    float fog = smoothstep(uFog.x, uFog.y, dist);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fog);
    #include <colorspace_fragment>
  }
`;

export type ChunkUniforms = {
  uAtlas: THREE.IUniform<THREE.DataArrayTexture | null>;
  uSunLight: THREE.IUniform<number>;
  uWireframe: THREE.IUniform<boolean>;
  uTime: THREE.IUniform<number>;
  uAlpha: THREE.IUniform<number>;
  uAnim: THREE.IUniform<THREE.Vector4[]>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFog: THREE.IUniform<THREE.Vector3>;
};

type Variant = "opaque" | "cutout" | "translucent";

/**
 * Materials shared by every chunk mesh: opaque cubes, alpha-tested cutouts
 * (leaves, plants) and alpha-blended translucents (water, lava). All sample
 * the block texture array.
 */
export class ChunkMaterials {
  readonly uniforms: ChunkUniforms;
  readonly opaque: THREE.ShaderMaterial;
  readonly cutout: THREE.ShaderMaterial;
  readonly translucent: THREE.ShaderMaterial;

  constructor(textures: BlockTextures) {
    const anim = Array.from({ length: MAX_ANIMATIONS }, (_, i) => {
      const a = textures.animations[i];
      return a
        ? new THREE.Vector4(a.layer, a.first, a.frames, a.fps)
        : new THREE.Vector4(-1, 0, 0, 0);
    });
    this.uniforms = {
      uAtlas: { value: textures.array },
      uSunLight: { value: 1 },
      uWireframe: { value: false },
      uTime: { value: 0 },
      uAlpha: { value: 0.72 },
      uAnim: { value: anim },
      uFogColor: { value: new THREE.Color(0xc0d8ff) },
      uFog: { value: new THREE.Vector3(80, 124, 1) },
    };

    const make = (variant: Variant) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        // Shared uniform objects so one update drives every layer
        uniforms: { ...this.uniforms },
        defines: {
          MAX_ANIMATIONS,
          UV_SCALE: UV_SCALE.toFixed(1),
          ...(variant === "cutout"
            ? { CUTOUT: "" }
            : variant === "translucent"
            ? { TRANSLUCENT: "" }
            : {}),
        },
        side: variant === "opaque" ? THREE.FrontSide : THREE.DoubleSide,
        transparent: variant === "translucent",
        depthWrite: true,
      });

    this.opaque = make("opaque");
    this.cutout = make("cutout");
    this.translucent = make("translucent");
  }

  private get all() {
    return [this.opaque, this.cutout, this.translucent];
  }

  set sunLight(value: number) {
    this.uniforms.uSunLight.value = value;
  }

  /** Distance fog: colour, start/end in blocks, cylindrical or spherical */
  setFog(color: THREE.Color, start: number, end: number, cylindrical: boolean) {
    this.uniforms.uFogColor.value.copy(color);
    this.uniforms.uFog.value.set(start, end, cylindrical ? 1 : 0);
  }

  /** Elapsed seconds, drives liquid animation */
  set time(value: number) {
    this.uniforms.uTime.value = value;
  }

  set wireframe(value: boolean) {
    this.uniforms.uWireframe.value = value;
    for (const material of this.all) material.wireframe = value;
  }
}
