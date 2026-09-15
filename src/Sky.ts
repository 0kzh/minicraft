import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Always behind everything else
    gl_Position.z = gl_Position.w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uVoid;
  uniform vec3 uSunDir;
  // LevelRenderer.getStarBrightness: 0 by day, peaks at 0.5 at midnight
  uniform float uStarBrightness;
  uniform sampler2D uSun;
  uniform sampler2D uMoon;
  // 0..7, Level.getMoonPhase; 0 is the full moon
  uniform float uMoonPhase;
  // Blocks; Java fogs the sky (FOG_SKY) linearly from 0 to the view distance
  uniform float uFogEnd;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  // Java draws the sun and moon as flat quads 100 blocks out (renderSky:
  // sun 30 wide, moon 20 wide). Returns the 0..1 texture coordinate of this
  // view ray on such a quad, or a value outside 0..1 when it misses.
  vec2 celestialUv(vec3 dir, vec3 axis, float halfSize) {
    float t = dot(dir, axis);
    if (t <= 0.0) return vec2(-1.0);
    vec3 hit = dir * (100.0 / t);
    // Keep one edge level with the horizon (the tilted orbit never passes
    // straight overhead, so this is always defined)
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), axis));
    vec3 up = cross(axis, side);
    return vec2(dot(hit, side), dot(hit, up)) / (2.0 * halfSize) + 0.5;
  }

  bool inQuad(vec2 uv) {
    return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)));
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    // Java draws the sky as a plane 16 blocks up (LevelRenderer.buildSkyDisc),
    // so the fog colour takes over as the view flattens towards the horizon
    float skyDist = 16.0 / max(h, 1e-3);
    float skyFog = clamp(skyDist / uFogEnd, 0.0, 1.0);
    vec3 c = h >= 0.0
      ? mix(uZenith, uHorizon, skyFog)
      : mix(uHorizon, uVoid, smoothstep(0.08, 0.45, -h));

    // ~1500 tiny stars (LevelRenderer.drawStars: size 0.15..0.25 at
    // distance 100), added on top like Java's additive star pass
    if (uStarBrightness > 0.0 && h > 0.0) {
      vec3 cellPos = dir * 60.0;
      vec3 cell = floor(cellPos);
      float pick = hash(cell);
      if (pick > 0.982) {
        vec3 centre = cell + 0.2 + 0.6 * vec3(hash(cell + 1.0), hash(cell + 2.0), hash(cell + 3.0));
        float d = length(cellPos - centre);
        float size = 0.09 + 0.06 * hash(cell + 4.0);
        float star = 1.0 - smoothstep(size, size + 0.06, d);
        c += vec3(star * uStarBrightness) * smoothstep(0.0, 0.15, h);
      }
    }

    // Sun and moon are textured quads blended additively (SRC_ALPHA, ONE)
    // Quads are Java's sizes (sun 60 wide, moon 40 wide at distance 100); the
    // Bedrock textures keep the bright body in the middle quarter of each
    // 32 px cell with a soft halo around it
    vec2 sunUv = celestialUv(dir, uSunDir, 30.0);
    if (inQuad(sunUv)) {
      vec4 sun = texture2D(uSun, sunUv);
      c += sun.rgb * sun.a;
    }
    vec2 moonUv = celestialUv(dir, -uSunDir, 20.0);
    if (inQuad(moonUv)) {
      vec2 cell = vec2(mod(uMoonPhase, 4.0), floor(uMoonPhase / 4.0));
      vec4 moon = texture2D(uMoon, (moonUv + cell) / vec2(4.0, 2.0));
      c += moon.rgb;
    }

    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

// Plains biome `sky_color` 7907327 and `fog_color` 12638463
const DAY_ZENITH = new THREE.Color(0x78a7ff);
const DAY_HORIZON = new THREE.Color(0xc0d8ff);
const NIGHT_ZENITH = new THREE.Color(0x03040c);
const NIGHT_HORIZON = new THREE.Color(0x0b0e1c);
const SUNSET = new THREE.Color(0xe0793a);

function loadEnvironmentTexture(name: string) {
  const tex = new THREE.TextureLoader().load(
    `/textures/environment/${name}.png`
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // Image row 0 at v = 0, matching Java's texture coordinates
  tex.flipY = false;
  return tex;
}

/**
 * `ClientLevel.getStarBrightness`, with the sun's fraction of a revolution
 * measured from noon as Java measures `timeOfDay` (0 = noon, 0.5 = midnight)
 */
function starBrightness(sunFraction: number) {
  const f = THREE.MathUtils.clamp(
    1 - (Math.cos(sunFraction * 2 * Math.PI) * 2 + 0.25),
    0,
    1
  );
  return f * f * 0.5;
}

/**
 * Camera-centred sky dome with a horizon band, sun, moon and stars, plus the
 * matching fog colour so distant terrain melts into the horizon like
 * Minecraft's.
 */
export class Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** Length of a full day/night cycle in seconds */
  cycleLength = 600;
  /** Fraction of a cycle added to the clock (debug: scrub time of day) */
  timeOffset = 0;
  /** Sky colour at the horizon; also the terrain fog colour */
  readonly horizon = new THREE.Color();
  readonly zenith = new THREE.Color();
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** 0 at night, 1 in full day */
  daylight = 1;
  /** Fraction of the day measured from noon (0 = noon, 0.5 = midnight) */
  timeOfDay = 0;

  private readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uVoid: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uStarBrightness: { value: 0 },
    uSun: { value: loadEnvironmentTexture("sun") },
    uMoon: { value: loadEnvironmentTexture("moon_phases") },
    uMoonPhase: { value: 0 },
    uFogEnd: { value: 128 },
  };

  /** View distance in blocks; controls how far up the fog colour reaches */
  set fogEnd(blocks: number) {
    this.uniforms.uFogEnd.value = Math.max(16, blocks);
  }

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 32, 24),
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.update(0, new THREE.Vector3());
  }

  /** Sun angle for a moment of the cycle: rises at 11/12, sets at 5/12 */
  sunAngle(time: number) {
    return (
      2 * Math.PI * (time / this.cycleLength + this.timeOffset) + Math.PI / 6
    );
  }

  update(time: number, cameraPosition: THREE.Vector3) {
    const angle = this.sunAngle(time);
    this.sunDir.set(Math.cos(angle), Math.sin(angle), 0.25).normalize();
    const elevation = this.sunDir.y;
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.12, 0.28);
    const sunset = 1 - THREE.MathUtils.smoothstep(Math.abs(elevation), 0, 0.22);

    this.daylight = daylight;
    this.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, daylight);
    this.horizon.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, daylight);
    this.horizon.lerp(SUNSET, sunset * 0.65);
    this.zenith.lerp(SUNSET, sunset * 0.12);

    this.uniforms.uZenith.value.copy(this.zenith);
    this.uniforms.uHorizon.value.copy(this.horizon);
    this.uniforms.uVoid.value.copy(this.horizon).multiplyScalar(0.55);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.timeOfDay = THREE.MathUtils.euclideanModulo(
      (angle - Math.PI / 2) / (2 * Math.PI),
      1
    );
    this.uniforms.uStarBrightness.value = starBrightness(this.timeOfDay);
    // `Level.getMoonPhase`: advances one step per day
    this.uniforms.uMoonPhase.value =
      Math.floor(time / this.cycleLength + this.timeOffset) % 8;
    this.mesh.position.copy(cameraPosition);
  }
}
