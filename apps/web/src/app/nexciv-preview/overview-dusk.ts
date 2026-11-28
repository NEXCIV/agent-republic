import * as THREE from 'three';
import { colorPaving, pavingStyle } from './civic-paving';

// The bake and all GLB detail levels share world metres.
const PAVING = /(?:square_pavers|civic_paving|asphalt|pavement|concrete_gray|granite joints|volcanic paver|crosswalk|entry paving|entrance paving|forecourt|bluestone pavers|city gravel|quay limestone|paving stone|tactile crossing)/i;

/** Linear HDR sky for the copper dome, water and brass. Three prefilters it once for rough surfaces. */
export function createDuskReflection(sunDirection: THREE.Vector3) {
  const width = 128, height = 64;
  const pixels = new Float32Array(width * height * 4);
  const direction = new THREE.Vector3();
  for (let row = 0; row < height; row++) {
    const latitude = ((row + 0.5) / height - 0.5) * Math.PI;
    for (let col = 0; col < width; col++) {
      const longitude = ((col + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude));
      const sky = THREE.MathUtils.smoothstep(direction.y, -0.13, 0.54);
      const west = Math.max(0, direction.dot(sunDirection));
      const sunset = 2.7 * west ** 4 + 17 * west ** 32;
      const i = (row * width + col) * 4;
      pixels[i] = 0.14 + 0.38 * sky + sunset;
      pixels[i + 1] = 0.11 + 0.50 * sky + 0.55 * sunset;
      pixels[i + 2] = 0.085 + 0.83 * sky + 0.18 * sunset;
      pixels[i + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

export function lightOverview(asset: THREE.Group, sky: THREE.Texture) {
  // The GLB contains separate illuminated and unlit panes, including baked façade windows.
  const materials = new Set<THREE.MeshStandardMaterial>();
  asset.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      if (mat instanceof THREE.MeshStandardMaterial) materials.add(mat);
    }
  });
  for (const mat of materials) {
    if (/Window_Amber|CIVIC_Amber_Glass/i.test(mat.name)) mat.emissiveIntensity *= 2.45;
    if (/amber guide lens|architectural gold trim/i.test(mat.name)) mat.emissiveIntensity *= 1.55;
    if (/Warm interior plaster/i.test(mat.name)) mat.emissiveIntensity *= 3.4;
    if (/CIVIC_Fountain/.test(mat.name)) lightFountainJets(mat);
    if (mat instanceof THREE.MeshPhysicalMaterial && /^MAT_CIVIC_Jet(?:\.\d+)?$/.test(mat.name) && mat.transmission > 0) {
      // These distant jets retain their blue emissive finish without rendering the opaque city again for refraction.
      mat.transmission = 0;
      mat.transparent = true;
      mat.opacity = 0.72;
      mat.depthWrite = false;
      mat.forceSinglePass = true;
    }
  }
  // Only the hall dome uses this polished copper response. Keep the material's base colour and ribs.
  const hall = asset.children.find(node => node.name.startsWith('HERO_01_Governance_Hall'));
  hall?.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      if (mat instanceof THREE.MeshStandardMaterial && /Patinated copper|Copper panels/i.test(mat.name)) {
        mat.envMap = sky;
        mat.envMapIntensity = 2.7;
      }
    }
  });
  // The portico fixtures face the hall from the front steps. No extra shadow maps.
  const flood = (color: number, intensity: number, range: number, at: THREE.Vector3, to: THREE.Vector3, angle: number) => {
    const light = new THREE.SpotLight(color, intensity, range, angle, 0.83, 2);
    light.position.copy(at);
    light.target.position.copy(to);
    asset.add(light, light.target);
  };
  flood(0xffc064, 5700, 57, new THREE.Vector3(-14, 8, -79), new THREE.Vector3(0, 17, -95), 0.64);
  flood(0xffbd66, 990, 31, new THREE.Vector3(7.2, 0.75, -81.9), new THREE.Vector3(4, 6.6, -88), 0.69);
  flood(0xffcb65, 1120, 34, new THREE.Vector3(-4.25, 0.94, 2.72), new THREE.Vector3(-3.3, 9.1, -4.25), 0.76);
}

function lightFountainJets(mat: THREE.MeshStandardMaterial) {
  mat.customProgramCacheKey = () => 'nexciv-overview-fountain-lights';
  mat.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vBasinPoint;\n' + shader.vertexShader.replace('#include <project_vertex>',
      'vBasinPoint = (modelMatrix * vec4(transformed, 1.0)).xz;\n#include <project_vertex>');
    shader.fragmentShader = 'varying vec2 vBasinPoint;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      bool west = vBasinPoint.x < 0.0;
      float center = west ? 32.5 : (vBasinPoint.y < 38.0 ? 21.1 : 50.6);
      float last = west ? 3.0 : (vBasinPoint.y < 38.0 ? 1.0 : 0.0);
      float jet = 5.0 * clamp(floor((vBasinPoint.y - center) / 5.0 + 0.5), -last, last);
      vec2 offset = vBasinPoint - vec2(west ? -80.8 : 81.4, center + jet);
      totalEmissiveRadiance += vec3(0.07, 0.73, 1.65) * exp(-0.56 * dot(offset, offset));
    `);
  };
}

export function lightStreetSurfaces(
  materials: Set<THREE.MeshStandardMaterial>, atlas: THREE.IUniform<THREE.Texture | null>, overview: boolean,
  palette: THREE.IUniform<THREE.Texture | null>, paletteReady: THREE.IUniform<number>,
) {
  for (const mat of materials) {
    const paving = PAVING.test(mat.name);
    const finish = shopFinish(mat.name);
    const style = pavingStyle(mat.name);
    if (!paving && !finish && !style) continue;
    mat.customProgramCacheKey = () => `nexciv-dusk-surface-${paving ? (overview ? 'road' : 'pavement') : finish}-${style ?? ''}`;
    mat.onBeforeCompile = shader => {
      shader.uniforms.streetIrradiance = atlas;
      shader.vertexShader = 'varying vec3 vLampSurface;\n' + shader.vertexShader.replace('#include <project_vertex>', `
        vec4 lampSurface = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lampSurface = instanceMatrix * lampSurface;
        #endif
        vLampSurface = (modelMatrix * lampSurface).xyz;
        #include <project_vertex>
      `);
      const sample = 'vec3 streetLight = texture2D(streetIrradiance, vec2(vLampSurface.x, -vLampSurface.z) / 352.0 + 0.5).rgb;';
      shader.fragmentShader = 'uniform sampler2D streetIrradiance;\nvarying vec3 vLampSurface;\n' + shader.fragmentShader;
      if (style) colorPaving(shader, style, palette, paletteReady);
      if (paving) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
          #include <lights_fragment_end>
          ${sample}
          float receiver = 1.0 - smoothstep(0.8, 2.0, vLampSurface.y);
          vec3 spill = vec3(3.4, 1.62, 0.55) * streetLight.g;
          ${overview ? 'spill += vec3(1.80, 0.91, 0.30) * streetLight.r;' : ''}
          reflectedLight.indirectDiffuse += diffuseColor.rgb * receiver * spill;
        `);
      } else if (finish) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          ${sample}
          float ceiling = 8.0 * streetLight.b;
          float groundFloor = smoothstep(0.5, 1.0, ceiling) * (1.0 - smoothstep(ceiling - 0.12, ceiling + 0.12, vLampSurface.y));
          float relativeHeight = clamp(vLampSurface.y / max(ceiling, 0.5), 0.0, 1.0);
          float variation = 0.5 + 0.5 * sin(dot(vLampSurface.xz, vec2(0.057, 0.092)));
          vec3 lamplight = mix(vec3(1.0, 0.48, 0.17), vec3(1.0, 0.73, 0.42), variation);
          totalEmissiveRadiance += lamplight * groundFloor * (${finish});
        `);
      }
    };
    mat.needsUpdate = true;
  }
}

// Treat the real interior, opal fittings and bronze canopy differently from the transparent glazing.
function shopFinish(name: string) {
  if (/Warm interior plaster|MAT_SHOP_Plaster/i.test(name))
    return '0.14 + (0.40 + 2.45 * relativeHeight) * (0.19 + 0.81 * smoothstep(0.008, 0.38, streetLight.g))';
  if (/Facade_Warm opal|MAT_SHOP_Opal/i.test(name)) return '2.6';
  if (/Facade_Smoke glass|NEXCIV browser glazing|NEXCIV starter glazing/i.test(name))
    return 'mix(0.48, 2.8, smoothstep(40.0, 150.0, length(vViewPosition))) * (0.25 + relativeHeight) * (0.32 + streetLight.g)';
  if (/Facade_Brushed brass|MAT_SHOP_Brass/i.test(name))
    return '2.8 * smoothstep(0.40, 0.78, streetLight.g) * smoothstep(0.63, 0.78, relativeHeight)';
  if (/Facade_Oiled oak|MAT_SHOP_Oak/i.test(name)) return '0.24';
  return '';
}
