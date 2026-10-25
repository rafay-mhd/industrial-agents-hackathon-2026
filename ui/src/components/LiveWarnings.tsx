import { useMemo, useState } from "react";
import {
  Radio,
  Plus,
  TriangleAlert,
  Check,
  MapPin,
  ChevronRight,
  ShieldAlert,
  X,
} from "lucide-react";
import type { BuildingData } from "../types";
import {
  relativeReportTime,
  warningPlaces,
  warningsOf,
} from "../lib/liveWarnings";
type Props = {
  data: BuildingData;
  busy: boolean;
  status: string;
  selected: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  onPost: (body: Record<string, unknown>) => Promise<boolean>;
  onResolve: (id: string) => Promise<boolean>;
  onLocate: (id: string) => void;
};
export function LiveWarnings({
  data,
  busy,
  status,
  selected,
  open,
  setOpen,
  onPost,
  onResolve,
  onLocate,
}: Props) {
  const [form, setForm] = useState(false),
    [target, setTarget] = useState(""),
    [message, setMessage] = useState(""),
    [reporter, setReporter] = useState(""),
    [kind, setKind] = useState("lift_outage"),
    [blocks, setBlocks] = useState(true);
  const items = useMemo(() => warningPlaces(data), [data]);
  const liftIds = new Set(
    (data.vertical_connectors ?? [])
      .filter((c) => c.kind === "lift")
      .map((c) => c.id),
  );
  const placeOptions =
    kind === "lift_outage" ? items.filter((i) => liftIds.has(i.id)) : items;
  const active = warningsOf(data).filter((w) => w.status === "active");
  return (
    <section className="live-warnings" aria-label="Live community warnings">
      <button
        className="live-warnings-heading"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span
          className={`broadcast-dot ${status === "live" ? "connected" : ""}`}
        >
          <Radio size={16} />
        </span>
        <strong>Live Warn</strong>
        <span className="live-warning-count">
          {active.length ? `${active.length} active` : "No reports"}
        </span>
        <ChevronRight size={14} className={open ? "turned" : ""} />
      </button>
      {open && (
        <div className="warning-content">
          <p className="warning-intro">
            Help the next person find their way.
            <span>
              {status === "live"
                ? "Connected · updates arrive live"
                : "Reconnecting · checking for updates"}
            </span>
          </p>
          {!form ? (
            <button
              className="report-warning-button"
              onClick={() => {
                setTarget(
                  selected && items.some((i) => i.id === selected)
                    ? selected
                    : "",
                );
                setKind(
                  liftIds.has(selected) ? "lift_outage" : "blocked_access",
                );
                setBlocks(true);
                setForm(true);
              }}
            >
              <Plus size={15} />
              Report a problem
            </button>
          ) : (
            <form
              className="warning-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await onPost({
                    element_id: target,
                    kind,
                    message,
                    reporter: reporter || "Visitor",
                    blocks_route: kind === "lift_outage" || blocks,
                  })
                ) {
                  setForm(false);
                  setMessage("");
                }
              }}
            >
              <div className="warning-form-title">
                <strong>What did you notice?</strong>
                <button
                  type="button"
                  aria-label="Cancel warning report"
                  onClick={() => setForm(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <label>
                Where?
                <select
                  required
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose a place or connection</option>
                  {placeOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select
                  value={kind}
                  disabled={busy}
                  onChange={(e) => {
                    setKind(e.target.value);
                    if (
                      e.target.value === "lift_outage" &&
                      !liftIds.has(target)
                    )
                      setTarget("");
                    setBlocks(!["hazard", "other"].includes(e.target.value));
                  }}
                >
                  <option value="lift_outage">Lift not working</option>
                  <option value="blocked_access">Blocked access</option>
                  <option value="hazard">Hazard / use caution</option>
                  <option value="other">Something else</option>
                </select>
              </label>
              <label>
                Details
                <textarea
                  required
                  maxLength={280}
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                  placeholder="e.g. The lift doors won’t open on this floor."
                />
              </label>
              <label>
                Your name <small>(optional, shown with your report)</small>
                <input
                  maxLength={40}
                  value={reporter}
                  onChange={(e) => setReporter(e.target.value)}
                  disabled={busy}
                  placeholder="Visitor"
                />
              </label>
              <label className="warning-avoid">
                <input
                  type="checkbox"
                  disabled={busy || kind === "lift_outage"}
                  checked={kind === "lift_outage" || blocks}
                  onChange={(e) => setBlocks(e.target.checked)}
                />
                <span>
                  Route around this place
                  <small>
                    {kind === "lift_outage"
                      ? "The lift is avoided on every floor."
                      : "Unchecked warnings are shown as cautions."}
                  </small>
                </span>
              </label>
              <button
                className="publish-warning"
                disabled={busy || !target || !message.trim()}
              >
                <Radio size={14} />
                {busy ? "Posting…" : "Post live warning"}
              </button>
            </form>
          )}
          <div className="warning-list" aria-live="polite">
            {!active.length && (
              <div className="warning-empty">
                <Check size={17} />
                <span>
                  No active reports.
                  <small>Spot a problem? Let people know here.</small>
                </span>
              </div>
            )}
            {[...active].reverse().map((w) => (
              <article
                key={w.id}
                className={`warning-card ${w.blocks_route ? "blocking" : "caution"}`}
              >
                <div className="warning-card-title">
                  {w.blocks_route ? (
                    <ShieldAlert size={16} />
                  ) : (
                    <TriangleAlert size={16} />
                  )}
                  <strong>{w.label}</strong>
                  <span>{w.blocks_route ? "Avoided" : "Caution"}</span>
                </div>
                <p>{w.message}</p>
                <small>
                  Reported by {w.reporter} · {relativeReportTime(w.created_at)}
                </small>
                <div className="warning-card-actions">
                  <button onClick={() => onLocate(w.element_id)}>
                    <MapPin size={12} />
                    Show on map
                  </button>
                  <button disabled={busy} onClick={() => void onResolve(w.id)}>
                    <Check size={12} />
                    Mark resolved
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="warning-note">
            Community reports stay active until someone marks them resolved.
          </p>
        </div>
      )}
    </section>
  );
}
