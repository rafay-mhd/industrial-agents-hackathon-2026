import { Component, memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PulsingBorder } from "@paper-design/shaders-react";
import FlowField from "./FlowField";

const aurora = ["#355cbb", "#b34c62", "#d4ad63", "#8b9fd7"];

class ShaderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Plain WebGL flow field behind the page; Paper Shaders for the voice halo. */
const ShaderSurface = memo(function ShaderSurface({
  kind = "ambient",
  enabled,
  active = false,
}: {
  kind?: "ambient" | "stage" | "halo";
  enabled: boolean;
  active?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const element = host.current;
    const fail = (event: Event) => {
      event.preventDefault();
      setLost(true);
    };
    element?.addEventListener("webglcontextlost", fail, true);
    return () => element?.removeEventListener("webglcontextlost", fail, true);
  }, []);
  return (
    <div
      ref={host}
      className={`shader-surface shader-${kind}`}
      aria-hidden="true"
    >
      {!lost && (
        <ShaderBoundary>
          {kind === "halo" ? (
            <PulsingBorder
              width="100%"
              height="100%"
              colors={aurora}
              colorBack="#00000000"
              roundness={1}
              aspectRatio="square"
              thickness={0.028}
              softness={0.65}
              intensity={0.22}
              bloom={0.18}
              spots={3}
              spotSize={0.38}
              pulse={active ? 0.45 : 0.12}
              smoke={0.18}
              smokeSize={0.35}
              scale={0.8}
              speed={enabled ? (active ? 1.15 : 0.55) : 0}
              frame={12000}
              minPixelRatio={1}
              maxPixelCount={160000}
            />
          ) : (
            <FlowField enabled={enabled} />
          )}
        </ShaderBoundary>
      )}
    </div>
  );
});
export default ShaderSurface;
