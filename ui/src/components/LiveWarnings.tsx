import { useId, useMemo, useRef, useState } from "react";
import {
  Radio,
  Plus,
  TriangleAlert,
  Check,
  MapPin,
  ChevronRight,
  ShieldAlert,
  X,
  Wrench,
  Search,
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
  connected: boolean;
  onReconnect: () => void;
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
  connected,
  onReconnect,
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
    [kind, setKind] = useState("other"),
    [blocks, setBlocks] = useState(false),
    [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);
  const resolvingRef = useRef(false);
  const [resolution, setResolution] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const helpId = useId();
  const messageInput = useRef<HTMLTextAreaElement>(null),
    targetInput = useRef<HTMLSelectElement>(null);
  const items = useMemo(() => warningPlaces(data), [data]);
  const liftIds = new Set(
    (data.vertical_connectors ?? [])
      .filter((c) => c.kind === "lift")
      .map((c) => c.id),
  );
  const asset = data.assets?.find((a) => a.id === target);
  const options = items.filter(
    (i) =>
      (kind !== "lift_outage" || liftIds.has(i.id)) &&
      (kind !== "blocked_access" || !data.assets?.some((a) => a.id === i.id)) &&
      (i.id === target ||
        query
          .toLowerCase()
          .split(/\s+/)
          .every((w) => i.label.toLowerCase().includes(w))),
  );
  const active = warningsOf(data).filter((w) => w.status === "active");
  const resolved = warningsOf(data)
    .filter((w) => w.status === "resolved")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const resolveIssue = async (id: string) => {
    if (busy || !connected || resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(id);
    setResolution(null);
    try {
      const ok = await onResolve(id);
      setResolution({
        ok,
        message: ok
          ? "Report marked resolved. Other active reports still apply."
          : "Could not resolve this issue. It is still active; please try again.",
      });
    } catch {
      setResolution({
        ok: false,
        message:
          "Could not resolve this issue. It is still active; please try again.",
      });
    } finally {
      resolvingRef.current = false;
      setResolving(null);
    }
  };
  const needs = !message.trim()
    ? "Describe what happened, then choose the affected place or item."
    : !target
      ? "Choose the affected place or item in “Where exactly?” before posting."
      : "Your report will be visible to everyone viewing this building.";
  return (
    <section
      id="community-warnings"
      className="live-warnings"
      aria-label="Live community warnings"
    >
      <button
        className="live-warnings-heading"
        type="button"
        aria-expanded={open}
        aria-controls={helpId + "-content"}
        onClick={() => setOpen(!open)}
      >
        <span
          className={`broadcast-dot ${status === "live" ? "connected" : ""}`}
        >
          <Radio size={16} />
        </span>
        <strong>Warnings</strong>
        <span className="live-warning-count">
          {active.length ? `${active.length} active` : "No reports"}
        </span>
        <ChevronRight size={14} className={open ? "turned" : ""} />
      </button>
      {open && (
        <div className="warning-content" id={helpId + "-content"}>
          <p className="warning-intro">
            Reports from people in this building
            <span>{data.building.name}</span>
            <span>
              {!connected
                ? "Offline · showing reports from the loaded map"
                : status === "live"
                  ? "Connected · updates arrive live"
                  : "Reconnecting · checking for updates"}
            </span>
          </p>
          {!connected && (
            <button className="reconnect-warnings" onClick={onReconnect}>
              Reconnect to shared warnings
            </button>
          )}
          <div
            className="warning-list"
            aria-live="polite"
            aria-label="Reports from other visitors"
          >
            {!active.length && (
              <div className="warning-empty">
                <Check size={17} />
                <span>
                  No active reports for this building.
                  <small>
                    {connected
                      ? "New reports from other visitors appear here automatically."
                      : "Reconnect to load the latest shared reports."}
                  </small>
                </span>
              </div>
            )}
            {[...active].reverse().map((w) => (
              <article
                key={w.id}
                className={`warning-card ${w.blocks_route || w.asset_unavailable ? "blocking" : "caution"}`}
              >
                <div className="warning-card-title">
                  {w.asset_unavailable ? (
                    <Wrench size={16} />
                  ) : w.blocks_route ? (
                    <ShieldAlert size={16} />
                  ) : (
                    <TriangleAlert size={16} />
                  )}
                  <strong>{w.label}</strong>
                  <span>
                    {w.asset_unavailable
                      ? "Unavailable"
                      : w.blocks_route
                        ? "Avoided"
                        : "Notice"}
                  </span>
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
                  <button
                    type="button"
                    disabled={busy || !connected || resolving !== null}
                    onClick={() => void resolveIssue(w.id)}
                  >
                    <Check size={12} />
                    {resolving === w.id ? "Resolving…" : "Mark resolved"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {resolution && (
            <p
              className={`warning-resolution ${resolution.ok ? "success" : "error"}`}
              role={resolution.ok ? "status" : "alert"}
            >
              {resolution.message}
            </p>
          )}
          {resolved.length > 0 && (
            <details className="resolved-warnings">
              <summary>Resolved issues · {resolved.length}</summary>
              <div className="warning-list" aria-label="Resolved reports">
                {resolved.map((w) => (
                  <article key={w.id} className="warning-card resolved">
                    <div className="warning-card-title">
                      <Check size={16} />
                      <strong>{w.label}</strong>
                      <span>Resolved</span>
                    </div>
                    <p>{w.message}</p>
                    <small>
                      Resolved {relativeReportTime(w.updated_at)} · Reported by{" "}
                      {w.reporter}
                    </small>
                  </article>
                ))}
              </div>
            </details>
          )}
          {!form ? (
            <button
              className="report-warning-button"
              type="button"
              onClick={() => {
                setTarget(items.some((i) => i.id === selected) ? selected : "");
                setQuery("");
                setKind("other");
                setBlocks(false);
                setError("");
                setForm(true);
              }}
            >
              <Plus size={15} />
              Report anything
            </button>
          ) : (
            <form
              className="warning-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!connected || busy) return;
                if (
                  !message.trim() ||
                  !target ||
                  !options.some((i) => i.id === target)
                ) {
                  setError(needs);
                  if (!message.trim()) messageInput.current?.focus();
                  else targetInput.current?.focus();
                  return;
                }
                setError("");
                if (
                  await onPost({
                    element_id: target,
                    kind,
                    message,
                    reporter: reporter || "Visitor",
                    blocks_route: kind === "lift_outage" || (!asset && blocks),
                  })
                ) {
                  setForm(false);
                  setMessage("");
                } else
                  setError(
                    "The report was not saved. Please try again; your details are still here.",
                  );
              }}
            >
              <div className="warning-form-title">
                <strong>Describe it in your own words</strong>
                <button
                  type="button"
                  aria-label="Cancel warning report"
                  onClick={() => setForm(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <label>
                What happened?
                <textarea
                  ref={messageInput}
                  required
                  maxLength={280}
                  rows={3}
                  disabled={busy}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Coffee machine not working, 3D printer jammed, wet stairs…"
                />
              </label>
              <label>
                How does it affect people?
                <select
                  value={kind}
                  disabled={busy}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setBlocks(e.target.value === "blocked_access");
                    if (
                      e.target.value === "lift_outage" &&
                      !liftIds.has(target)
                    )
                      setTarget("");
                    if (e.target.value === "blocked_access" && asset)
                      setTarget("");
                  }}
                >
                  <option value="other">Information / something else</option>
                  <option value="equipment_outage">
                    Equipment not working
                  </option>
                  <option value="hazard">Hazard — use caution</option>
                  <option value="blocked_access">Access is blocked</option>
                  <option value="lift_outage">Lift not working</option>
                </select>
              </label>
              <label>
                <span>
                  <Search size={11} /> Find the place or object
                </span>
                <input
                  disabled={busy}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search printer, coffee, stairs, room…"
                />
              </label>
              <label>
                Where exactly?
                <select
                  ref={targetInput}
                  aria-describedby={helpId}
                  required
                  disabled={busy}
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    if (data.assets?.some((a) => a.id === e.target.value))
                      setBlocks(false);
                  }}
                >
                  <option value="">Choose a mapped place or item</option>
                  {options.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
                <small>
                  If the object isn’t mapped, choose its room and describe it.
                </small>
              </label>
              <label>
                Your name <small>(optional, visible with your report)</small>
                <input
                  maxLength={40}
                  disabled={busy}
                  value={reporter}
                  onChange={(e) => setReporter(e.target.value)}
                  placeholder="Visitor"
                />
              </label>
              {asset ? (
                <p className="equipment-report-note">
                  <Wrench size={13} />
                  {kind === "equipment_outage"
                    ? "This item is excluded from nearest-item searches. The room remains accessible."
                    : "This notice is attached to the item. Choose “Equipment not working” to exclude it from searches."}
                </p>
              ) : (
                <label className="warning-avoid">
                  <input
                    type="checkbox"
                    disabled={busy || kind === "lift_outage"}
                    checked={kind === "lift_outage" || blocks}
                    onChange={(e) => setBlocks(e.target.checked)}
                  />
                  <span>
                    Avoid this passage or area
                    <small>
                      {kind === "lift_outage"
                        ? "The lift is avoided on every floor."
                        : "Leave unchecked for a caution that people can pass."}
                    </small>
                  </span>
                </label>
              )}
              <p className="warning-form-help" id={helpId} role="status">
                {!connected
                  ? "Reconnect to post a shared warning."
                  : busy
                    ? "Finishing the current building update. You can still read other visitors’ reports above."
                    : needs}
              </p>
              {error && (
                <p className="warning-form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="publish-warning"
                disabled={busy || !connected}
              >
                <Radio size={14} />
                {busy ? "Please wait…" : "Post live warning"}
              </button>
            </form>
          )}
          <p className="warning-note">
            Community reports stay active until marked resolved.
          </p>
        </div>
      )}
    </section>
  );
}
