import * as THREE from 'three';
import type { PlaneMesh } from '../paper/build';

/** Convert a PlaneMesh (metres, CG at origin) into a Three.js geometry. */
export function planeGeometry(mesh: PlaneMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  g.setAttribute('part', new THREE.BufferAttribute(mesh.parts, 1));
  g.setAttribute('layer', new THREE.BufferAttribute(mesh.layers, 1));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}
