import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, mix, mrt, normalView, output, pass, renderOutput, screenUV, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { Quality, QualitySettings } from './quality';
import { defaultQuality, QUALITIES, savedQuality, SETTINGS } from './quality';

// The one renderer the whole game draws with, straight into a canvas that
// fills the window at the display's own resolution. WebGPU where the browser
// has it, WebGL2 otherwise (the renderer chooses). Every frame passes through
// the same finishing chain: ambient occlusion where surfaces meet, a glow
// about the brightest light, tone mapping, a soft vignette, edge smoothing.

/** What a screen hands the engine to draw: a scene, seen by a camera. */
export interface View {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * The miniature look (where the preset allows it): how far, 0 to 1, the
   * land above and below the middle of the view goes out of focus.
   */
  tiltShift?: number;
}

/** How far the tilt-shift blurs now (the view's own setting, read each frame). */
const tiltShiftStrength = uniform(0);

interface Pipeline {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pipeline: THREE.RenderPipeline;
}

const NO_POST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nopost');

export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly backend: 'webgpu' | 'webgl2';
  private quality: Quality;
  private pipeline: Pipeline | null = null;
  /** The canvas's size in CSS pixels. */
  width = 0;
  height = 0;
  private listeners = new Set<(w: number, h: number) => void>();

  private constructor(renderer: THREE.WebGPURenderer, readonly canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    const backend = renderer.backend as { isWebGPUBackend?: boolean };
    this.backend = backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    // ?quality=low (and so on) picks a preset for this visit, ahead of any kept choice.
    const asked = new URLSearchParams(location.search).get('quality') as Quality | null;
    this.quality = (asked && QUALITIES.includes(asked) ? asked : null) ?? savedQuality()
      ?? defaultQuality(this.backend, window.screen.width * window.screen.height * devicePixelRatio ** 2);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = this.settings.shadows > 0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  static async create(canvas: HTMLCanvasElement): Promise<Engine> {
    const gpu = await openWebGPU();
    const renderer = new THREE.WebGPURenderer({
      canvas, antialias: false, powerPreference: 'high-performance',
      ...(gpu ? { device: gpu.device as never } : { forceWebGL: true }),
    });
    await renderer.init();
    if (gpu) {
      // Should the graphics card's WebGPU device be lost (a driver reset, a
      // browser fault), carry on with WebGL2 rather than a black screen. The
      // page reloads to do it, so the campaign under way starts over.
      renderer.onDeviceLost = (info) => {
        console.error('WebGPU device lost; reloading with WebGL2.', info);
        const url = new URL(location.href);
        url.searchParams.set('webgl', '');
        location.replace(url.toString());
      };
    }
    return new Engine(renderer, canvas);
  }

  get settings(): QualitySettings {
    return SETTINGS[this.quality];
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.shadowMap.enabled = this.settings.shadows > 0;
    this.disposePipeline();
    this.resize();
  }

  /** Be told when the canvas changes size (in CSS pixels). */
  onResize(fn: (w: number, h: number) => void): () => void {
    this.listeners.add(fn);
    fn(this.width, this.height);
    return () => this.listeners.delete(fn);
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.settings.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    for (const fn of this.listeners) fn(w, h);
  }

  /** Draw a view through the finishing chain (or straight, with ?nopost, for finding faults). */
  render(view: View): void {
    tiltShiftStrength.value = view.tiltShift ?? 0;
    if (NO_POST) {
      this.renderer.render(view.scene, view.camera);
      return;
    }
    if (!this.pipeline || this.pipeline.scene !== view.scene || this.pipeline.camera !== view.camera) {
      this.disposePipeline();
      this.pipeline = { scene: view.scene, camera: view.camera, pipeline: this.buildPipeline(view) };
    }
    this.pipeline.pipeline.render();
  }

  /** Forget a view's finishing chain (when its scene is let go). */
  release(view: View): void {
    if (this.pipeline?.scene === view.scene) this.disposePipeline();
  }

  private disposePipeline(): void {
    this.pipeline?.pipeline.dispose();
    this.pipeline = null;
  }

  private buildPipeline({ scene, camera, tiltShift }: View): THREE.RenderPipeline {
    const s = this.settings;
    const pipeline = new THREE.RenderPipeline(this.renderer);
    const scenePass = pass(scene, camera);
    if (s.ambientOcclusion) scenePass.setMRT(mrt({ output, normal: normalView }));
    const colour = scenePass.getTextureNode('output');
    let lit: Node<'vec4'> = vec4(colour);
    if (s.ambientOcclusion) {
      const occlusion = ao(scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), camera);
      occlusion.resolutionScale = 0.5;
      lit = colour.mul(vec4(vec3(occlusion.getTextureNode().r), 1));
    }
    if (s.bloom) {
      const glow = bloom(colour, 0.32, 0.45, 0.82);
      lit = lit.add(glow);
    }
    if (tiltShift !== undefined && s.tiltShift) {
      // A band across the middle of the view in focus, the rest blurred: the land looks like a model of itself.
      const soft = gaussianBlur(lit, null, 3, { resolutionScale: 0.5 });
      const away = smoothstep(0.12, 0.42, abs(screenUV.y.sub(0.53)));
      lit = vec4(mix(lit.rgb, soft.rgb, away.mul(tiltShiftStrength)), lit.a);
    }
    // A gentle darkening toward the corners, as a lens gives.
    const fromCentre = uv().sub(0.5).length();
    const vignette = smoothstep(0.95, 0.42, fromCentre).mul(0.22).add(0.78);
    const graded = vec4(lit.rgb.mul(vignette), lit.a);
    // Tone map and convert to the display's colours, then smooth the edges.
    pipeline.outputColorTransform = false;
    const display = renderOutput(graded);
    pipeline.outputNode = s.antialias === 'smaa' ? smaa(display) : fxaa(display);
    return pipeline;
  }

  /** How many geometries and textures the graphics card holds (for the long-run check). */
  memory(): { geometries: number; textures: number } {
    const m = this.renderer.info.memory as { geometries: number; textures: number };
    return { geometries: m.geometries, textures: m.textures };
  }
}

/**
 * Open WebGPU for the renderer, if this browser's can carry it: an adapter
 * and a device asking for every feature the adapter offers (as Three.js
 * would). Three.js names a swizzle on every texture view it makes, almost
 * always 'rgba' (no change at all); browsers that shipped an earlier draft
 * of that part of WebGPU reject the view outright and lose the device,
 * leaving a black screen, so for those the identity swizzle is left out of
 * every view, which changes nothing drawn. Null where WebGPU is missing or
 * unusable: the game is then drawn with WebGL2.
 */
async function openWebGPU(): Promise<{ device: GPUDeviceLike } | null> {
  if (new URLSearchParams(location.search).has('webgl')) return null;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<GPUAdapterLike | null> } }).gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance', featureLevel: 'compatibility' });
    if (!adapter) return null;
    const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] });
    const texture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: 4 /* TEXTURE_BINDING */ });
    try {
      texture.createView({ swizzle: 'rgba' });
    } catch {
      texture.createView({});
      dropIdentitySwizzle(texture);
    }
    texture.destroy();
    return { device };
  } catch {
    return null;
  }
}

/** Leave an 'rgba' swizzle out of every texture view this page asks for. */
function dropIdentitySwizzle(sample: object): void {
  const proto = Object.getPrototypeOf(sample) as { createView: (d?: { swizzle?: string }) => unknown };
  const createView = proto.createView;
  proto.createView = function (this: unknown, d?: { swizzle?: string }) {
    if (d && d.swizzle === 'rgba') {
      const { swizzle: _identity, ...rest } = d;
      return createView.call(this, rest);
    }
    return createView.call(this, d);
  };
}

/** The little of WebGPU used above (the DOM typings may not carry WebGPU). */
interface GPUDeviceLike {
  createTexture(d: { size: number[]; format: string; usage: number }): { createView(d: { swizzle?: string }): unknown; destroy(): void };
}
interface GPUAdapterLike {
  features: Set<string>;
  requestDevice(d: { requiredFeatures: string[] }): Promise<GPUDeviceLike>;
}
