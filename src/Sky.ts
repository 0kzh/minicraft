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
  uniform float uDaylight;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 c = h >= 0.0
      ? mix(uHorizon, uZenith, smoothstep(0.0, 0.38, h))
      : mix(uHorizon, uVoid, smoothstep(0.08, 0.45, -h));

    // Stars fade in with the night, hidden below the horizon haze
    float cell = hash(floor(dir * 140.0));
    float star = step(0.9965, cell) * smoothstep(0.02, 0.2, h);
    c += vec3(star) * (1.0 - uDaylight) * (0.5 + 0.5 * cell);

    float s = dot(dir, uSunDir);
    vec3 sunColor = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.98, 0.9), uDaylight);
    c += sunColor * smoothstep(0.9975, 0.9988, s);
    c += sunColor * smoothstep(0.985, 0.9975, s) * 0.25;

    float m = dot(dir, -uSunDir);
    c += vec3(0.9, 0.92, 1.0) * smoothstep(0.9988, 0.9993, m) * (1.0 - uDaylight);

    gl_FragColor = vec4(c, 1.0);
  }
`;

const DAY_ZENITH = new THREE.Color(0x78a7ff);
const DAY_HORIZON = new THREE.Color(0xc0d8ff);
const NIGHT_ZENITH = new THREE.Color(0x03040c);
const NIGHT_HORIZON = new THREE.Color(0x0b0e1c);
const SUNSET = new THREE.Color(0xe0793a);

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

  private readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uVoid: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDaylight: { value: 1 },
  };

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
    this.uniforms.uDaylight.value = daylight;
    this.mesh.position.copy(cameraPosition);
  }
}
