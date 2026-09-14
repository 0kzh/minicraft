import * as THREE from "three";

const vertexShader = /* glsl */ `
  in float aLayer;
  in float aFlags;

  out vec2 vUv;
  out float vLayer;
  out float vShade;
  out float vEmissive;

  #include <fog_pars_vertex>

  // Per-face directional shading: +X, -X, +Y, -Y, +Z, -Z
  const float FACE_SHADE[6] = float[6](0.8, 0.8, 1.0, 0.5, 0.6, 0.6);

  void main() {
    vUv = uv;
    vLayer = aLayer;
    int flags = int(aFlags + 0.5);
    vShade = FACE_SHADE[flags & 7];
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
  uniform float uAmbient;
  uniform bool uWireframe;

  in vec2 vUv;
  in float vLayer;
  in float vShade;
  in float vEmissive;

  #include <fog_pars_fragment>

  void main() {
    vec4 texel = uWireframe
      ? vec4(1.0)
      : texture(uAtlas, vec3(vUv, vLayer));
    #ifdef CUTOUT
      if (texel.a < 0.5) discard;
    #endif

    float light = max(uAmbient, uSunLight) * vShade;
    light = max(light, vEmissive);
    gl_FragColor = vec4(texel.rgb * light, 1.0);

    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

export type ChunkUniforms = {
  uAtlas: THREE.IUniform<THREE.DataArrayTexture | null>;
  uSunLight: THREE.IUniform<number>;
  uAmbient: THREE.IUniform<number>;
  uWireframe: THREE.IUniform<boolean>;
};

/**
 * Materials shared by every chunk mesh: one for opaque cubes, one for
 * alpha-tested cutouts (leaves, plants). Both sample the block texture array.
 */
export class ChunkMaterials {
  readonly uniforms: ChunkUniforms;
  readonly opaque: THREE.ShaderMaterial;
  readonly cutout: THREE.ShaderMaterial;

  constructor(atlas: THREE.DataArrayTexture) {
    this.uniforms = {
      uAtlas: { value: atlas },
      uSunLight: { value: 1 },
      uAmbient: { value: 0.25 },
      uWireframe: { value: false },
    };

    const make = (cutout: boolean) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          this.uniforms,
        ]),
        defines: cutout ? { CUTOUT: "" } : {},
        fog: true,
        side: cutout ? THREE.DoubleSide : THREE.FrontSide,
      });

    this.opaque = make(false);
    this.cutout = make(true);

    // UniformsUtils.merge clones values; re-point both materials at the shared uniform objects
    for (const material of [this.opaque, this.cutout]) {
      for (const key of Object.keys(this.uniforms) as (keyof ChunkUniforms)[]) {
        material.uniforms[key] = this.uniforms[key];
      }
    }
  }

  set sunLight(value: number) {
    this.uniforms.uSunLight.value = value;
  }

  set wireframe(value: boolean) {
    this.uniforms.uWireframe.value = value;
    this.opaque.wireframe = value;
    this.cutout.wireframe = value;
  }
}
