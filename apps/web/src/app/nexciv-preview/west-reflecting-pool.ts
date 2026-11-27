import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// Match the clipped coping and seven jet centres in civrum_lakeside_blocks.public_spaces.
const WIDTH = 6.95, LENGTH = 39.35, CORNER = 0.63;
const basinShader = {
  name: 'West reflecting pool',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
    waterTime: { value: 0 }, reflectionMix: { value: 0 },
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec2 basin;
    varying vec3 world;
    varying vec4 reflectionUv;
    void main() {
      basin = position.xy;
      world = (modelMatrix * vec4(position, 1.0)).xyz;
      reflectionUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float waterTime, reflectionMix;
    varying vec2 basin;
    varying vec3 world;
    varying vec4 reflectionUv;
    void main() {
      float t = waterTime;
      vec2 jet = vec2(basin.x, basin.y - 5.0 * clamp(floor(basin.y / 5.0 + 0.5), -3.0, 3.0));
      float r = length(jet);
      float ring = sin(15.0 * r - 2.4 * t) * exp(-1.5 * abs(r - 0.63));
      ring *= 1.0 - smoothstep(0.035, 0.19, fwidth(r));
      float breeze = sin(basin.y * 2.6 + 1.3 * sin(basin.x * 2.2) + t * 0.72);
      vec2 wave = vec2(0.65 * breeze, 0.35 * sin(basin.x * 4.3 - t * 0.65))
                + jet / max(r, 0.05) * ring;
      float deep = smoothstep(0.0, 1.7, min(3.475 - abs(basin.x), 19.675 - abs(basin.y)));
      vec3 bed = mix(vec3(0.055, 0.38, 0.39), vec3(0.018, 0.20, 0.27), deep);
      float glint = pow(max(0.0, breeze * 0.48 + ring * 0.52), 3.0);
      vec3 water = bed + (0.025 + glint * 0.22) * vec3(0.42, 0.86, 0.91);
      if (reflectionMix > 0.0) {
        vec2 uv = reflectionUv.xy / reflectionUv.w + wave * vec2(0.0027, 0.0018);
        vec3 reflected = texture2D(tDiffuse, clamp(uv, 0.002, 0.998)).rgb;
        float facing = abs(normalize(cameraPosition - world).y);
        float fresnel = 0.18 + 0.56 * pow(1.0 - facing, 2.2);
        water = mix(water, reflected * vec3(0.84, 0.96, 1.0), reflectionMix * fresnel);
      }
      gl_FragColor = vec4(water, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function createWestPool(time: { value: number }) {
  const w = WIDTH / 2, h = LENGTH / 2, c = CORNER;
  const outline = new THREE.Shape();
  outline.moveTo(-w + c, -h);
  outline.lineTo(w - c, -h); outline.lineTo(w, -h + c);
  outline.lineTo(w, h - c); outline.lineTo(w - c, h);
  outline.lineTo(-w + c, h); outline.lineTo(-w, h - c);
  outline.lineTo(-w, -h + c); outline.closePath();
  const surface = new Reflector(new THREE.ShapeGeometry(outline), {
    shader: basinShader, textureWidth: 640, textureHeight: 384, multisample: 0,
  });
  surface.name = 'West fountain water';
  surface.position.set(-80.8, 0.584, 32.5);
  surface.rotation.x = -Math.PI / 2;
  const material = surface.material as THREE.ShaderMaterial;
  material.uniforms.waterTime = time;
  const reflectionMix = { value: 0 };
  material.uniforms.reflectionMix = reflectionMix;
  const reflect = surface.onBeforeRender.bind(surface);
  let lastCapture = -Infinity;
  surface.onBeforeRender = (renderer, scene, camera, ...rest) => {
    const distance = camera.position.distanceTo(surface.position);
    // Only a visible, nearby water surface needs a second view of the street.
    const mix = renderer.extensions.has('EXT_color_buffer_float') ? 1 - THREE.MathUtils.smoothstep(distance, 36, 64) : 0;
    reflectionMix.value = mix;
    if (!mix) { lastCapture = -Infinity; return; }
    const now = performance.now();
    if (now - lastCapture >= 100) {
      reflect(renderer, scene, camera, ...rest);
      lastCapture = now;
    }
  };
  return surface;
}
