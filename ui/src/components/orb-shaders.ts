// Adapted from ElevenLabs UI Orb, MIT © 2025 Eleven Labs Inc.
// See THIRD_PARTY_NOTICES.md. Palette and soft circular edge customized for Inside.
export const vertexShader = /* glsl */ `
uniform float uTime;
uniform sampler2D uPerlinTexture;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uAnimation;
uniform float uInverted;
uniform float uOffsets[7];
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uGold;
uniform float uInputVolume;
uniform float uOutputVolume;
uniform float uOpacity;
uniform sampler2D uPerlinTexture;
varying vec2 vUv;

const float PI = 3.14159265358979323846;

// Draw a single oval with soft edges and calculate its gradient color
bool drawOval(vec2 polarUv, vec2 polarCenter, float a, float b, bool reverseGradient, float softness, out vec4 color) {
    vec2 p = polarUv - polarCenter;
    float oval = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);

    float edge = smoothstep(1.0, 1.0 - softness, oval);

    if (edge > 0.0) {
        float gradient = reverseGradient ? (1.0 - (p.x / a + 1.0) / 2.0) : ((p.x / a + 1.0) / 2.0);
        // Flatten gradient toward middle value for more uniform appearance
        gradient = mix(0.5, gradient, 0.1);
        color = vec4(vec3(gradient), 0.85 * edge);
        return true;
    }
    return false;
}

// Map grayscale value to a 4-color ramp (color1, color2, color3, color4)
vec3 colorRamp(float grayscale, vec3 color1, vec3 color2, vec3 color3, vec3 color4) {
    if (grayscale < 0.33) {
        return mix(color1, color2, grayscale * 3.0);
    } else if (grayscale < 0.66) {
        return mix(color2, color3, (grayscale - 0.33) * 3.0);
    } else {
        return mix(color3, color4, (grayscale - 0.66) * 3.0);
    }
}

vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

// 2D noise for the ring
float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    
    vec2 u = f * f * (3.0 - 2.0 * f);
    float n = mix(
        mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
            dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
        mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
            dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
        u.y
    );

    return 0.5 + 0.5 * n;
}

float sharpRing(vec3 decomposed, float time) {
    float ringStart = 1.0;
    float ringWidth = 0.3;
    float noiseScale = 5.0;

    float noise = mix(
        noise2D(vec2(decomposed.x, time) * noiseScale),
        noise2D(vec2(decomposed.y, time) * noiseScale),
        decomposed.z
    );

    noise = (noise - 0.5) * 2.5;

    return ringStart + noise * ringWidth * 1.5;
}

float smoothRing(vec3 decomposed, float time) {
    float ringStart = 0.9;
    float ringWidth = 0.2;
    float noiseScale = 6.0;

    float noise = mix(
        noise2D(vec2(decomposed.x, time) * noiseScale),
        noise2D(vec2(decomposed.y, time) * noiseScale),
        decomposed.z
    );

    noise = (noise - 0.5) * 5.0;

    return ringStart + noise * ringWidth;
}

float flow(vec3 decomposed, float time) {
    return mix(
        texture(uPerlinTexture, vec2(time, decomposed.x / 2.0)).r,
        texture(uPerlinTexture, vec2(time, decomposed.y / 2.0)).r,
        decomposed.z
    );
}

// A softly warped cloud field replaces the reference's radial oval sectors.
// It remains an audio-reactive, palette-controlled adaptation of the orb.
float cloud(vec2 p) {
    return texture(uPerlinTexture, p * 0.19).r * 0.56
         + texture(uPerlinTexture, p * 0.38 + vec2(0.13, 0.37)).r * 0.28
         + texture(uPerlinTexture, p * 0.76 + vec2(0.43, 0.17)).r * 0.16;
}
void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float radius = length(uv);
    float alpha = 1.0 - smoothstep(0.975, 1.0, radius);
    if (alpha < 0.001) discard;
    float z = sqrt(max(0.0, 1.0 - dot(uv, uv)));
    float t = uAnimation * 0.15;
    vec2 p = uv * (1.05 + uInputVolume * 0.3) / (0.7 + z * 0.5);
    vec2 drift = vec2(t, -t * 0.67);
    vec2 warp = vec2(cloud(p + drift), cloud(p + vec2(4.2, 1.7) - drift));
    float field = cloud(p + warp * 1.4 + drift);
    float gold = smoothstep(0.48, 0.70, field);
    float red = smoothstep(0.40, 0.72, cloud(p * 0.75 - warp + vec2(-t, 3.0)));
    vec3 color = mix(uColor1, uGold, gold);
    color = mix(color, uColor2, red * 0.65);
    float light = smoothstep(0.45, 0.78, cloud(p * 1.1 + warp - drift));
    color = mix(color, vec3(0.96, 0.91, 0.80), light * 0.85);
    color *= 0.72 + z * 0.28;
    color += vec3(0.13, 0.11, 0.08) * pow(max(0.0, dot(normalize(vec3(uv, z)), normalize(vec3(-0.5, 0.7, 1.0)))), 8.0);
    color = pow(max(color, vec3(0.0)), vec3(0.75));
    gl_FragColor = vec4(color, alpha * uOpacity);
}
`;
