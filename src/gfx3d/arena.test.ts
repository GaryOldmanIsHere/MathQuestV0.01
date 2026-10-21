import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Arena } from './arena';
import type { Terrain } from '../core/terrain';

const THEMES: Terrain[] = ['plain', 'road', 'forest', 'mountain', 'water'];
const options = { seed: 5, grass: 0, shadows: 0, particles: 0, simple: true, hour: 0.4, weather: 'clear' as const };

/** Where the squads stand: x within 8 of the middle, z within 3 (see layout.ts). */
const FIELD = { x: 8.5, z: 3.5 };

describe('battle arenas', () => {
  it('give the squads level ground on every kind of field', () => {
    for (const theme of THEMES) {
      const arena = new Arena(new THREE.Scene(), theme, options);
      for (let x = -FIELD.x; x <= FIELD.x; x += 0.5) {
        for (let z = -FIELD.z; z <= FIELD.z; z += 0.5) {
          expect(Math.abs(arena.heightAt(x, z)), `${theme} at ${x},${z}`).toBeLessThan(0.12);
        }
      }
      arena.dispose();
    }
  });

  it('rise into hills beyond the field, and fall away under a shore', () => {
    const plain = new Arena(new THREE.Scene(), 'plain', options);
    expect(plain.heightAt(0, -40)).toBeGreaterThan(1.5);
    const pass = new Arena(new THREE.Scene(), 'mountain', options);
    expect(pass.heightAt(0, -40)).toBeGreaterThan(plain.heightAt(0, -40));
    const shore = new Arena(new THREE.Scene(), 'water', options);
    expect(shore.heightAt(0, -14)).toBeLessThan(-0.5);
    for (const a of [plain, pass, shore]) a.dispose();
  });

  it('keep trees and boulders off the battle line and out from before the camera', () => {
    for (const theme of THEMES) {
      const scene = new THREE.Scene();
      const arena = new Arena(scene, theme, options);
      const m = new THREE.Matrix4();
      // Pines are the models' (instanced) where they are loaded, else plain cones (each a group).
      const spots: THREE.Vector3[] = [];
      for (const o of scene.children) {
        const inst = o as THREE.InstancedMesh;
        if (inst.isInstancedMesh) {
          for (let k = 0; k < inst.count; k++) {
            inst.getMatrixAt(k, m);
            spots.push(new THREE.Vector3().setFromMatrixPosition(m));
          }
        } else if ((o as THREE.Group).isGroup) spots.push(o.position.clone());
      }
      expect(spots.length, theme).toBeGreaterThan(5);
      for (const p of spots) {
        const onField = Math.abs(p.x) < 12 && Math.abs(p.z) < 7.5;
        const beforeCamera = p.z > 6 && Math.abs(p.x) < 15.5;
        expect(onField || beforeCamera, `${theme}: something at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(false);
      }
      arena.dispose();
    }
  });
});
