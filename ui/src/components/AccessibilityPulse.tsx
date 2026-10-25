import { useEffect, useRef, useState } from "react";
import { Accessibility, Radio, ChevronDown } from "lucide-react";
import { request } from "../lib/api";
import type { BuildingData, AccessibilityResult } from "../types";
type Props = {
  data: BuildingData;
  start: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  result: AccessibilityResult | null;
  onResult: (v: AccessibilityResult | null) => void;
  connected: boolean;
};
export function AccessibilityPulse({
  data,
  start,
  enabled,
  onEnabled,
  result,
  onResult,
  connected,
}: Props) {
  const [width, setWidth] = useState(""),
    [error, setError] = useState(""),
    [change, setChange] = useState("");
  const previous = useRef<{ key: string; count: number } | null>(null);
  const revision = Number(data.building.revision ?? 0),
    buildingId = data.building.id;
  useEffect(() => {
    onResult(null);
    if (!enabled || !start || !connected) return;
    const controller = new AbortController(),
      key = `${buildingId}/${start}/${width}`;
    request<AccessibilityResult>(
      `/buildings/${encodeURIComponent(buildingId)}/accessibility`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start,
          step_free: true,
          min_width_m: width ? Number(width) : null,
        }),
        signal: controller.signal,
      },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.revision !== revision) {
          setError("The building changed. Checking its latest access…");
          return;
        }
        const old = previous.current,
          delta =
            old?.key === key ? value.reachable_space_ids.length - old.count : 0;
        setChange(
          delta
            ? `${Math.abs(delta)} ${delta < 0 ? "fewer" : "more"} spaces reachable after the update`
            : "",
        );
        previous.current = { key, count: value.reachable_space_ids.length };
        setError("");
        onResult(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e.message || "Could not check accessibility.");
      });
    return () => controller.abort();
  }, [buildingId, revision, start, width, enabled, connected, onResult]);
  const room =
    data.spaces.find((s) => s.id === start) ||
    data.spaces.find(
      (s) => s.id === data.assets?.find((a) => a.id === start)?.space_id,
    );
  return (
    <section className="accessibility-pulse" aria-label="Accessibility pulse">
      <label className="pulse-toggle">
        <span className="pulse-icon">
          <Accessibility size={18} />
        </span>
        <span>
          <strong>Accessibility pulse</strong>
          <small>See where you can go without stairs</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={!connected}
          onChange={(e) => onEnabled(e.target.checked)}
        />
      </label>
      {enabled && (
        <div className="pulse-body">
          <p>
            From <strong>{room?.name || "your selected start"}</strong>
          </p>
          {!start ? (
            <p className="pulse-note">
              Choose a starting place above to light up reachable spaces.
            </p>
          ) : (
            <>
              <label>
                Minimum doorway
                <select
                  aria-label="Pulse minimum doorway"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                >
                  <option value="">Any mapped width</option>
                  <option value="0.8">80 cm</option>
                  <option value="0.9">90 cm</option>
                  <option value="1.1">110 cm</option>
                </select>
              </label>
              <div className="pulse-score" role="status">
                <Radio size={18} />
                <strong>
                  {result ? result.reachable_space_ids.length : "—"}
                </strong>
                <span>
                  {result
                    ? "spaces reachable step-free"
                    : "Checking mapped access…"}
                </span>
              </div>
              {error && <p role="status">{error}</p>}
              {change && result && (
                <p className="pulse-change" role="status">
                  {change}
                </p>
              )}
              <div className="pulse-floor-list">
                {result?.floors.map((f) => (
                  <div key={f.floor_id}>
                    <span>{f.name}</span>
                    <span>
                      {f.reachable}/{f.total}
                    </span>
                    <i
                      style={
                        {
                          "--reachable": `${(100 * f.reachable) / Math.max(1, f.total)}%`,
                        } as React.CSSProperties
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="pulse-key">
                <span>Reachable</span>
                <span>Not connected under these filters</span>
              </div>
              <details>
                <summary>
                  <ChevronDown size={12} />
                  What this tells you
                </summary>
                <p>
                  Uses mapped doors, lift connections and active closures.
                  Unreported obstacles, access permissions and missing plan
                  details may remain. Colours do not certify that a space is
                  safe.
                </p>
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
