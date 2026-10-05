/**
 * Room lighting: ambient + point lights evaluated per pixel, quantised into dithered bands so the
 * light itself looks pixel-art. Shared by the room background and sprites.
 */

import * as THREE from 'three';

export const MAX_LIGHTS = 24;

export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uAmbient;
uniform vec4 uLights[${MAX_LIGHTS}];      // x, y (room px, y down), radius, intensity
uniform vec3 uLightColors[${MAX_LIGHTS}];
uniform int uLightCount;
uniform float uLevels;
uniform float uTime;

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}

vec3 roomLight(vec2 p) {
  vec3 light = uAmbient;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec4 L = uLights[i];
    float d = length(p - L.xy) / L.z;
    float a = clamp(1.0 - d, 0.0, 1.0);
    light += uLightColors[i] * (a * a) * L.w;
  }
  return light;
}

vec3 quantise(vec3 light, vec2 pix) {
  float lum = max(light.r, max(light.g, light.b));
  float q = floor(lum * uLevels + bayer4(pix)) / uLevels;
  q = min(q, 1.35);
  return light * (q / max(lum, 1e-3));
}
`;

export interface LightUniforms {
  uAmbient: { value: THREE.Color };
  uLights: { value: THREE.Vector4[] };
  uLightColors: { value: THREE.Color[] };
  uLightCount: { value: number };
  uLevels: { value: number };
  uTime: { value: number };
}

export function createLightUniforms(): LightUniforms {
  return {
    uAmbient: { value: new THREE.Color(0.8, 0.8, 0.8) },
    uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
    uLightColors: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color()) },
    uLightCount: { value: 0 },
    uLevels: { value: 7 },
    uTime: { value: 0 },
  };
}

/** Background: albedo × light + glow. */
export function createRoomMaterial(shared: LightUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...shared,
      uAlbedo: { value: null },
      uGlow: { value: null },
      uGlowStrength: { value: 1 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform sampler2D uAlbedo;
      uniform sampler2D uGlow;
      uniform float uGlowStrength;
      ${LIGHT_GLSL}
      void main() {
        vec2 p = vec2(vUv.x * 640.0, (1.0 - vUv.y) * 360.0);
        vec2 pix = floor(p);
        vec3 albedo = texture(uAlbedo, vUv).rgb;
        vec3 glow = texture(uGlow, vUv).rgb;
        vec3 light = quantise(roomLight(pix + 0.5), pix);
        vec3 col = albedo * light;
        col = max(col, glow * uGlowStrength);
        fragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Lit sprite (texture with alpha) for dynamic objects. */
export function createSpriteMaterial(shared: LightUniforms, tex: THREE.Texture, emissive = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...shared,
      uMap: { value: tex },
      uEmissive: { value: emissive },
      uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uAlpha: { value: 1 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      out vec2 vRoom;
      uniform vec4 uUvRect;
      void main() {
        vUv = uUvRect.xy + uv * uUvRect.zw;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vRoom = vec2(world.x, 360.0 - world.y);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      in vec2 vRoom;
      out vec4 fragColor;
      uniform sampler2D uMap;
      uniform float uEmissive;
      uniform float uAlpha;
      ${LIGHT_GLSL}
      void main() {
        vec4 t = texture(uMap, vUv);
        if (t.a < 0.5) discard;
        vec2 pix = floor(vRoom);
        vec3 light = quantise(roomLight(pix + 0.5), pix);
        vec3 col = mix(t.rgb * light, t.rgb, uEmissive);
        fragColor = vec4(col, uAlpha);
      }
    `,
  });
}

export function nearestTexture(canvas: HTMLCanvasElement | OffscreenCanvas): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
