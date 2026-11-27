import * as THREE from 'three';

export function pavingStyle(name: string): 'asphalt' | 'stone' | undefined {
  if (/^MAT_GRAPHITE_GRAY(?:\.\d+)?$|LAKE_Connector asphalt/i.test(name)) return 'asphalt';
  if (/square_pavers|civic_paving|pavement|concrete_gray|volcanic paver|entrance paving|bluestone pavers|city gravel|quay limestone|^NEXCIV ground(?:\.\d+)?$/i.test(name)) return 'stone';
}

/** World-space albedo, shared by all city chunks. Keep the stone joints visible at pedestrian height. */
export function colorPaving(
  shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string },
  style: 'asphalt' | 'stone',
  palette: THREE.IUniform<THREE.Texture | null>,
  ready: THREE.IUniform<number>,
) {
  shader.uniforms.civicPaving = palette;
  shader.uniforms.civicPavingReady = ready;
  shader.fragmentShader = 'uniform sampler2D civicPaving;\nuniform float civicPavingReady;\n' + shader.fragmentShader;
  const shade = style === 'asphalt' ? `
    // The road surface was partitioned into paint and asphalt at precisely 0.038 m.
    float roadPlane = 1.0 - smoothstep(0.012, 0.021, abs(vLampSurface.y - 0.038));
    float mainRoad = 1.0 - smoothstep(61.8, 65.5, max(abs(ground.x), abs(ground.y)));
    vec3 asphalt = mix(vec3(0.030, 0.052, 0.081), vec3(0.020, 0.040, 0.071), mainRoad);
    diffuseColor.rgb = mix(diffuseColor.rgb, asphalt, flatSurface * roadPlane * cityLimit);
  ` : `
    vec3 stone = texture2D(civicPaving, ground / 352.0 + 0.5).rgb;
    float plazaLimit = (1.0 - smoothstep(0.245, 0.40, vLampSurface.y)) * step(-0.025, vLampSurface.y);
    float shoreLimit = (1.0 - smoothstep(170.6, 171.1, ground.y)) * step(159.35, ground.y) *
      (1.0 - smoothstep(150.0, 151.0, abs(ground.x)));
    // Preserve the separately modelled Nexus compass rather than tinting its inlays.
    float compass = smoothstep(8.24, 8.48, length(ground - vec2(0.0, -12.15)));
    float amount = flatSurface * plazaLimit * max(cityLimit, shoreLimit) * compass * civicPavingReady;
    vec2 slabs = ground / vec2(1.75, 0.88);
    slabs.x += 0.5 * mod(floor(slabs.y), 2.0);
    vec2 joints = abs(fract(slabs + 0.5) - 0.5);
    vec2 footprint = max(fwidth(ground) / vec2(1.75, 0.88), vec2(0.001));
    float grout = max(1.0 - smoothstep(0.006, 0.006 + footprint.x, joints.x),
      1.0 - smoothstep(0.009, 0.009 + footprint.y, joints.y));
    float resolved = 1.0 - smoothstep(0.12, 0.6, max(footprint.x, footprint.y));
    float tileGrain = sin(dot(floor(slabs), vec2(2.44, 4.78))) * 0.045 * resolved;
    float originalLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    stone *= (0.84 + 0.32 * clamp(originalLuma / 0.55, 0.0, 1.0) + tileGrain) * (1.0 - 0.30 * grout * resolved);
    diffuseColor.rgb = mix(diffuseColor.rgb, stone, amount * 0.94);
  `;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    vec2 ground = vec2(vLampSurface.x, -vLampSurface.z);
    vec3 surfaceNormal = cross(dFdx(vLampSurface), dFdy(vLampSurface));
    float flatSurface = smoothstep(0.72, 0.97, abs(surfaceNormal.y) / max(length(surfaceNormal), 0.000001));
    float cityLimit = 1.0 - smoothstep(149.7, 150.0, max(abs(ground.x), abs(ground.y)));
    ${shade}
  `);
}
