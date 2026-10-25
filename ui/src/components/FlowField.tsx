import { memo, useEffect, useRef } from "react";
import fragmentSource from "./flow-field.frag?raw";

const vertexSource = `attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
// Muted gold → warm ivory, with enough separation to see the moving flow.
const colors = new Float32Array([
  0.733,
  0.627,
  0.443, // #bba071
  0.871,
  0.784,
  0.631, // #dec8a1
  0.937,
  0.882,
  0.78, // #efe1c7
  0.984,
  0.957,
  0.914, // #fbf4e9
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
]);

/** The supplied 21st.dev flow shader, drawn by a plain WebGL1 fullscreen triangle. */
const FlowField = memo(function FlowField({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enabledRef = useRef(enabled);
  const syncRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    enabledRef.current = enabled;
    syncRef.current?.();
  }, [enabled]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) return;
    const shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    const release = () => {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
    };
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error("Shader allocation failed");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(shader) || "Shader compilation failed",
        );
      return shader;
    };
    try {
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      if (!program) throw new Error("Shader program allocation failed");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(
          gl.getProgramInfoLog(program) || "Shader linking failed",
        );
      gl.useProgram(program);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error("Shader buffer allocation failed");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      const attribute = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    } catch (error) {
      console.warn(
        "Flow background unavailable; using the static ivory fallback.",
        error,
      );
      release();
      return;
    }
    const uniform = (name: string) => gl.getUniformLocation(program!, name);
    gl.uniform3fv(uniform("u_colors[0]"), colors);
    gl.uniform4f(uniform("u_shape"), 1.26, 0.62, 0.63, 0.03);
    gl.uniform4f(uniform("u_surface"), 3.36, 0.94, 0, 1);
    // Original flow recipe, with gentler vignette/grain for text legibility.
    gl.uniform4f(uniform("u_finish"), 0, 0.08, 0.004, 0.015);
    gl.uniform4f(uniform("u_transform"), 4678, 2.3, 0, 0);
    gl.uniform4f(uniform("u_space"), -0.11, 0.15, 0, 0);
    gl.uniform4f(uniform("u_cursor"), 0, 2, 0.65, 0.46);
    const scene = uniform("u_scene");
    let frame = 0,
      time = 20,
      last = 0,
      lastPaint = 0,
      visible = true,
      lost = false;
    const draw = () => {
      if (lost) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform4f(scene, canvas.width, canvas.height, time * -0.84, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.style.opacity = "1";
    };
    const running = () =>
      enabledRef.current && visible && !document.hidden && !lost;
    const tick = (now: number) => {
      frame = 0;
      if (!running()) return;
      time += Math.min((now - last) / 1000, 0.1);
      last = now;
      if (now - lastPaint >= 1000 / 30) {
        draw();
        lastPaint = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = performance.now();
      if (running()) frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(() => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      // The atmosphere gets a small pixel budget; keep GPU capacity for the 3D map.
      const ratio = Math.min(
        devicePixelRatio,
        2,
        Math.sqrt(180000 / (width * height)),
      );
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      if (!document.hidden && visible) draw();
    });
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !document.hidden) draw();
      sync();
    });
    const onLoss = (event: Event) => {
      event.preventDefault();
      lost = true;
      canvas.style.opacity = "0";
      sync();
    };
    resize.observe(canvas);
    visibility.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    canvas.addEventListener("webglcontextlost", onLoss);
    syncRef.current = sync;
    sync();
    return () => {
      cancelAnimationFrame(frame);
      syncRef.current = null;
      resize.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("webglcontextlost", onLoss);
      canvas.style.opacity = "0";
      release();
    };
  }, []);
  return (
    <canvas ref={canvasRef} className="flow-field-canvas" aria-hidden="true" />
  );
});
export default FlowField;
