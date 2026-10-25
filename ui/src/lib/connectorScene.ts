import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ConnectorLayout, ConnectorSpan } from "./connectorLayout";
import type { Selection } from "../components/IndoorMap";

type Mode = "building" | "connected" | "floors" | "inside";
/** Representative stairs/shafts connect measured floor elevations; exploded gaps stay schematic. */
export function createConnectorScene(
  layout: ConnectorLayout,
  labelHost: HTMLDivElement,
  onSelect: (s: Selection) => void,
) {
  const resources: { dispose(): void }[] = [],
    keep = <T extends { dispose(): void }>(v: T) => {
      resources.push(v);
      return v;
    };
  const group = new THREE.Group(),
    picks: THREE.Object3D[] = [];
  const color = layout.connector.kind === "lift" ? "#345d9f" : "#b08b43";
  const accent = keep(
    new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.3 }),
  );
  const tread = keep(
    new THREE.MeshStandardMaterial({ color: "#e5d7b9", roughness: 0.7 }),
  );
  const glass = keep(
    new THREE.MeshStandardMaterial({
      color: "#a8cedb",
      roughness: 0.15,
      metalness: 0.05,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const metallic = keep(
    new THREE.MeshStandardMaterial({
      color: "#a8b3c1",
      roughness: 0.3,
      metalness: 0.65,
    }),
  );
  const mesh = (
    g: THREE.BufferGeometry,
    m: THREE.Material,
    parent: THREE.Object3D,
  ) => {
    const part = new THREE.Mesh(keep(g), m);
    part.castShadow = m !== glass;
    part.receiveShadow = true;
    part.userData = { kind: "connector", id: layout.connector.id };
    parent.add(part);
    picks.push(part);
    return part;
  };
  const models = layout.spans.map((span) => {
    const core = new THREE.Group(),
      upper = new THREE.Group();
    group.add(core, upper);
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const batch = batches.get(material) ?? [];
      batch.push(geometry);
      batches.set(material, batch);
    };
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
    ) => add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), mat);
    const beam = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      r: number,
      mat: THREE.Material,
    ) => {
      const delta = b.clone().sub(a),
        g = new THREE.CylinderGeometry(r, r, delta.length(), 8);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          delta.normalize(),
        ),
      );
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      add(g, mat);
    };
    const fp = span.footprint;
    if (fp) {
      core.position.set(fp.center[0], span.from.elevation, -fp.center[1]);
      core.rotation.y = fp.angle;
      upper.position.set(fp.center[0], span.to.elevation, -fp.center[1]);
      upper.rotation.y = fp.angle;
      const w = fp.width,
        d = fp.depth,
        h = span.rise;
      if (layout.connector.kind === "stairs") {
        const count = Math.max(4, Math.min(36, Math.ceil(h / 0.18 / 2))),
          run = d * 0.68,
          z0 = -d * 0.42,
          flightWidth = w * 0.43;
        for (let flight = 0; flight < 2; flight++) {
          const x = (flight === 0 ? -0.26 : 0.26) * w;
          for (let i = 0; i < count; i++) {
            const y = (h * (flight + (i + 1) / count)) / 2,
              z =
                flight === 0
                  ? z0 + ((i + 0.5) * run) / count
                  : z0 + run - ((i + 0.5) * run) / count;
            box(x, y - 0.055, z, flightWidth, 0.11, run / count + 0.015, tread);
            box(
              x,
              y - h / count / 4,
              z + ((flight === 0 ? -1 : 1) * run) / count / 2,
              flightWidth,
              h / count / 2,
              0.025,
              tread,
            );
          }
          const start = new THREE.Vector3(
              x,
              (h * flight) / 2,
              z0 + (flight === 0 ? 0 : run),
            ),
            end = new THREE.Vector3(
              x,
              (h * (flight + 1)) / 2,
              z0 + (flight === 0 ? run : 0),
            );
          beam(
            start.clone().add(new THREE.Vector3(0, -0.12, 0)),
            end.clone().add(new THREE.Vector3(0, -0.12, 0)),
            0.07,
            metallic,
          );
          for (const side of [-1, 1]) {
            const offset = side * flightWidth * 0.46;
            for (let i = 0; i <= 4; i++) {
              const p = start
                .clone()
                .lerp(end, i / 4)
                .add(new THREE.Vector3(offset, 0, 0));
              beam(
                p,
                p.clone().add(new THREE.Vector3(0, 0.85, 0)),
                0.022,
                accent,
              );
            }
            beam(
              start.clone().add(new THREE.Vector3(offset, 0.85, 0)),
              end.clone().add(new THREE.Vector3(offset, 0.85, 0)),
              0.03,
              accent,
            );
          }
        }
        box(0, h / 2 - 0.06, d * 0.375, w, 0.12, d * 0.25, tread);
        const landing = mesh(
          new THREE.BoxGeometry(w * 0.48, 0.12, d * 0.16),
          tread,
          upper,
        );
        landing.position.set(w * 0.26, -0.06, -d * 0.42);
      } else {
        // Continuous transparent shaft; no animated car or invented live lift state.
        for (const x of [-w * 0.47, w * 0.47])
          for (const z of [-d * 0.47, d * 0.47])
            box(x, h / 2, z, 0.07, h, 0.07, accent);
        box(0, h / 2, d * 0.47, w, h, 0.025, glass);
        box(-w * 0.47, h / 2, 0, 0.025, h, d, glass);
        box(w * 0.47, h / 2, 0, 0.025, h, d, glass);
        for (const y of [0, h]) {
          box(0, y + 0.045, d * 0.47, w, 0.09, 0.08, accent);
          box(0, y + 0.045, -d * 0.47, w, 0.09, 0.08, accent);
        }
        const doorwayHeight = Math.min(2.15, h * 0.8),
          doorWidth = Math.min(1.5, w * 0.7);
        for (const parent of [core, upper]) {
          const door = mesh(
            new THREE.BoxGeometry(doorWidth, doorwayHeight, 0.07),
            metallic,
            parent,
          );
          door.position.set(0, doorwayHeight / 2, -d * 0.47);
          const seam = mesh(
            new THREE.BoxGeometry(0.018, doorwayHeight, 0.075),
            accent,
            parent,
          );
          seam.position.copy(door.position);
          for (const x of [-doorWidth / 2 - 0.045, doorWidth / 2 + 0.045]) {
            const jamb = mesh(
              new THREE.BoxGeometry(0.09, doorwayHeight + 0.13, 0.1),
              accent,
              parent,
            );
            jamb.position.set(x, doorwayHeight / 2, -d * 0.47);
          }
          const lintel = mesh(
            new THREE.BoxGeometry(doorWidth + 0.18, 0.1, 0.1),
            accent,
            parent,
          );
          lintel.position.set(0, doorwayHeight + 0.03, -d * 0.47);
        }
      }
      if (layout.connector.kind === "lift" && span.terminal) {
        const capHeight = 2.4;
        for (const x of [-w * 0.47, w * 0.47])
          for (const z of [-d * 0.47, d * 0.47]) {
            const post = mesh(
              new THREE.BoxGeometry(0.07, capHeight, 0.07),
              accent,
              upper,
            );
            post.position.set(x, capHeight / 2, z);
          }
        const back = mesh(
          new THREE.BoxGeometry(w, capHeight, 0.025),
          glass,
          upper,
        );
        back.position.set(0, capHeight / 2, d * 0.47);
        for (const x of [-w * 0.47, w * 0.47]) {
          const side = mesh(
            new THREE.BoxGeometry(0.025, capHeight, d),
            glass,
            upper,
          );
          side.position.set(x, capHeight / 2, 0);
        }
        const cap = mesh(new THREE.BoxGeometry(w, 0.08, d), glass, upper);
        cap.position.y = capHeight;
      }
      if (layout.connector.kind === "lift") {
        const threshold = mesh(
          new THREE.BoxGeometry(w * 0.75, 0.1, d * 0.12),
          tread,
          upper,
        );
        threshold.position.set(0, -0.05, -d * 0.47);
      }
      for (const [m, parts] of batches) {
        const merged = mergeGeometries(parts);
        parts.forEach((g) => g.dispose());
        if (merged) mesh(merged, m, core);
      }
    }
    // A visible dashed tube fills ONLY artificial exploded gaps or genuinely offset source stops.
    const linkGeometry = keep(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]),
    );
    const linkMaterial = keep(
      new THREE.LineDashedMaterial({
        color,
        dashSize: 0.28,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.85,
      }),
    );
    const link = new THREE.Line(linkGeometry, linkMaterial);
    group.add(link);
    const endpointGeometry = keep(new THREE.SphereGeometry(0.18, 10, 8));
    const endpoints = [0, 1].map(() => {
      const m = new THREE.Mesh(endpointGeometry, accent);
      m.userData = { kind: "connector", id: layout.connector.id };
      group.add(m);
      picks.push(m);
      return m;
    });
    return { span, core, upper, link, endpoints, linkMaterial };
  });
  const tag = document.createElement("button");
  tag.className = "scene-connector-tag";
  tag.type = "button";
  tag.addEventListener("click", () =>
    onSelect({ kind: "connector", id: layout.connector.id }),
  );
  labelHost.appendChild(tag);
  let closed = false,
    selected = false;
  const positionFor = (
    span: ConnectorSpan,
    upper: boolean,
    heights: Map<string, number>,
  ) => {
    const stop = upper ? span.to : span.from,
      fp = span.footprint;
    return new THREE.Vector3(
      fp?.center[0] ?? stop.point[0],
      heights.get(stop.floorId) ?? stop.elevation,
      -(fp?.center[1] ?? stop.point[1]),
    );
  };
  return {
    layout,
    group,
    picks,
    tag,
    setState(isClosed: boolean, isSelected: boolean) {
      closed = isClosed;
      selected = isSelected;
      accent.color.set(closed ? "#b12b46" : selected ? "#dab04c" : color);
      tread.emissive.set(selected ? "#5d420b" : "#000000");
      tread.emissiveIntensity = 0.15;
      tag.textContent = `${layout.connector.kind === "lift" ? "⇅" : "↗"} ${layout.connector.name || layout.connector.kind}${closed ? " · Closed" : ""}`;
      tag.dataset.closed = String(closed);
      tag.dataset.selected = String(selected);
      tag.setAttribute("aria-pressed", String(selected));
      tag.title =
        "Connects " + layout.stops.map((s) => s.space.name).join(" → ");
    },
    update(mode: Mode, floorId: string, heights: Map<string, number>) {
      for (const m of models) {
        const from = positionFor(m.span, false, heights),
          to = positionFor(m.span, true, heights),
          fp = m.span.footprint;
        const lowerVisible =
            mode !== "inside" || m.span.from.floorId === floorId,
          upperVisible = mode !== "inside" || m.span.to.floorId === floorId;
        m.core.visible = !!fp && (lowerVisible || upperVisible);
        m.upper.visible = !!fp && upperVisible;
        if (fp) {
          m.core.position.y = from.y;
          m.upper.position.y = to.y;
        }
        const gap = to.y - from.y - m.span.rise;
        m.link.visible = mode !== "inside" && (!fp || Math.abs(gap) > 0.03);
        const a = fp
          ? from.clone().add(new THREE.Vector3(0, m.span.rise, 0))
          : from.clone().add(new THREE.Vector3(0, 0.18, 0));
        const b = fp ? to : to.clone().add(new THREE.Vector3(0, 0.18, 0));
        const positions = m.link.geometry.getAttribute("position");
        positions.setXYZ(0, a.x, a.y, a.z);
        positions.setXYZ(1, b.x, b.y, b.z);
        positions.needsUpdate = true;
        m.link.geometry.computeBoundingSphere();
        m.link.computeLineDistances();
        m.linkMaterial.color.copy(accent.color);
        m.endpoints.forEach((p, i) => {
          p.visible = !fp && (i ? upperVisible : lowerVisible);
          p.position.copy(i ? b : a);
        });
      }
    },
    anchor(heights: Map<string, number>) {
      const span = layout.spans.at(-1)!;
      return positionFor(span, true, heights).add(
        new THREE.Vector3(0, layout.connector.kind === "lift" ? 2.45 : 1.05, 0),
      );
    },
    bounds(heights: Map<string, number>) {
      const b = new THREE.Box3();
      for (const stop of layout.stops) {
        const y = heights.get(stop.floorId) ?? stop.elevation;
        for (const [x, z] of stop.space.polygon) {
          b.expandByPoint(new THREE.Vector3(x, y, -z));
          b.expandByPoint(new THREE.Vector3(x, y + 2.5, -z));
        }
      }
      return b;
    },
    dispose() {
      resources.forEach((r) => r.dispose());
      tag.remove();
    },
  };
}
