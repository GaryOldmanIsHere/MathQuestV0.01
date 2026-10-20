import * as THREE from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute, cameraPosition, color, dot, floor, fract, hash, instancedBufferAttribute, mix, normalize, positionGeometry,
  positionWorld, sin, smoothstep, step, time, uniform, vec3,
} from 'three/tsl';
import { snowCover, wetness, wind } from './landscape';
import type { Weather } from './sky';
import { hourLight, WEATHER } from './sky';
import { bakedModel } from './models';
import { WORLD_D, WORLD_W } from './worldMap';

// The weather and the hour over the campaign map: a sky whose colours turn
// with the day, a sun (or at night the moon) that casts shadows over the
// part of the land in view, clouds whose shadows drift across it, and rain,
// snow or mist when the weather turns. Presentation only: none of it
// touches the campaign. (The day's hours and the weather's rules are in sky.ts.)

export type { Weather } from './sky';

/** The size of the box of air about the view in which rain and snow fall, world units. */
const FALL_W = 46;
const FALL_H = 16;
const CLOUDS = 14;

export interface AtmosphereOptions {
  /** Sharpness of the sun's shadows, texels a side (0: no shadows). */
  shadows: number;
  /** How many drops or flakes may be falling at once. */
  particles: number;
  /** The stretch of land the clouds drift over, x and z (the campaign map's, unless given). */
  area?: { x0: number; z0: number; x1: number; z1: number };
}

export class Atmosphere {
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private fill = new THREE.HemisphereLight(0xf0f4ff, 0x4a5a3a, 1);
  private fog = new THREE.Fog(0xbcd6f0, 80, 190);
  private sky: THREE.Mesh;
  private zenith = uniform(new THREE.Color(0x4a86e0));
  private horizon = uniform(new THREE.Color(0xbcd6f0));
  private night = uniform(0);
  private clouds: THREE.InstancedMesh | null = null;
  private cloudSpots: { x: number; z: number; s: number; turn: number }[] = [];
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.InstancedMesh | null = null;
  private fallCentre = uniform(new THREE.Vector3());
  private rainAmount = uniform(0);
  private snowAmount = uniform(0);
  private hour = 0.4;
  private weather: Weather = 'clear';
  /** The weather's effect as it now stands, easing toward the weather set. */
  private now = { ...WEATHER.clear };
  private snowLying = 0;
  private wetLying = 0;
  /**
   * The colour the hour's light gives things drawn without lighting (the
   * squads' figures): white by day, dimmed and blued by night, warmed at
   * dawn and dusk.
   */
  readonly flatLight = new THREE.Color(1, 1, 1);

  private get area(): { x0: number; z0: number; x1: number; z1: number } {
    return this.options.area ?? { x0: 0, z0: 0, x1: WORLD_W, z1: WORLD_D };
  }

  constructor(private scene: THREE.Scene, private options: AtmosphereOptions) {
    scene.fog = this.fog;
    scene.background = null;
    scene.add(this.fill, this.sun, this.sun.target);
    if (options.shadows > 0) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(options.shadows, options.shadows);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.03;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 220;
    }
    this.sky = this.makeSky();
    scene.add(this.sky);
    if (options.shadows > 0) this.makeClouds();
    if (options.particles > 0) {
      this.rain = this.makeRain(options.particles);
      this.snow = this.makeSnow(Math.round(options.particles * 0.6));
      scene.add(this.rain, this.snow);
    }
  }

  /** Set the hour (0 midnight, 0.5 noon); `now` skips any easing. */
  setHour(hour: number): void {
    this.hour = ((hour % 1) + 1) % 1;
  }

  get currentWeather(): Weather {
    return this.weather;
  }

  /** Change the weather; it comes on over a few seconds (or at once). */
  setWeather(w: Weather, now = false): void {
    this.weather = w;
    if (now) {
      this.now = { ...WEATHER[w] };
      this.snowLying = WEATHER[w].snow;
      this.wetLying = WEATHER[w].rain;
    }
  }

  /** The sky: a dome about the camera, its colour running from the horizon up; stars by night. */
  private makeSky(): THREE.Mesh {
    const material = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    const dir = normalize(positionWorld.sub(cameraPosition));
    const up = dir.y.max(0);
    const gradient = mix(this.horizon, this.zenith, smoothstep(0, 0.45, up));
    const stars = step(0.996, hash(dot(floor(dir.mul(160)), vec3(1, 157, 113)))).mul(smoothstep(0.05, 0.3, up)).mul(this.night);
    material.colorNode = gradient.add(vec3(stars));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 12), material);
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    return dome;
  }

  /** Clouds unseen but for their shadows, drifting over the land with the wind. */
  private makeClouds(): void {
    const shapes = [bakedModel('cloud_big'), bakedModel('cloud_small')];
    const shape = shapes[0] ?? shapes[1];
    if (!shape) return;
    const material = new MeshBasicNodeMaterial();
    material.colorWrite = false;
    material.depthWrite = false;
    this.clouds = new THREE.InstancedMesh(shape.geometry, material, CLOUDS);
    this.clouds.castShadow = true;
    this.clouds.frustumCulled = false;
    this.clouds.userData.shared = true;
    for (let k = 0; k < CLOUDS; k++) {
      const { x0, z0, x1, z1 } = this.area;
      this.cloudSpots.push({ x: x0 + Math.random() * (x1 - x0), z: z0 + Math.random() * (z1 - z0), s: 1.8 + Math.random() * 2.2, turn: Math.random() * Math.PI });
    }
    this.scene.add(this.clouds);
  }

  /** Rain: streaks falling through a box of air that follows the view, slanting in the wind. */
  private makeRain(count: number): THREE.LineSegments {
    const positions = new Float32Array(count * 6);
    const offsets = new Float32Array(count * 6);
    for (let k = 0; k < count; k++) {
      const o = [Math.random(), Math.random(), Math.random()];
      positions.set([0, 0, 0, 0, -0.45, 0], k * 6);
      offsets.set([...o, ...o], k * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('offset', new THREE.BufferAttribute(offsets, 3));
    const material = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    const o = attribute<'vec3'>('offset', 'vec3');
    const y = fract(o.y.sub(time.mul(1.6))).mul(FALL_H);
    const slant = wind.mul(0.35);
    material.positionNode = this.fallCentre.add(vec3(o.x.sub(0.5).mul(FALL_W).add(positionGeometry.y.mul(slant)), y.sub(FALL_H * 0.3), o.z.sub(0.5).mul(FALL_W)))
      .add(vec3(0, positionGeometry.y, 0));
    material.colorNode = color(0xd8e4f0);
    material.opacityNode = this.rainAmount.mul(0.45);
    const lines = new THREE.LineSegments(g, material);
    lines.frustumCulled = false;
    return lines;
  }

  /** Snow: flakes drifting down and sideways through the same box of air. */
  private makeSnow(count: number): THREE.InstancedMesh {
    const offsets = new Float32Array(count * 3);
    for (let k = 0; k < offsets.length; k++) offsets[k] = Math.random();
    const offset = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(offsets, 3), 'vec3');
    const material = new MeshStandardNodeMaterial({ roughness: 1, transparent: true, depthWrite: false });
    const y = fract(offset.y.sub(time.mul(0.12))).mul(FALL_H);
    const drift = sin(time.mul(0.8).add(offset.x.mul(40))).mul(0.6).add(wind.mul(y).mul(0.12));
    material.positionNode = this.fallCentre.add(vec3(offset.x.sub(0.5).mul(FALL_W).add(drift), y.sub(FALL_H * 0.3), offset.z.sub(0.5).mul(FALL_W)))
      .add(positionGeometry);
    material.colorNode = color(0xffffff);
    material.emissiveNode = color(0x8090a0);
    material.opacityNode = this.snowAmount.mul(0.9);
    const flakes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.045), material, count);
    flakes.frustumCulled = false;
    return flakes;
  }

  /**
   * Advance the weather and set the light for the hour, the shadows about
   * the ground point the camera looks at, and the falling rain or snow about
   * it too. `view` is how far back the camera stands.
   */
  update(dtMs: number, camera: THREE.Camera, focus: THREE.Vector3, view: number): void {
    const dt = dtMs / 1000;
    // The weather eases toward what was set.
    const want = WEATHER[this.weather];
    const k = 1 - Math.exp(-dt / 2.5);
    for (const key of Object.keys(want) as (keyof typeof want)[]) this.now[key] += (want[key] - this.now[key]) * k;
    // Snow settles and melts, and the land dries, more slowly still.
    this.snowLying += ((this.now.snow > 0.5 ? 1 : 0) - this.snowLying) * (1 - Math.exp(-dt / 20));
    this.wetLying += ((this.now.rain > 0.3 ? 1 : 0) - this.wetLying) * (1 - Math.exp(-dt / (this.now.rain > 0.3 ? 6 : 25)));
    snowCover.value = this.snowLying * 0.85;
    wetness.value = this.wetLying;
    wind.value = this.now.wind;
    this.rainAmount.value = this.now.rain;
    this.snowAmount.value = this.now.snow;

    // The light for the hour, greyed by the weather.
    const light = hourLight(this.hour);
    const grey = this.now.grey;
    const overcast = new THREE.Color(0x9aa4ae);
    this.sun.color.setHex(light.sun);
    this.sun.intensity = light.sunPower * this.now.sun;
    this.fill.color.setHex(light.sky).lerp(overcast, grey * 0.5);
    this.fill.groundColor.setHex(light.ground);
    this.fill.intensity = light.fill * (1 + grey * 0.25);
    this.zenith.value.setHex(light.zenith).lerp(overcast.clone().multiplyScalar(light.sunPower / 2), grey * 0.8);
    this.horizon.value.setHex(light.horizon).lerp(overcast.clone().multiplyScalar(0.6 + light.sunPower / 4), grey * 0.8);
    this.night.value = THREE.MathUtils.clamp(1 - light.sunPower / 0.9, 0, 1) * (1 - grey);
    const bright = THREE.MathUtils.clamp(0.42 + (light.sunPower * this.now.sun) / 2.6 + light.fill * 0.18, 0.5, 1.05);
    this.flatLight.setHex(light.sun).lerp(new THREE.Color(1, 1, 1), 0.65).multiplyScalar(bright);
    // Distance fades into the horizon's colour; mist draws it in close.
    this.fog.color.copy(this.horizon.value);
    this.fog.near = THREE.MathUtils.lerp(80, 6, this.now.fog);
    this.fog.far = THREE.MathUtils.lerp(190, 70, this.now.fog);

    // The sun (or moon) crosses the sky from the east; shadows cover what is in view.
    const day = this.hour > 0.23 && this.hour < 0.79;
    const across = day ? (this.hour - 0.23) / 0.56 : ((this.hour + 0.21) % 1) / 0.44;
    const azimuth = Math.PI * (0.15 + across * 0.7);
    const dir = new THREE.Vector3(Math.cos(azimuth) * Math.cos(light.elevation), Math.sin(light.elevation), -0.45 - Math.sin(azimuth) * 0.3 * Math.cos(light.elevation)).normalize();
    const reach = Math.max(14, view * 0.85 + 6);
    if (this.sun.castShadow) {
      const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
      // Snap the shadows' frame to whole texels, so they do not shimmer as the view pans.
      const texel = (reach * 2) / this.options.shadows;
      const snapped = focus.clone();
      snapped.x = Math.round(snapped.x / texel) * texel;
      snapped.z = Math.round(snapped.z / texel) * texel;
      if (cam.right !== reach) {
        cam.left = -reach;
        cam.right = reach;
        cam.top = reach;
        cam.bottom = -reach;
        cam.updateProjectionMatrix();
      }
      this.sun.target.position.copy(snapped);
      this.sun.position.copy(snapped).addScaledVector(dir, 90);
    } else {
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(dir, 90);
    }

    // Clouds drift with the wind and come round again; how many by the weather.
    if (this.clouds) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const shown = Math.round(CLOUDS * this.now.clouds);
      this.cloudSpots.forEach((c, i) => {
        c.x += dt * (0.4 + this.now.wind * 1.2);
        c.z += dt * 0.15;
        const { x0, z0, x1, z1 } = this.area;
        if (c.x > x1 + 12) c.x = x0 - 12;
        if (c.z > z1 + 12) c.z = z0 - 12;
        const s = i < shown ? c.s : 0.0001;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.turn);
        m.compose(new THREE.Vector3(c.x, 16, c.z), q, new THREE.Vector3(s * 1.4, s * 0.5, s));
        this.clouds!.setMatrixAt(i, m);
      });
      this.clouds.instanceMatrix.needsUpdate = true;
    }

    this.fallCentre.value.copy(focus);
    if (this.rain) this.rain.visible = this.now.rain > 0.02;
    if (this.snow) this.snow.visible = this.now.snow > 0.02;
    this.sky.position.copy(camera.position);
  }

  dispose(): void {
    this.scene.remove(this.sky, this.sun, this.sun.target, this.fill);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sun.dispose();
    for (const o of [this.rain, this.snow]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    if (this.clouds) {
      this.scene.remove(this.clouds);
      (this.clouds.material as THREE.Material).dispose();
      this.clouds.dispose();
    }
  }
}
