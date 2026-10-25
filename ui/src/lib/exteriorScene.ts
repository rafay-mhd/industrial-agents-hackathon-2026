import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type {
  BuildingEnvelope,
  Footprint,
  FacadeEdge,
  ExteriorEntrance,
} from "./envelopeLayout";
import { footprintEdges, projectToEdge } from "./envelopeLayout.ts";
import { boundsOf, interiorPoint } from "./model.ts";
import { exteriorTexture } from "./exteriorMaterials.ts";
import { roofGeometry } from "./roofGeometry.ts";
import type { Selection } from "../components/IndoorMap";
import { LOOK } from "./lookExperiment.ts";
export function createExteriorScene(
  layout: BuildingEnvelope,
  labelHost: HTMLDivElement,
  onSelect: (s: Selection) => void,
) {
  const group = new THREE.Group(),
    shell = new THREE.Group(),
    site = new THREE.Group();
  group.add(shell, site);
  const resources: { dispose(): void }[] = [],
    keep = <T extends { dispose(): void }>(v: T) => {
      resources.push(v);
      return v;
    };
  const mat = (color: string, roughness = 0.8, metalness = 0.03) =>
    keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const woodMap = keep(exteriorTexture("timber")),
    metalMap = keep(exteriorTexture("metal")),
    stoneMap = keep(exteriorTexture("stone")),
    glassMap = keep(exteriorTexture("glass"));
  const stone = mat("#ffffff", 0.87),
    trim = mat("#c8bba2", 0.7),
    reveal = mat("#8c806a", 0.85),
    dark = mat("#29332f", 0.38, 0.45),
    roof = mat("#ffffff", 0.48, 0.48),
    bronze = mat("#ad8a52", 0.32, 0.7),
    timber = mat("#ffffff", 0.63),
    deck = mat("#d9b58b", 0.85),
    paving = mat("#b8b4a6");
  stone.map = stone.bumpMap = stoneMap;
  stone.bumpScale = 0.012;
  timber.map = timber.bumpMap = woodMap;
  timber.bumpScale = 0.008;
  deck.map = woodMap;
  roof.map = roof.bumpMap = metalMap;
  roof.bumpScale = 0.035;
  roof.name = "Standing-seam zinc roof";
  timber.name = "Oiled oak";
  const glass = keep(
    new THREE.MeshPhysicalMaterial({
      color: "#c1d8d9",
      map: glassMap,
      roughness: 0.15,
      metalness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.1,
    }),
  );
  const warmGlass = keep(glass.clone());
  warmGlass.color.set("#d3b88a");
  let topElevation = layout.ground;
  const railingGlass = keep(
    new THREE.MeshStandardMaterial({
      color: "#9cb4b8",
      transparent: true,
      opacity: 0.22,
      roughness: 0.25,
      metalness: 0.1,
      depthWrite: false,
    }),
  );
  // Ghost envelope: the shell drawn translucent around the interior modes (LOOK.ghostEnvelope).
  const ghostMaterial = keep(
    new THREE.MeshStandardMaterial({
      color: "#e4e9ef",
      transparent: true,
      opacity: LOOK.envelopeOpacity,
      roughness: 0.9,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  let ghosted = false;
  const noRaycast = () => {};
  const setGhost = (ghost: boolean) => {
    if (ghost === ghosted) return;
    ghosted = ghost;
    shell.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (ghost) {
          object.userData.solidMaterial = object.material;
          object.userData.solidCastShadow = object.castShadow;
          object.userData.solidRaycast = object.raycast;
          object.material = ghostMaterial;
          object.castShadow = false;
          object.raycast = noRaycast;
        } else {
          object.material = object.userData.solidMaterial ?? object.material;
          object.castShadow = object.userData.solidCastShadow ?? object.castShadow;
          object.raycast = object.userData.solidRaycast ?? object.raycast;
        }
      } else if (object instanceof THREE.LineSegments) {
        object.visible = !ghost;
      }
    });
  };
  const picks: THREE.Object3D[] = [],
    batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => {
    const parts = batches.get(m) ?? [];
    parts.push(geo);
    batches.set(m, parts);
  };
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    m: THREE.Material,
    angle = 0,
  ) => {
    if (w < 0.001 || h < 0.001 || d < 0.001) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(angle);
    g.translate(x, y, z);
    add(g, m);
  };
  const along = (
    e: FacadeEdge,
    start: number,
    end: number,
    bottom: number,
    top: number,
    thickness: number,
    m: THREE.Material,
    out = 0.015,
  ) => {
    const t = (start + end) / 2 / e.length,
      x = e.a[0] + (e.b[0] - e.a[0]) * t + e.normal[0] * out,
      z = -(e.a[1] + (e.b[1] - e.a[1]) * t + e.normal[1] * out);
    box(
      x,
      (bottom + top) / 2,
      z,
      end - start,
      top - bottom,
      thickness,
      m,
      Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]),
    );
  };
  const flush = (
    target: THREE.Group,
    selection?: { kind: string; id: string; floorId?: string },
  ) => {
    for (const [m, parts] of batches) {
      const geo = mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      if (!geo) continue;
      const mesh = new THREE.Mesh(keep(geo), m);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = selection ?? { exterior: true };
      target.add(mesh);
      picks.push(mesh);
    }
    batches.clear();
  };
  const surface = (
    polys: Footprint[],
    y: number,
    depth: number,
    m: THREE.Material,
  ) => {
    for (const p of polys) {
      const s = new THREE.Shape(
        p.outer.map(([x, y]) => new THREE.Vector2(x, y)),
      );
      s.holes = p.holes.map(
        (h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))),
      );
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      add(g, m);
    }
  };
  for (const band of layout.bands) {
    if (band.top <= layout.ground + 0.01) continue;
    const bottom = Math.max(band.bottom, layout.ground),
      height = band.top - bottom;
    for (const edge of band.edges) {
      const openings: {
        start: number;
        end: number;
        bottom: number;
        top: number;
        door?: ExteriorEntrance;
        bay?: number;
      }[] = [];
      for (const entry of layout.accesses.filter(
        (e) => e.edge?.id === edge.id,
      )) {
        const t = projectToEdge(entry.point, edge).t * edge.length;
        openings.push({
          start: Math.max(0, t - entry.width / 2 - 0.09),
          end: Math.min(edge.length, t + entry.width / 2 + 0.09),
          bottom,
          top: bottom + Math.min(entry.width > 2.5 ? 3.2 : 2.4, height - 0.18),
          door: entry,
        });
      }
      if (height > 2.4) {
        const count = Math.max(
            1,
            Math.floor(edge.length / (edge.length > 18 ? 5.8 : 3.9)),
          ),
          module = edge.length / count;
        for (let i = 0; i < count; i++) {
          if (module < 1.55) continue;
          const ratio = [0.74, 0.57, 0.84, 0.74][i % 4],
            windowWidth = Math.min(4.8, module * ratio);
          const center = (i + 0.5) * module,
            start = center - windowWidth / 2,
            end = center + windowWidth / 2;
          if (openings.some((o) => end > o.start - 0.4 && start < o.end + 0.4))
            continue;
          openings.push({
            start,
            end,
            bottom: bottom + Math.min(0.8, height * 0.22),
            top: bottom + height - 0.55,
            bay: i,
          });
        }
      }
      openings.sort((a, b) => a.start - b.start);
      let cursor = 0;
      for (const o of openings) {
        along(edge, cursor, o.start, bottom, band.top, 0.24, stone);
        along(edge, o.start, o.end, bottom, o.bottom, 0.24, stone);
        along(edge, o.start, o.end, o.top, band.top, 0.24, stone);
        if (!o.door) {
          // A recessed pane, deep jambs and thin frames give the window actual depth.
          along(
            edge,
            o.start,
            o.end,
            o.bottom,
            o.top,
            0.045,
            (o.bay ?? 0) % 4 === 1 ? warmGlass : glass,
            -0.065,
          );
          for (const t of [o.start, o.end])
            along(
              edge,
              t - 0.055,
              t + 0.055,
              o.bottom,
              o.top,
              0.26,
              reveal,
              0.015,
            );
          const mullions =
            o.end - o.start > 3.2
              ? [o.start, o.start + (o.end - o.start) * 0.32, o.end]
              : [o.start, o.end];
          for (const t of mullions)
            along(
              edge,
              t - 0.025,
              t + 0.025,
              o.bottom,
              o.top,
              0.09,
              dark,
              0.11,
            );
          for (const y of [o.bottom, o.top])
            along(
              edge,
              o.start - 0.04,
              o.end + 0.04,
              y - 0.04,
              y + 0.04,
              0.1,
              dark,
              0.11,
            );
          along(
            edge,
            o.start - 0.06,
            o.end + 0.06,
            o.bottom - 0.07,
            o.bottom,
            0.34,
            trim,
            0.1,
          );
          // Grouped oak fins and a slim hood break the repeated office-grid rhythm.
          if ((o.bay ?? 0) % 3 === 1) {
            const available = Math.min(0.48, edge.length - o.end - 0.14);
            for (let x = o.end + 0.13; x < o.end + available; x += 0.11)
              along(
                edge,
                x,
                x + 0.055,
                o.bottom - 0.1,
                o.top + 0.18,
                0.24,
                timber,
                0.18,
              );
          }
          along(
            edge,
            o.start - 0.13,
            o.end + 0.13,
            o.top + 0.06,
            o.top + 0.13,
            0.5,
            dark,
            0.25,
          );
          along(
            edge,
            o.start - 0.08,
            o.end + 0.08,
            o.top + 0.045,
            o.top + 0.065,
            0.42,
            timber,
            0.23,
          );
        }
        cursor = Math.max(cursor, o.end);
      }
      along(edge, cursor, edge.length, bottom, band.top, 0.24, stone);
      along(
        edge,
        0,
        edge.length,
        band.top - 0.11,
        band.top + 0.02,
        0.36,
        trim,
        0.025,
      );
      along(edge, 0, edge.length, bottom, bottom + 0.1, 0.28, reveal, 0.015);
    }
    // A dark hipped metal cap reads as a roof from street and overview angles.
    // The pitch is illustrative. Only the already-derived roof footprint is covered.
    surface(band.roof, band.top - 0.02, 0.18, roof);
    for (const p of band.roof) {
      const b = boundsOf(p.outer);
      const nextTop = Math.min(
        ...layout.bands
          .filter((b) => b.top > band.top + 0.01)
          .map((b) => b.top),
      );
      const rise = Math.max(
        0,
        Math.min(
          2.2,
          Math.min(b.width, b.height) * 0.1,
          nextTop - band.top - 0.2,
        ),
      );
      add(roofGeometry(p, band.top + 0.16, rise), roof);
      topElevation = Math.max(topElevation, band.top + 0.16 + rise);
    }
    for (const edge of footprintEdges(band.roof)) {
      along(
        edge,
        0,
        edge.length,
        band.top - 0.05,
        band.top + 0.16,
        0.34,
        dark,
        0.08,
      );
      along(
        edge,
        0,
        edge.length,
        band.top - 0.08,
        band.top - 0.035,
        0.42,
        timber,
        0.08,
      );
      along(
        edge,
        0,
        edge.length,
        band.top + 0.14,
        band.top + 0.18,
        0.38,
        bronze,
        0.08,
      );
    }
  }
  flush(shell);
  const all = layout.plans.flatMap((p) => p.all.flatMap((f) => f.outer)),
    bounds = boundsOf(all),
    pad = Math.max(
      1.5,
      Math.min(4, Math.max(bounds.width, bounds.height) * 0.035),
    );
  box(
    (bounds.minX + bounds.maxX) / 2,
    layout.ground - 0.36,
    -(bounds.minY + bounds.maxY) / 2,
    bounds.width + pad * 2,
    0.28,
    bounds.height + pad * 2,
    paving,
  );
  flush(site, { kind: "presentation-base", id: "" });
  // The presentation base is not a navigable part of the building.
  for (const object of site.children) {
    const i = picks.indexOf(object);
    if (i >= 0) picks.splice(i, 1);
  }
  type Feature = {
    id: string;
    floorId: string;
    group: THREE.Group;
    tag: HTMLButtonElement;
    anchor: THREE.Vector3;
    entry?: ExteriorEntrance;
    materials?: THREE.MeshStandardMaterial[];
  };
  const features: Feature[] = [];
  const tagFor = (text: string, title: string, selection: Selection) => {
    const tag = document.createElement("button");
    tag.className = "scene-site-tag";
    tag.textContent = text;
    tag.title = title;
    tag.onclick = (e) => {
      e.stopPropagation();
      onSelect(selection);
    };
    labelHost.appendChild(tag);
    return tag;
  };
  for (const entry of layout.accesses) {
    const portal = new THREE.Group(),
      { point, normal, width: w, opening } = entry,
      angle = Math.atan2(normal[0], -normal[1]);
    // Local +Z points outside the facade.
    const pointWorld = (x: number, y: number, z: number) =>
      new THREE.Vector3(x, y, z)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
        .add(new THREE.Vector3(point[0], 0, -point[1]));
    const frameMaterial = mat("#2d4f79", 0.45, 0.35);
    const local = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      m: THREE.Material,
    ) => {
      const p = pointWorld(x, y, z);
      box(p.x, p.y, p.z, w, h, d, m, angle);
    };
    const band = layout.bands.find((b) =>
      b.edges.some((e) => e.id === entry.edge?.id),
    );
    const h = Math.min(
      w > 2.5 ? 3.2 : 2.4,
      (band ? band.top - entry.elevation : 3) - 0.18,
    );
    if (entry.edge) {
      if (entry.isEntrance) {
        // Measured opening width stays intact; oak leaves replace the glass placeholder.
        const leaves = w > 1.4 ? 2 : 1,
          leafWidth = w / leaves;
        for (let i = 0; i < leaves; i++) {
          const x = -w / 2 + (i + 0.5) * leafWidth;
          local(
            x,
            (h - 0.27) / 2,
            0.025,
            leafWidth - 0.025,
            h - 0.27,
            0.12,
            timber,
          );
          local(x, h - 0.135, 0.015, leafWidth - 0.025, 0.24, 0.08, glass);
          local(
            x + (i === 0 ? 1 : -1) * leafWidth * 0.32,
            1.12,
            0.115,
            0.035,
            0.7,
            0.065,
            bronze,
          );
          local(x, 0.11, 0.095, leafWidth - 0.065, 0.12, 0.025, bronze);
        }
      } else local(0, h / 2, 0, w, h, 0.085, glass);
      for (const x of [-w / 2, w / 2])
        local(x, h / 2, 0.13, 0.08, h + 0.12, 0.25, frameMaterial);
      // A substantial timber surround makes the entrance a facade landmark.
      if (entry.isEntrance) {
        for (const x of [-w / 2 - 0.21, w / 2 + 0.21])
          local(x, h / 2, 0.18, 0.3, h + 0.32, 0.32, timber);
        local(0, h + 0.15, 0.18, w + 0.72, 0.3, 0.32, timber);
      }
      local(0, h + 0.04, 0.17, w + 0.28, 0.16, 0.32, frameMaterial);
      if (w > 1.4) local(0, h / 2, 0.08, 0.055, h, 0.14, dark);
      if (!entry.isEntrance)
        local(w * 0.16, 1.05, 0.13, 0.045, 0.42, 0.05, bronze);
      local(0, h + 0.38, 0.72, w + 1, 0.13, 1.7, dark);
      local(0, h + 0.3, 0.72, w + 0.88, 0.035, 1.55, timber);
      local(0, h + 0.35, 1.57, w + 1.02, 0.05, 0.045, bronze);
      local(0, 0.015, 0.65, w + 0.5, 0.045, 1.4, paving);
      // Source-sized threshold and an inlaid approach marker make the access legible.
      local(0, 0.05, 1.1, Math.min(0.8, w * 0.6), 0.018, 0.3, bronze);
    } else {
      local(0, 0.45, 0, 0.1, 0.9, 0.1, bronze);
    }
    flush(portal, {
      kind: "opening",
      id: opening.id,
      floorId: opening.floor_id,
    });
    portal.position.y = entry.elevation;
    group.add(portal);
    const tag = tagFor(
      `↳ ${entry.label}`,
      `${entry.label} · ${opening.width_m ?? "Unknown"} m · ${opening.synthetic ? "Generated entrance annotation" : "Source entrance"}${entry.edge ? "" : " · facade alignment unknown"}`,
      { kind: "opening", id: opening.id },
    );
    features.push({
      id: opening.id,
      floorId: opening.floor_id,
      group: portal,
      tag,
      anchor: new THREE.Vector3(
        point[0] + normal[0] * 1.05,
        h + 0.65,
        -point[1] - normal[1] * 1.05,
      ),
      entry,
      materials: [frameMaterial],
    });
  }
  for (const outdoor of layout.outdoors) {
    const terrace = new THREE.Group(),
      { space } = outdoor,
      fp = [{ outer: space.polygon, holes: [] }];
    surface(
      fp,
      0.005,
      0.055,
      /garden/.test(space.room_type ?? "") ? mat("#879880") : deck,
    );
    if (outdoor.railing)
      for (const edge of outdoor.edges) {
        along(edge, 0, edge.length, 1.02, 1.08, 0.065, bronze);
        along(edge, 0, edge.length, 0.12, 0.17, 0.055, dark);
        const count = Math.max(1, Math.ceil(edge.length / 1.15));
        for (let i = 0; i <= count; i++)
          along(
            edge,
            Math.max(0, (edge.length * i) / count - 0.025),
            Math.min(edge.length, (edge.length * i) / count + 0.025),
            0.06,
            1.08,
            0.05,
            dark,
          );
        // Glass infill leaves the outdoor space visibly open to the sky.

        along(edge, 0, edge.length, 0.18, 1.01, 0.035, railingGlass);
      }
    flush(terrace, { kind: "space", id: space.id, floorId: space.floor_id });
    terrace.position.y = outdoor.elevation;
    group.add(terrace);
    const center = interiorPoint(space.polygon),
      tag = tagFor(
        `☀ ${space.name || space.room_type || "Outdoor area"}`,
        "Open-air area recorded in the building data",
        { kind: "space", id: space.id },
      );
    tag.classList.add("outdoor");
    features.push({
      id: space.id,
      floorId: space.floor_id,
      group: terrace,
      tag,
      anchor: new THREE.Vector3(center[0], 1.2, -center[1]),
    });
  }
  let mode = "building",
    selected: string | undefined;
  return {
    group,
    topElevation,
    shell,
    site,
    features,
    picks,
    update(
      nextMode: string,
      floorId: string,
      heights: Map<string, number>,
      selection: string | undefined,
      closed: Set<string>,
    ) {
      mode = nextMode;
      selected = selection;
      const ghost =
        LOOK.ghostEnvelope && mode !== "building" && mode !== "floors";
      setGhost(ghost);
      shell.visible = mode === "building" || ghost;
      site.visible = mode === "building";
      for (const feature of features) {
        feature.group.visible =
          (mode !== "inside" || feature.floorId === floorId) &&
          (mode !== "building" ||
            (heights.get(feature.floorId) ?? 0) >= layout.ground - 0.01);
        feature.group.position.y = heights.get(feature.floorId) ?? 0;
        feature.materials?.forEach((m) =>
          m.color.set(
            closed.has(feature.id)
              ? "#a73549"
              : selected === feature.id
                ? "#b68e46"
                : "#2d4f79",
          ),
        );
        feature.tag.classList.toggle("selected", selected === feature.id);
      }
    },
    drawLabels(
      project: (p: THREE.Vector3) => { x: number; y: number; z: number },
      width: number,
      height: number,
      occupied: { x: number; y: number; w: number }[],
      enabled: boolean,
    ) {
      let count = 0;
      for (const feature of [...features].sort(
        (a, b) => Number(b.id === selected) - Number(a.id === selected),
      )) {
        feature.tag.hidden = true;
        if (
          feature.entry &&
          !feature.entry.isEntrance &&
          feature.id !== selected
        )
          continue;
        if (!feature.group.visible || (!enabled && feature.id !== selected))
          continue;
        const p = project(
            feature.anchor
              .clone()
              .add(new THREE.Vector3(0, feature.group.position.y, 0)),
          ),
          important = feature.id === selected,
          w = 155;
        if (
          p.z > 1 ||
          p.z < -1 ||
          p.x < 75 ||
          p.x > width - 75 ||
          p.y < 75 ||
          p.y > height - 95
        )
          continue;
        if (
          !important &&
          (count >= (mode === "building" ? 7 : 3) ||
            occupied.some(
              (o) =>
                Math.abs(o.x - p.x) < (o.w + w) / 2 && Math.abs(o.y - p.y) < 32,
            ))
        )
          continue;
        feature.tag.hidden = false;
        feature.tag.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;
        occupied.push({ x: p.x, y: p.y, w });
        count++;
      }
    },
    dispose() {
      for (const f of features) f.tag.remove();
      resources.forEach((r) => r.dispose());
    },
  };
}
