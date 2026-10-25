import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { vertexShader, fragmentShader } from "./orb-shaders";

export type VoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "hearing"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export default function VoiceOrb({
  phase,
  input,
  output,
  animated = true,
}: {
  phase: VoicePhase;
  input: MutableRefObject<number>;
  output: MutableRefObject<number>;
  animated?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const motionRef = useRef(animated);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    motionRef.current = animated;
  }, [animated]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    // Report failure of the external graphics context with a CSS fallback.
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      // oxlint-disable-next-line react/set-state-in-effect -- Report external WebGL initialization failure.
      setFallback(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera(-1.03, 1.03, 1.03, -1.03, 0.1, 10);
    camera.position.z = 2;
    // Local, deterministic periodic noise. No CDN request or third-party tracking.
    const size = 128,
      pixels = new Uint8Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2,
          v = (y / size) * Math.PI * 2;
        pixels[y * size + x] = Math.round(
          128 +
            42 * Math.sin(u + Math.cos(v * 2)) +
            30 * Math.cos(v * 3 - Math.sin(u * 2)) +
            18 * Math.sin(u * 5 + v * 4),
        );
      }
    const noise = new THREE.DataTexture(pixels, size, size, THREE.RedFormat);
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    noise.magFilter = noise.minFilter = THREE.LinearFilter;
    noise.needsUpdate = true;
    const uniforms = {
      uColor1: { value: new THREE.Color("#2755bc") },
      uColor2: { value: new THREE.Color("#b33f59") },
      uGold: { value: new THREE.Color("#ecd19a") },
      uPerlinTexture: { value: noise },
      uAnimation: { value: 0.7 },
      uInputVolume: { value: 0 },
      uOutputVolume: { value: 0 },
      uOpacity: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    let visible = true,
      dirty = true;
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      dirty = true;
    });
    visibility.observe(element);
    const resize = new ResizeObserver(() => {
      const r = element.getBoundingClientRect();
      renderer.setSize(r.width, r.height);
      dirty = true;
    });
    resize.observe(element);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      last = performance.now();
    const animate = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!document.hidden && visible) {
        const moving = !reduced.matches && motionRef.current;
        if (moving) {
          const busy = ["thinking", "transcribing", "connecting"].includes(
            phaseRef.current,
          );
          const speaking = phaseRef.current === "speaking";
          const listening = ["listening", "hearing"].includes(phaseRef.current);
          uniforms.uAnimation.value +=
            delta *
            ((speaking ? 0.9 : busy ? 0.65 : listening ? 0.5 : 0.32) +
              output.current * 1.4 +
              input.current * 0.9);
          uniforms.uInputVolume.value +=
            (input.current - uniforms.uInputVolume.value) * 0.14;
          uniforms.uOutputVolume.value +=
            (output.current - uniforms.uOutputVolume.value) * 0.14;
        }
        if (moving || dirty) renderer.render(scene, camera);
        dirty = false;
      }
      frame = requestAnimationFrame(animate);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      setFallback(true);
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      geometry.dispose();
      material.dispose();
      noise.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [input, output]);
  return (
    <div
      className={`orb-shell phase-${phase}`}
      data-animated={animated}
      aria-hidden="true"
    >
      <div className="orb-halo" />
      <div
        className={`orb-render ${fallback ? "orb-fallback" : ""}`}
        ref={host}
      />
      <span className="orb-glint" />
    </div>
  );
}
