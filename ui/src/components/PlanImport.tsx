import { useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle, RotateCcw, ScanLine } from "lucide-react";
import { API, request } from "../lib/api";
import type { BuildingData } from "../types";

type Page = {
  index: number;
  width: number;
  height: number;
  name: string;
  url: string;
};
type Scale = {
  a: [number, number] | null;
  b: [number, number] | null;
  length: string;
  level: number;
  height: number;
  name: string;
  stepFree: boolean;
};
export function PlanImport({
  onCreated,
}: {
  onCreated: (data: BuildingData, warnings: string[]) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const [upload, setUpload] = useState<{
    upload_id: string;
    pages: Page[];
  } | null>(null);
  const [scales, setScales] = useState<Scale[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const change = (index: number, patch: Partial<Scale>) =>
    setScales((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  const preview = async (files: FileList | null) => {
    if (!files?.length) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy("Preparing your plans…");
    setError("");
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const result = await request<{ upload_id: string; pages: Page[] }>(
        "/imports/preview",
        { method: "POST", body: form, signal: controller.signal },
      );
      setUpload(result);
      setScales(
        result.pages.map((_, i) => ({
          a: null,
          b: null,
          length: "",
          level: i,
          height: 3,
          name: i ? "Floor " + i : "Ground floor",
          stepFree: false,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read these plans.");
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  };
  const build = async () => {
    if (!upload) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy("Reading rooms, tracing doors and building your map…");
    setError("");
    try {
      const result = await request<{
        building: BuildingData;
        warnings: string[];
      }>("/imports/build", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upload_id: upload.upload_id,
          name: upload.pages[0].name.replace(/\.[^.]+$/, "") || "My building",
          floors: scales.map((s, i) => ({
            page: upload.pages[i].index,
            a: s.a,
            b: s.b,
            length_m: Number(s.length),
            level: s.level,
            height_m: s.height,
            name: s.name,
            verified_step_free: s.stepFree,
          })),
        }),
      });
      if (!controller.signal.aborted)
        await onCreated(result.building, result.warnings);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not create a draft. Try a clearer plan.",
      );
    } finally {
      setBusy("");
    }
  };
  const ready =
    !!upload &&
    scales.every((s) => s.a && s.b && Number(s.length) > 0.1 && s.height >= 2);
  return (
    <section className="plan-import">
      <div className="plan-import-title">
        <Camera size={22} />
        <div>
          <strong>Start with a floor plan</strong>
          <p>Images, camera captures or a PDF. Up to 12 floors.</p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,application/pdf"
        hidden
        onChange={(e) => void preview(e.target.files)}
      />
      <button
        className="subtle-button"
        disabled={!!busy}
        onClick={() => input.current?.click()}
      >
        <ScanLine size={16} />
        Choose floor plans
      </button>
      {upload && (
        <>
          <p className="fine-print">
            Mark the two ends of a known wall, then enter its length. On each
            floor, use the same physical reference line and direction to align
            the plans. Use flat, top-down images; perspective photos distort
            distances.
          </p>
          {upload.pages.map((page, i) => {
            const s = scales[i];
            return (
              <div className="plan-calibration" key={page.index}>
                <div className="plan-floor-heading">
                  <strong>Plan {i + 1}</strong>
                  <button
                    aria-label={`Reset measurements on plan ${i + 1}`}
                    onClick={() => change(i, { a: null, b: null })}
                    disabled={!!busy}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
                <svg
                  role="img"
                  aria-label={`Plan ${i + 1}: click two ends of a known wall`}
                  viewBox={`0 0 ${page.width} ${page.height}`}
                  style={{ aspectRatio: `${page.width}/${page.height}` }}
                  onClick={(e) => {
                    if (busy) return;
                    const r = e.currentTarget.getBoundingClientRect(),
                      p: [number, number] = [
                        (e.clientX - r.left) / r.width,
                        (e.clientY - r.top) / r.height,
                      ];
                    change(i, !s.a || s.b ? { a: p, b: null } : { b: p });
                  }}
                >
                  <image
                    href={API + page.url}
                    width={page.width}
                    height={page.height}
                  />
                  {s.a && s.b && (
                    <line
                      x1={s.a[0] * page.width}
                      y1={s.a[1] * page.height}
                      x2={s.b[0] * page.width}
                      y2={s.b[1] * page.height}
                      stroke="#c99835"
                      strokeWidth={page.width * 0.007}
                    />
                  )}
                  {[s.a, s.b].map(
                    (p, n) =>
                      p && (
                        <g key={n}>
                          <circle
                            cx={p[0] * page.width}
                            cy={p[1] * page.height}
                            r={page.width * 0.017}
                            fill={n ? "#a52b40" : "#29478e"}
                            stroke="white"
                            strokeWidth={page.width * 0.004}
                          />
                          <text
                            x={p[0] * page.width}
                            y={p[1] * page.height}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="white"
                            fontSize={page.width * 0.02}
                          >
                            {n + 1}
                          </text>
                        </g>
                      ),
                  )}
                </svg>
                <p className="fine-print">
                  {!s.a
                    ? "Tap the first end of your reference wall."
                    : !s.b
                      ? "Now tap its other end."
                      : "Reference line marked. Enter the real length below."}
                </p>
                <div className="plan-fields">
                  <label>
                    Known length (m)
                    <input
                      type="number"
                      min=".11"
                      max="1000"
                      step=".01"
                      value={s.length}
                      disabled={!!busy}
                      onChange={(e) => change(i, { length: e.target.value })}
                    />
                  </label>
                  <label>
                    Floor level
                    <input
                      type="number"
                      min="-20"
                      max="200"
                      value={s.level}
                      disabled={!!busy}
                      onChange={(e) =>
                        change(i, { level: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Floor height (m)
                    <input
                      type="number"
                      min="2"
                      max="30"
                      step=".1"
                      value={s.height}
                      disabled={!!busy}
                      onChange={(e) =>
                        change(i, { height: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Floor name
                    <input
                      value={s.name}
                      maxLength={160}
                      disabled={!!busy}
                      onChange={(e) => change(i, { name: e.target.value })}
                    />
                  </label>
                </div>
                <label className="plan-accessibility">
                  <input
                    type="checkbox"
                    checked={s.stepFree}
                    disabled={!!busy}
                    onChange={(e) => change(i, { stepFree: e.target.checked })}
                  />
                  I’ve verified that this floor’s doorways have no steps
                </label>
              </div>
            );
          })}
          <button
            className="primary-button"
            disabled={!ready || !!busy}
            onClick={() => void build()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ScanLine size={16} />
            )}
            Create building & connect agent
          </button>
          <p className="fine-print">
            Creates a draft from your plans using Claude. Review inferred rooms,
            doors and floor connections before navigating. Your calibrated scale
            determines distances.
          </p>
        </>
      )}
      {busy && (
        <p role="status" className="sheet-notice">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="sheet-notice">
          {error}
        </p>
      )}
    </section>
  );
}
