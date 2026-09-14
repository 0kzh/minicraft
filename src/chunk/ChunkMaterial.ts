import * as THREE from "three";

const vertexShader = /* glsl */ `
  in float aLayer;
  in float aFlags;
  in vec2 aLight;

  out vec2 vUv;
  out float vLayer;
  out float vShade;
  out float vEmissive;
  out vec2 vLight;

  uniform float uTime;

  #include <fog_pars_vertex>

  // Per-face directional shading: +X, -X, +Y, -Y, +Z, -Z
  const float FACE_SHADE[6] = float[6](0.6, 0.6, 1.0, 0.5, 0.8, 0.8);

  void main() {
    vUv = uv;
    #ifdef TRANSLUCENT
      // Slow drift of the liquid texture
      vUv += vec2(uTime * 0.04, uTime * 0.025);
    #endif
    vLayer = aLayer;
    vLight = aLight;
    int flags = int(aFlags + 0.5);
    // Ambient occlusion: 0..3 -> 0.4..1.0
    float ao = 0.4 + float((flags >> 4) & 3) * 0.2;
    vShade = FACE_SHADE[flags & 7] * ao;
    vEmissive = float((flags >> 3) & 1);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor

  uniform sampler2DArray uAtlas;
  uniform float uSunLight;
  uniform bool uWireframe;
  uniform float uAlpha;

  in vec2 vUv;
  in float vLayer;
  in float vShade;
  in float vEmissive;
  in vec2 vLight;

  #include <fog_pars_fragment>

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

    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

export type ChunkUniforms = {
  uAtlas: THREE.IUniform<THREE.DataArrayTexture | null>;
  uSunLight: THREE.IUniform<number>;
  uWireframe: THREE.IUniform<boolean>;
  uTime: THREE.IUniform<number>;
  uAlpha: THREE.IUniform<number>;
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

  constructor(atlas: THREE.DataArrayTexture) {
    this.uniforms = {
      uAtlas: { value: atlas },
      uSunLight: { value: 1 },
      uWireframe: { value: false },
      uTime: { value: 0 },
      uAlpha: { value: 0.72 },
    };

    const make = (variant: Variant) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          this.uniforms,
        ]),
        defines:
          variant === "cutout"
            ? { CUTOUT: "" }
            : variant === "translucent"
            ? { TRANSLUCENT: "" }
            : {},
        fog: true,
        side: variant === "opaque" ? THREE.FrontSide : THREE.DoubleSide,
        transparent: variant === "translucent",
        depthWrite: true,
      });

    this.opaque = make("opaque");
    this.cutout = make("cutout");
    this.translucent = make("translucent");

    // UniformsUtils.merge clones values; re-point the materials at the shared uniform objects
    for (const material of this.all) {
      for (const key of Object.keys(this.uniforms) as (keyof ChunkUniforms)[]) {
        material.uniforms[key] = this.uniforms[key];
      }
    }
  }

  private get all() {
    return [this.opaque, this.cutout, this.translucent];
  }

  set sunLight(value: number) {
    this.uniforms.uSunLight.value = value;
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
