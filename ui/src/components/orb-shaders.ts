// Adapted from ElevenLabs UI Orb, MIT © 2025 Eleven Labs Inc.
// See THIRD_PARTY_NOTICES.md. Inside's flowing field and palette are customized.
export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const fragmentShader = /* glsl */ `
uniform float uAnimation;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uGold;
uniform float uInputVolume;
uniform float uOutputVolume;
uniform float uOpacity;
uniform sampler2D uPerlinTexture;
varying vec2 vUv;
float cloud(vec2 p) {
  return texture2D(uPerlinTexture, p * 0.23).r * 0.57
       + texture2D(uPerlinTexture, p * 0.46 + vec2(0.13, 0.37)).r * 0.28
       + texture2D(uPerlinTexture, p * 0.92 + vec2(0.43, 0.17)).r * 0.15;
}
void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  float radius = length(uv);
  float alpha = 1.0 - smoothstep(0.976, 1.0, radius);
  if (alpha < 0.001) discard;
  float z = sqrt(max(0.0, 1.0 - dot(uv, uv)));
  float t = uAnimation;
  float energy = clamp(uInputVolume + uOutputVolume, 0.0, 1.0);
  float angle = t * 0.25 + z * 0.4;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = rotation * uv / (0.65 + z * 0.46);
  vec2 drift = vec2(t * 0.28, -t * 0.21);
  vec2 warp = vec2(cloud(p + drift), cloud(p - drift + vec2(3.7, 1.2))) - 0.5;
  vec2 flow = p + warp * (2.4 + energy * 0.8);
  float field = cloud(flow + drift);
  float gold = smoothstep(0.46, 0.69, field);
  float red = smoothstep(0.50, 0.72, cloud(flow * 0.85 - drift + vec2(1.8, 3.0)));
  vec3 color = mix(uColor1, uGold, gold);
  color = mix(color, uColor2, red * 0.8);
  float ribbon = pow(0.5 + 0.5 * sin(flow.y * 5.0 + warp.x * 7.0 - t * 1.8), 5.0);
  color = mix(color, vec3(1.0, 0.94, 0.78), ribbon * (0.26 + energy * 0.18));
  color *= 0.65 + z * 0.35;
  float light = pow(max(0.0, dot(normalize(vec3(uv, z)), normalize(vec3(-0.5, 0.7, 1.0)))), 14.0);
  color += vec3(0.3, 0.27, 0.21) * light;
  color += vec3(0.22, 0.18, 0.11) * pow(1.0 - z, 4.0);
  gl_FragColor = vec4(pow(max(color, vec3(0.0)), vec3(0.8)), alpha * uOpacity);
}
`;
