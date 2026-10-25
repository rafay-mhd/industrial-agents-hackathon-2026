import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  boundsOf,
  floorGeometry,
  interiorPoint,
  label,
  palette,
  polygonArea,
  pointInside,
  routeOnFloor,
  visibleClosures,
} from "./model";
import { fitCameraDistance, easeCamera, easeZoom } from "./sceneMath";
import type { Vec3 } from "./sceneMath";
import type { BuildingData, Opening, Space } from "../types";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createAssetScene, assetHit } from "./assetScene";
import { loadAssetModels } from "./assetModels";
import { describeAsset } from "./assetCatalog";
import type { MapProps, Selection } from "../components/IndoorMap";
import { connectorLayouts } from "./connectorLayout";
import { createConnectorScene } from "./connectorScene";
import { wallCoverage } from "./wallCoverage";
import type { PlaybackStore } from "./routePlayback";
import { createRouteActor } from "./routeActor";
import { createFootsteps } from "./footsteps";
import { buildEnvelope, isOutdoor } from "./envelopeLayout";
import { createExteriorScene } from "./exteriorScene";
import { wallSegments } from "./model";
import { LOOK, ZOOM_SMOOTHING, wheelZoomStep } from "./lookExperiment";

export type SceneMode = "building" | "connected" | "floors" | "inside";
export type SceneOptions = Pick<
  MapProps,
  "state" | "layers" | "location" | "selected"
> & {
  floorId: string;
  mode: SceneMode;
  orbit: boolean;
  finish: "materials" | "purpose";
};
type Room = {
  space: Space;
  slab: THREE.Mesh;
  roof: THREE.Mesh | null;
  material: THREE.MeshStandardMaterial;
  roofMaterial: THREE.MeshStandardMaterial;
  color: THREE.Color;
  anchor: THREE.Vector3;
  tag: HTMLDivElement;
  area: number;
  finishColor: THREE.Color;
};
type FloorGroup = {
  group: THREE.Group;
  walls: THREE.Group;
  roofs: THREE.Group;
  overlays: THREE.Group;
  assets: ReturnType<typeof createAssetScene>;
  elevation: number;
  height: number;
  index: number;
  tag: HTMLDivElement;
};

/** Owns one renderer for the building. Mode/floor changes animate existing meshes. */
export function createBuildingWorld(
  container: HTMLDivElement,
  labelHost: HTMLDivElement,
  data: BuildingData,
  addedDoors: Opening[],
  onSelect: (s: Selection) => void,
  onInteract: () => void,
  onError: (message: string) => void,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = 0.06;
  controls.rotateSpeed = 0.65;
  controls.autoRotateSpeed = 0.45;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const b = boundsOf(data.spaces.flatMap((s) => s.polygon));
  const span = Math.max(b.width, b.height, 1);
  const centerX = (b.minX + b.maxX) / 2,
    centerZ = -(b.minY + b.maxY) / 2;
  const floors = [...data.floors].sort((a, b) => a.level - b.level);
  const minimumY = Math.min(...floors.map((f) => floorGeometry(f).elevation));
  const maximumHeight = Math.max(...floors.map((f) => floorGeometry(f).height));
  const separation = Math.max(5, span * 0.16, maximumHeight);
  controls.minDistance = 1.5;
  controls.maxDistance = span * 15;
  scene.add(new THREE.HemisphereLight("#fffaf0", "#a1b1ce", 0.85));
  const sun = new THREE.DirectionalLight("#fff5e8", 2.5);
  sun.position.set(
    centerX - span * 0.6,
    minimumY + span * 1.4,
    centerZ + span * 0.7,
  );
  sun.target.position.set(centerX, minimumY, centerZ);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -span * 1.5;
  sun.shadow.camera.right = sun.shadow.camera.top = span * 1.5;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = span * 8 + separation * floors.length;
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight("#a4bce9", 0.6);
  fill.position.set(centerX + span, span * 0.7, centerZ - span);
  scene.add(fill);

  const resources: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(r: T) => {
    resources.push(r);
    return r;
  };
  const studio = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = keep(pmrem.fromScene(studio, 0.04));
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.45;
  studio.dispose();
  pmrem.dispose();
  let navigation: PlaybackStore | null = null,
    navRevision = -1,
    navLeg = -1,
    wasFollowing = false;
  const actor = keep(createRouteActor());
  const footsteps = keep(createFootsteps());
  scene.add(footsteps.group);
  scene.add(actor.group);
  const transferLine = new THREE.Line(
    keep(new THREE.BufferGeometry()),
    keep(
      new THREE.LineDashedMaterial({
        color: "#b88d40",
        dashSize: 0.3,
        gapSize: 0.18,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      }),
    ),
  );
  transferLine.renderOrder = 10;
  transferLine.visible = false;
  scene.add(transferLine);
  let transferLeg: unknown = null;
  const root = new THREE.Group();
  scene.add(root);
  const rooms = new Map<string, Room>(),
    groups = new Map<string, FloorGroup>();
  const picks: THREE.Object3D[] = [];
  const stageGeometry = keep(new THREE.PlaneGeometry(span * 10, span * 10));
  const shadow = new THREE.Mesh(
    stageGeometry,
    keep(new THREE.ShadowMaterial({ color: "#334466", opacity: 0.17 })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(centerX, minimumY - 0.2, centerZ);
  shadow.receiveShadow = true;
  scene.add(shadow);
  const doors = [
    ...(data.openings ?? []).filter(
      (d) => !addedDoors.some((a) => a.id === d.id),
    ),
    ...addedDoors,
  ];
  const envelope = buildEnvelope(data, doors);
  const exterior = keep(createExteriorScene(envelope, labelHost, onSelect));
  scene.add(exterior.group);
  picks.push(...exterior.picks);
  const entryNormal = envelope.entrances
    .filter((e) => e.edge)
    .reduce(
      (p, e) =>
        p.addScaledVector(
          new THREE.Vector3(e.normal[0], 0, -e.normal[1]),
          e.edge!.length,
        ),
      new THREE.Vector3(),
    );
  if (entryNormal.length() < 0.1) entryNormal.set(0.95, 0, 1.25);
  entryNormal.normalize();
  const exteriorDirection = entryNormal
    .clone()
    .add(new THREE.Vector3(-entryNormal.z * 0.25, 0.52, entryNormal.x * 0.25))
    .normalize();
  let exteriorClosed = new Set<string>();
  const edgeMaterial = keep(
    new THREE.LineBasicMaterial({
      color: "#203b62",
      transparent: true,
      opacity: 0.26,
    }),
  );
  const roofEdgeMaterial = keep(
    new THREE.LineBasicMaterial({
      color: "#f8f4e8",
      transparent: true,
      opacity: 0.65,
    }),
  );
  const material = (color: string | THREE.Color) =>
    keep(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.82,
        metalness: 0.02,
      }),
    );
  const worldPoint = (p: [number, number], y: number) =>
    new THREE.Vector3(p[0], y, -p[1]);

  const layouts = connectorLayouts(data);
  const voids = new Map<string, [number, number][][]>();
  for (const layout of layouts)
    for (const span of layout.spans)
      if (span.footprint) {
        const paths = voids.get(span.to.space.id) ?? [];
        paths.push(span.footprint.polygon);
        voids.set(span.to.space.id, paths);
      }
  for (const [index, floor] of floors.entries()) {
    const { elevation, height } = floorGeometry(floor);
    const group = new THREE.Group(),
      walls = new THREE.Group(),
      roofs = new THREE.Group(),
      overlays = new THREE.Group();
    group.position.y = elevation;
    const assets = createAssetScene(
      (data.assets ?? []).filter((a) => a.floor_id === floor.id),
      height,
    );
    keep({ dispose: () => groups.get(floor.id)?.assets.dispose() });
    group.add(walls, roofs, overlays, assets.group);
    root.add(group);
    const tag = document.createElement("div");
    tag.className = "scene-floor-tag";
    tag.setAttribute("aria-hidden", "true");
    tag.textContent = floor.name;
    labelHost.appendChild(tag);
    groups.set(floor.id, {
      group,
      walls,
      roofs,
      overlays,
      assets,
      elevation,
      height,
      index,
      tag,
    });
    const uncoveredWall = wallCoverage();
    const seen = new Set<string>(),
      batches = new Map<string, THREE.BufferGeometry[]>();
    for (const space of data.spaces.filter((s) => s.floor_id === floor.id)) {
      // Display height for this room's walls and ceiling (LOOK.roomWallCap_m); halls keep the floor height.
      const wallHeight =
        LOOK.fullHeightWalls &&
        LOOK.roomWallCap_m > 0 &&
        space.type !== "hall" &&
        space.type !== "outdoor"
          ? Math.min(height, LOOK.roomWallCap_m)
          : height;
      const style = palette(space),
        color = new THREE.Color(style.solid);
      const shape = new THREE.Shape(
        space.polygon.map(([x, y]) => new THREE.Vector2(x, y)),
      );
      for (const polygon of voids.get(space.id) ?? [])
        shape.holes.push(
          new THREE.Path(polygon.map(([x, y]) => new THREE.Vector2(x, y))),
        );
      const geom = keep(
        new THREE.ExtrudeGeometry(shape, {
          depth: 0.16,
          bevelEnabled: false,
          steps: 1,
        }),
      );
      geom.rotateX(-Math.PI / 2);
      const roomMaterial = material(
        color.clone().lerp(new THREE.Color("#fffaf0"), 0.18),
      );
      const slab = new THREE.Mesh(geom, roomMaterial);
      slab.position.y = -0.16;
      slab.receiveShadow = slab.castShadow = true;
      slab.userData = { kind: "space", id: space.id, floorId: floor.id };
      group.add(slab);
      picks.push(slab);
      const edges = new THREE.LineSegments(
        keep(new THREE.EdgesGeometry(geom)),
        edgeMaterial,
      );
      slab.add(edges);
      const roofMaterial = material(
        LOOK.ceilings && LOOK.neutralCeilings ? LOOK.ceilingColor : color,
      );
      let roof: THREE.Mesh | null = null;
      if (space.type !== "outdoor") {
        const roofGeometry = voids.has(space.id)
          ? keep(
              new THREE.ExtrudeGeometry(
                new THREE.Shape(
                  space.polygon.map(([x, y]) => new THREE.Vector2(x, y)),
                ),
                { depth: 0.16, bevelEnabled: false, steps: 1 },
              ).rotateX(-Math.PI / 2),
            )
          : geom;
        roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = wallHeight - 0.2;
        roof.receiveShadow = true;
        roof.castShadow = !LOOK.ceilings;
        if (LOOK.ceilings) roof.raycast = () => {};
        roof.userData = slab.userData;
        roof.add(
          new THREE.LineSegments(
            keep(new THREE.EdgesGeometry(roofGeometry)),
            roofEdgeMaterial,
          ),
        );
        roofs.add(roof);
        picks.push(roof);
        for (const segment of wallSegments(space, doors).flatMap(
          uncoveredWall,
        )) {
          const key = [segment.a, segment.b]
            .map((p) => p.map((v) => v.toFixed(4)).join(","))
            .sort()
            .join(":");
          if (seen.has(key)) continue;
          seen.add(key);
          const dx = segment.b[0] - segment.a[0],
            dy = segment.b[1] - segment.a[1],
            length = Math.hypot(dx, dy);
          if (length < 0.001) continue;
          const mx = (segment.a[0] + segment.b[0]) / 2,
            my = (segment.a[1] + segment.b[1]) / 2,
            nx = -dy / length,
            ny = dx / length,
            inset = LOOK.wallInset_m,
            inward =
              inset && pointInside([mx + nx * 0.05, my + ny * 0.05], space.polygon)
                ? 1
                : -1,
            ox = inset ? inward * nx * inset : 0,
            oy = inset ? inward * ny * inset : 0;
          const wall = new THREE.BoxGeometry(length, wallHeight, 0.1);
          wall.rotateY(Math.atan2(dy, dx));
          wall.translate(mx + ox, wallHeight / 2, -(my + oy));
          wall.userData.spaceId = space.id;
          const parts = batches.get(style.solid) ?? [];
          parts.push(wall);
          batches.set(style.solid, parts);
        }
      }
      const point = interiorPoint(space.polygon);
      const roomTag = document.createElement("div");
      roomTag.className = "scene-room-tag";
      roomTag.setAttribute("aria-hidden", "true");
      roomTag.textContent = label(space);
      labelHost.appendChild(roomTag);
      rooms.set(space.id, {
        space,
        slab,
        roof,
        material: roomMaterial,
        roofMaterial,
        color,
        anchor: worldPoint(point, 0.4),
        tag: roomTag,
        area: polygonArea(space.polygon),
        finishColor: new THREE.Color(
          /toilet|bath|wc/.test(space.room_type ?? space.type)
            ? "#c3cdd2"
            : /production|warehouse|lab|technical|storage/.test(
                  space.room_type ?? space.type,
                )
              ? "#c1c8cd"
              : "#c6b390",
        ),
      });
    }
    for (const [color, parts] of batches) {
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      if (merged) {
        const wallColor = new THREE.Color(color).multiplyScalar(0.77);
        if (LOOK.translucentWalls)
          wallColor.lerp(new THREE.Color("#f6f4ef"), LOOK.wallTint);
        const mesh = new THREE.Mesh(keep(merged), material(wallColor));
        if (LOOK.translucentWalls) {
          mesh.material.transparent = true;
          mesh.material.opacity = LOOK.wallOpacity;
          mesh.material.depthWrite = false;
        }
        // Some source floor volumes overlap. Resolve coplanar display surfaces
        // deterministically without changing any supplied height or position.
        mesh.material.polygonOffset = true;
        mesh.material.polygonOffsetFactor = -index * 2;
        mesh.material.polygonOffsetUnits = -index * 2;
        mesh.castShadow = !LOOK.translucentWalls;
        mesh.receiveShadow = true;
        mesh.userData.wallSpaces = parts.map((p) => p.userData.spaceId);
        walls.add(mesh);
        picks.push(mesh);
      }
    }
  }

  const connections = layouts.map((layout) => {
    const model = keep(createConnectorScene(layout, labelHost, onSelect));
    scene.add(model.group);
    picks.push(...model.picks);
    return model;
  });
  let options: SceneOptions | null = null;
  let overlayResources: { dispose(): void }[] = [];
  let routeSegments: {
    floorLeg: number;
    mesh: THREE.Mesh;
    floorId: string;
    start: number;
    length: number;
    a: THREE.Vector3;
    b: THREE.Vector3;
  }[] = [];
  const rebuildOverlays = (o: SceneOptions) => {
    overlayResources.forEach((r) => r.dispose());
    overlayResources = [];
    routeSegments = [];
    for (const g of groups.values()) g.overlays.clear();
    const save = <T extends { dispose(): void }>(r: T) => {
      overlayResources.push(r);
      return r;
    };
    const closed = visibleClosures(data, o.state.closed);
    const sphere = save(
      new THREE.SphereGeometry(Math.max(0.16, span * 0.0025), 16, 12),
    );
    const dot = (
      point: [number, number],
      floorId: string,
      color: string,
      id?: string,
      kind?: string,
    ) => {
      const group = groups.get(floorId);
      if (!group) return;
      const mesh = new THREE.Mesh(
        sphere,
        save(new THREE.MeshBasicMaterial({ color })),
      );
      mesh.position.copy(worldPoint(point, 0.38));
      mesh.userData = { kind, id, floorId };
      group.overlays.add(mesh);
    };
    if (o.layers.openings)
      for (const door of doors)
        dot(
          door.position,
          door.floor_id,
          closed.has(door.id) ? "#af2949" : "#f7e2a4",
          door.id,
          "opening",
        );

    const progressMaterial = save(
      new THREE.MeshBasicMaterial({ color: "#d8b15d" }),
    );
    const progressGeometry = save(
      new THREE.CylinderGeometry(
        Math.max(0.08, span * 0.0018),
        Math.max(0.08, span * 0.0018),
        1,
        8,
      ),
    );
    if (o.layers.route)
      for (const floor of floors) {
        const group = groups.get(floor.id)!;
        const paths = o.state.route?.segments
          ?.filter((s) => s.floor_id === floor.id)
          .map((s) => s.points) ?? [routeOnFloor(o.state.route, floor)];
        for (const [pathIndex, points] of paths.entries()) {
          const routeMaterial = save(
            new THREE.MeshBasicMaterial({ color: "#223f91" }),
          );
          let travelled = 0;
          for (let i = 1; i < points.length; i++) {
            const a = worldPoint(points[i - 1], 0.28),
              c = worldPoint(points[i], 0.28),
              delta = c.clone().sub(a);
            if (!delta.length()) continue;
            const geom = save(
              new THREE.CylinderGeometry(
                Math.max(0.015, Math.min(0.035, span * 0.0002)),
                Math.max(0.015, Math.min(0.035, span * 0.0002)),
                delta.length(),
                8,
              ),
            );
            const mesh = new THREE.Mesh(geom, routeMaterial);
            mesh.position.copy(a).add(c).multiplyScalar(0.5);
            mesh.quaternion.setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              delta.normalize(),
            );
            group.overlays.add(mesh);
            const progressMesh = new THREE.Mesh(
              progressGeometry,
              progressMaterial,
            );
            progressMesh.quaternion.copy(mesh.quaternion);
            progressMesh.visible = false;
            group.overlays.add(progressMesh);
            const length = c.distanceTo(a);
            routeSegments.push({
              mesh: progressMesh,
              floorLeg: pathIndex,
              floorId: floor.id,
              start: travelled,
              length,
              a,
              b: c,
            });
            travelled += length;
          }
          if (points.length) {
            dot(points[0], floor.id, "#fff6df");
            dot(points.at(-1)!, floor.id, "#b12c4a");
          }
        }
      }
    if (o.location) dot(o.location.position, o.location.floorId, "#b62f4d");
  };

  const direction = new THREE.Vector3(0.95, 1.05, 1.25).normalize();
  let flight: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
    easing: (t: number) => number;
  } | null = null;
  let overview = true,
    width = 800,
    height = 600,
    hovered: string | null = null;
  const fly = (
    to: THREE.Vector3,
    toTarget: THREE.Vector3,
    duration = 1000,
    easing = easeCamera,
  ) => {
    // Flush the previous drag's damping so it cannot fight the camera animation.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    flight = {
      from: camera.position.clone(),
      to,
      fromTarget: controls.target.clone(),
      toTarget,
      start: performance.now(),
      duration: reduced.matches ? 0 : duration,
      easing,
    };
  };
  const offset = (g: FloorGroup, mode: SceneMode) =>
    g.elevation + (mode === "floors" ? g.index * separation : 0);
  const boxFor = (mode: SceneMode, floorId: string) => {
    const box = new THREE.Box3();
    for (const r of rooms.values()) {
      if (mode === "inside" && r.space.floor_id !== floorId) continue;
      if (
        mode === "building" &&
        floorGeometry(floors.find((f) => f.id === r.space.floor_id)!)
          .elevation <
          envelope.ground - 0.01
      )
        continue;
      const g = groups.get(r.space.floor_id)!;
      const y = offset(g, mode),
        h = mode === "building" && !isOutdoor(r.space) ? g.height : 0.85;
      for (const [x, z] of r.space.polygon) {
        box.expandByPoint(new THREE.Vector3(x, y, -z));
        box.expandByPoint(new THREE.Vector3(x, y + h, -z));
      }
    }
    if (mode !== "inside") {
      const heights = new Map(
        [...groups].map(([id, g]) => [id, offset(g, mode)]),
      );
      for (const connection of connections)
        box.union(connection.bounds(heights));
    }
    if (box.isEmpty())
      box.set(
        new THREE.Vector3(b.minX, minimumY, -b.maxY),
        new THREE.Vector3(b.maxX, minimumY + 3, -b.minY),
      );
    if (mode === "building")
      box.max.y = Math.max(box.max.y, exterior.topElevation);
    return box;
  };
  const frameBox = (
    box: THREE.Box3,
    viewDirection = direction,
    duration = 1100,
  ) => {
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    const availableHeight = Math.max(height * 0.55, height - 160);
    const availableWidth = Math.max(width * 0.7, width - 100);
    const fittedFov =
      (2 *
        Math.atan(
          (Math.tan((camera.fov * Math.PI) / 360) * availableHeight) / height,
        ) *
        180) /
      Math.PI;
    const distance = fitCameraDistance(
      size.toArray() as Vec3,
      viewDirection.toArray() as Vec3,
      availableWidth / availableHeight,
      fittedFov,
    );
    camera.near = Math.max(0.02, span / 10000);
    camera.far = span * 40 + separation * floors.length * 4;
    camera.updateProjectionMatrix();
    fly(
      center.clone().addScaledVector(viewDirection, distance),
      center,
      duration,
    );
  };
  const fit = (top = false) => {
    if (!options) return;
    overview = true;
    frameBox(
      boxFor(options.mode, options.floorId),
      top
        ? new THREE.Vector3(0.001, 1, 0.001).normalize()
        : options.mode === "building"
          ? exteriorDirection
          : direction,
    );
  };
  const focus = (selection: Selection) => {
    if (!selection || !options) return;
    if (selection.kind === "connector") {
      const connection = connections.find(
        (c) => c.layout.connector.id === selection.id,
      );
      if (connection) {
        const heights = new Map(
          [...groups].map(([id, g]) => [id, offset(g, options!.mode)]),
        );
        const box = connection.bounds(heights);
        box.expandByScalar(0.9);
        overview = false;
        frameBox(box, new THREE.Vector3(0.8, 0.9, 1.15).normalize(), 1100);
        return;
      }
    }
    if (selection.kind === "opening" && options.mode === "building") {
      const entry = envelope.accesses.find(
        (e) => e.opening.id === selection.id,
      );
      if (entry) {
        const [x, z] = entry.point,
          w = Math.max(3.5, entry.width + 1.5),
          y = entry.elevation;
        const box = new THREE.Box3(
          new THREE.Vector3(x - w, y - 0.1, -z - w),
          new THREE.Vector3(x + w, y + 3.5, -z + w),
        );
        const n = new THREE.Vector3(entry.normal[0], 0, -entry.normal[1]);
        overview = false;
        frameBox(
          box,
          n
            .clone()
            .add(new THREE.Vector3(-n.z * 0.4, 0.7, n.x * 0.4))
            .normalize(),
          1100,
        );
        return;
      }
    }
    if (selection.kind === "asset") {
      const asset = data.assets?.find((a) => a.id === selection.id);
      const g = asset && groups.get(asset.floor_id);
      const box = g?.assets.bounds.get(selection.id)?.clone();
      if (box && g) {
        box.translate(new THREE.Vector3(0, offset(g, options.mode), 0));
        box.expandByScalar(
          Math.max(
            0.5,
            Math.min(1.4, box.getSize(new THREE.Vector3()).length() * 0.2),
          ),
        );
        overview = false;
        frameBox(box, new THREE.Vector3(0.8, 1.1, 1.2).normalize(), 1000);
        return;
      }
    }
    let room = selection.kind === "space" ? rooms.get(selection.id) : undefined;
    const asset = data.assets?.find((a) => a.id === selection.id),
      door = doors.find((d) => d.id === selection.id);
    if (!room && asset) room = rooms.get(asset.space_id);
    if (!room && door) room = rooms.get(door.space_ids[0]);
    if (!room) return;
    const r = boundsOf(room.space.polygon),
      g = groups.get(room.space.floor_id)!;
    const y = offset(g, options.mode),
      minSpan = span * 0.06;
    const box = new THREE.Box3(
      new THREE.Vector3(r.minX, y, -r.maxY),
      new THREE.Vector3(r.maxX, y + Math.min(2, g.height), -r.minY),
    );
    box.expandByVector(new THREE.Vector3(minSpan, 0, minSpan));
    overview = false;
    frameBox(box, new THREE.Vector3(0.45, 1.35, 0.85).normalize(), 950);
  };
  const update = (next: SceneOptions) => {
    const previous = options;
    options = next;
    const changedView =
      !previous ||
      previous.mode !== next.mode ||
      previous.floorId !== next.floorId;
    if (
      !previous ||
      previous.state !== next.state ||
      previous.layers !== next.layers ||
      previous.location !== next.location
    )
      rebuildOverlays(next);
    for (const g of groups.values()) {
      g.assets.update(
        next.layers.assets,
        next.selected?.kind === "asset" ? next.selected.id : undefined,
        next.state.assets,
      );
      g.walls.children.forEach((w) => {
        const m = (w as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (!m.userData.base) m.userData.base = m.color.clone();
        m.color.copy(
          next.finish === "materials"
            ? new THREE.Color("#e2dbc9")
            : m.userData.base,
        );
      });
    }
    const closed = visibleClosures(data, next.state.closed),
      highlighted = new Set(next.state.spaces);
    exteriorClosed = closed;
    for (const connection of connections)
      connection.setState(
        closed.has(connection.layout.connector.id) ||
          connection.layout.stops.some((s) => closed.has(s.space.id)),
        next.selected?.id === connection.layout.connector.id,
      );
    for (const [id, r] of rooms) {
      const color = closed.has(id)
        ? new THREE.Color("#a82c47")
        : highlighted.has(id)
          ? new THREE.Color("#ddb74e")
          : next.finish === "materials" && next.mode !== "building"
            ? r.finishColor
            : r.color;
      r.material.color.copy(color).lerp(new THREE.Color("#fff9ed"), 0.2);
      r.roofMaterial.color.copy(
        next.finish === "materials" && !closed.has(id) && !highlighted.has(id)
          ? r.color
          : color,
      );
      const selected = next.selected?.id === id;
      r.material.emissive.set(selected ? "#244a9d" : "#000000");
      r.material.emissiveIntensity = selected ? 0.28 : 0;
      r.roofMaterial.emissive.copy(r.material.emissive);
      r.roofMaterial.emissiveIntensity = r.material.emissiveIntensity;
    }
    if (changedView) {
      navRevision = -1;
      if (!previous) {
        const center = boxFor(next.mode, next.floorId).getCenter(
          new THREE.Vector3(),
        );
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(direction, span * 3.5);
        controls.update();
      }
      fit();
    }
    if (
      next.selected &&
      (!previous || previous.selected?.id !== next.selected.id)
    )
      focus(next.selected);
    controls.autoRotate = next.orbit && !reduced.matches;
  };
  const zoom = (factor: number, anchor?: THREE.Vector3) => {
    const target = flight?.toTarget.clone() ?? controls.target.clone(),
      position = flight?.to.clone() ?? camera.position.clone();
    const delta = position.clone().sub(target),
      distance = THREE.MathUtils.clamp(
        delta.length() * factor,
        controls.minDistance,
        controls.maxDistance,
      );
    if (anchor && factor < 1) target.lerp(anchor, Math.min(0.3, 1 - factor));
    overview = false;
    fly(
      target.clone().add(delta.normalize().multiplyScalar(distance)),
      target,
      200,
      easeZoom,
    );
  };
  // Wheel zoom is accumulated here and eased in the render loop, so a trackpad burst of events
  // becomes one smooth motion instead of many restarted flights.
  let pendingZoom = 0,
    zoomAnchor: THREE.Vector3 | null = null;
  const applyZoom = (factor: number, anchor: THREE.Vector3 | null) => {
    const target = controls.target,
      delta = camera.position.clone().sub(target),
      distance = THREE.MathUtils.clamp(
        delta.length() * factor,
        controls.minDistance,
        controls.maxDistance,
      );
    if (anchor && factor < 1) target.lerp(anchor, Math.min(0.3, 1 - factor));
    overview = false;
    camera.position.copy(target).add(delta.normalize().multiplyScalar(distance));
  };
  const observer = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    renderer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    if (overview && options) fit();
  });
  observer.observe(container);
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  const cast = (event: PointerEvent | WheelEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
  };
  const isVisible = (object: THREE.Object3D): boolean =>
    object.visible && (!object.parent || isVisible(object.parent));
  const pick = (event: PointerEvent) => {
    cast(event);
    const overlays = [...groups.values()]
      .flatMap((g) => g.overlays.children)
      .filter((m) => m.userData.id);
    return ray
      .intersectObjects(
        [
          ...picks,
          ...overlays,
          ...[...groups.values()].flatMap((g) => g.assets.meshes),
        ].filter(isVisible),
        false,
      )
      .find((hit) => isVisible(hit.object));
  };
  const selectionForHit = (hit: THREE.Intersection): Selection => {
    if (hit.object.userData.exterior) {
      const point: [number, number] = [hit.point.x, -hit.point.z];
      const candidates = data.spaces.filter(
        (s) =>
          !isOutdoor(s) &&
          floorGeometry(floors.find((f) => f.id === s.floor_id)!).elevation <=
            hit.point.y + 0.15,
      );
      const distance = (s: Space) =>
        pointInside(point, s.polygon)
          ? 0
          : Math.min(
              ...s.polygon.map((a, i) => {
                const b = s.polygon[(i + 1) % s.polygon.length],
                  dx = b[0] - a[0],
                  dy = b[1] - a[1],
                  t = Math.max(
                    0,
                    Math.min(
                      1,
                      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
                        (dx * dx + dy * dy || 1),
                    ),
                  );
                return Math.hypot(
                  point[0] - a[0] - dx * t,
                  point[1] - a[1] - dy * t,
                );
              }),
            );
      candidates.sort(
        (a, b) =>
          distance(a) - distance(b) ||
          floorGeometry(floors.find((f) => f.id === b.floor_id)!).elevation -
            floorGeometry(floors.find((f) => f.id === a.floor_id)!).elevation,
      );
      return candidates[0] ? { kind: "space", id: candidates[0].id } : null;
    }
    const id = assetHit(hit);
    if (id) return { kind: "asset", id };
    const wall =
      hit.faceIndex != null
        ? hit.object.userData.wallSpaces?.[Math.floor(hit.faceIndex / 12)]
        : undefined;
    return wall
      ? { kind: "space", id: wall }
      : { kind: hit.object.userData.kind, id: hit.object.userData.id };
  };
  let down: [number, number] | null = null;
  const stopFlight = () => {
    flight = null;
    controls.autoRotate = false;
    overview = false;
    onInteract();
  };
  const pointerDown = (e: PointerEvent) => {
    down = [e.clientX, e.clientY];
    stopFlight();
  };
  const pointerUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) {
      down = null;
      return;
    }
    down = null;
    const hit = pick(e);
    if (hit) onSelect(selectionForHit(hit));
  };
  let lastHover = 0;
  const move = (e: PointerEvent) => {
    if (e.buttons || performance.now() - lastHover < 60) return;
    lastHover = performance.now();
    const hit = pick(e);
    const selection = hit ? selectionForHit(hit) : null;
    hoveredAsset = selection?.kind === "asset" ? selection.id : null;
    hovered = selection?.kind === "space" ? selection.id : null;
    renderer.domElement.style.cursor = hit ? "pointer" : "grab";
  };
  const leave = () => {
    hovered = null;
    hoveredAsset = null;
    down = null;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    controls.autoRotate = false;
    onInteract();
    cast(e);
    const anchor = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -controls.target.y),
      anchor,
    );
    if (flight) flight = null;
    pendingZoom = THREE.MathUtils.clamp(
      pendingZoom + wheelZoomStep(e, height),
      -1.2,
      1.2,
    );
    zoomAnchor = hit ? anchor.clone() : null;
  };
  const lost = (e: Event) => {
    e.preventDefault();
    onError("The graphics context was lost. Reopen 3D to retry.");
  };
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("wheel", wheel, {
    passive: false,
    capture: true,
  });
  renderer.domElement.addEventListener("webglcontextlost", lost);
  let hoveredAsset: string | null = null;
  const objectTag = document.createElement("div");
  objectTag.className = "scene-object-tag";
  objectTag.setAttribute("aria-hidden", "true");
  objectTag.hidden = true;
  labelHost.appendChild(objectTag);
  const labels = [...rooms.values()].sort((a, b) => b.area - a.area);
  const project = (world: THREE.Vector3) => {
    const p = world.clone().project(camera);
    return {
      x: (p.x * 0.5 + 0.5) * width,
      y: (-0.5 * p.y + 0.5) * height,
      z: p.z,
    };
  };
  const drawLabels = () => {
    if (!options) return;
    const occupied: { x: number; y: number; w: number }[] = [];
    exterior.drawLabels(
      project,
      width,
      height,
      occupied,
      options.layers.labels,
    );
    const assetId =
      hoveredAsset ??
      (options.selected?.kind === "asset" ? options.selected.id : null);
    const asset = assetId
      ? data.assets?.find((a) => a.id === assetId)
      : undefined;
    const assetFloor = asset && groups.get(asset.floor_id);
    objectTag.hidden = true;
    if (
      asset &&
      assetFloor?.group.visible &&
      assetFloor.assets.group.visible &&
      (options.layers.assets ||
        options.selected?.id === asset.id ||
        options.state.assets.includes(asset.id))
    ) {
      const d = describeAsset(asset, assetFloor.height),
        p = project(
          new THREE.Vector3(
            asset.position[0],
            assetFloor.group.position.y + d.height + 0.18,
            -asset.position[1],
          ),
        );
      objectTag.textContent = asset.name + " · " + d.typeLabel;
      objectTag.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;
      objectTag.hidden =
        p.z > 1 ||
        p.z < -1 ||
        p.x < 50 ||
        p.x > width - 50 ||
        p.y < 80 ||
        p.y > height - 100;
      if (!objectTag.hidden) occupied.push({ x: p.x, y: p.y, w: 220 });
    }
    for (const r of labels) r.tag.hidden = true;
    for (const [id, g] of groups) {
      const show = options.mode === "floors" && g.group.visible;
      g.tag.hidden = !show;
      if (show) {
        const p = project(
          new THREE.Vector3(b.minX - span * 0.04, g.group.position.y, -b.minY),
        );
        g.tag.style.transform = `translate(${p.x}px,${p.y}px) translate(-100%,-50%)`;
        g.tag.hidden = p.z > 1 || p.z < -1;
      }
      if (options.mode === "inside" && id !== options.floorId)
        g.tag.hidden = true;
    }
    const heights = new Map(
      [...groups].map(([id, g]) => [id, g.group.position.y]),
    );
    const orderedConnections = [...connections].sort(
      (a, b) =>
        Number(b.layout.connector.id === options!.selected?.id) -
        Number(a.layout.connector.id === options!.selected?.id),
    );
    let shownConnections = 0;
    for (const connection of orderedConnections) {
      connection.tag.hidden = true;
      if (options.mode === "building") continue;
      if (
        options.mode === "inside" &&
        !connection.layout.stops.some((s) => s.floorId === options!.floorId)
      )
        continue;
      const anchor =
        options.mode === "inside"
          ? (() => {
              const stop = connection.layout.stops.find(
                (s) => s.floorId === options!.floorId,
              )!;
              return new THREE.Vector3(
                stop.point[0],
                (heights.get(stop.floorId) ?? stop.elevation) + 0.6,
                -stop.point[1],
              );
            })()
          : connection.anchor(heights);
      const p = project(anchor),
        important = options.selected?.id === connection.layout.connector.id;
      if (
        p.z > 1 ||
        p.z < -1 ||
        p.x < 85 ||
        p.x > width - 85 ||
        p.y < 65 ||
        p.y > height - 105
      )
        continue;
      if (
        !important &&
        (shownConnections >= 6 ||
          occupied.some(
            (o) =>
              Math.abs(o.x - p.x) < (o.w + 180) / 2 && Math.abs(o.y - p.y) < 30,
          ))
      )
        continue;
      connection.tag.hidden = false;
      connection.tag.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;
      occupied.push({ x: p.x, y: p.y, w: 180 });
      shownConnections++;
    }
    if (!options.layers.labels) return;
    const ordered = [...labels].sort(
      (a, b) =>
        Number(b.space.id === options!.selected?.id || b.space.id === hovered) -
        Number(a.space.id === options!.selected?.id || a.space.id === hovered),
    );
    let count = 0;
    for (const r of ordered) {
      const g = groups.get(r.space.floor_id)!;
      if (!g.group.visible) continue;
      const important =
        r.space.id === options.selected?.id || r.space.id === hovered;
      if (options.mode === "building" && !important) continue;
      // In a separated stack show labels on the active floor; other levels have badges.
      if (
        options.mode === "floors" &&
        r.space.floor_id !== options.floorId &&
        !important
      )
        continue;
      const anchor = r.anchor.clone();
      anchor.y =
        g.group.position.y +
        (options.mode === "building" ? g.height + 0.3 : 0.4);
      const p = project(anchor),
        labelWidth = Math.min(150, label(r.space).length * 5.5 + 18);
      if (
        p.z > 1 ||
        p.z < -1 ||
        p.x < labelWidth / 2 + 10 ||
        p.x > width - labelWidth / 2 - 10 ||
        p.y < 60 ||
        p.y > height - 100
      )
        continue;
      if (!important) {
        const projected = project(
          anchor.clone().add(new THREE.Vector3(Math.sqrt(r.area) * 0.6, 0, 0)),
        );
        if (
          Math.abs(projected.x - p.x) < 35 ||
          count > 25 ||
          occupied.some(
            (o) =>
              Math.abs(o.x - p.x) < (o.w + labelWidth) / 2 + 8 &&
              Math.abs(o.y - p.y) < 30,
          )
        )
          continue;
      }
      r.tag.hidden = false;
      r.tag.classList.toggle("selected", important);
      r.tag.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
      occupied.push({ x: p.x, y: p.y, w: labelWidth });
      count++;
    }
  };
  let frame = 0,
    last = performance.now(),
    labelTime = 0,
    roofOpacity = 1;
  const render = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!document.hidden && options) {
      const blend = reduced.matches ? 1 : 1 - Math.exp(-dt * 7);
      roofOpacity = THREE.MathUtils.lerp(
        roofOpacity,
        options.mode === "building" ? 1 : LOOK.ceilings ? LOOK.ceilingOpacity : 0,
        blend,
      );
      roofEdgeMaterial.opacity = roofOpacity * 0.65;
      for (const room of rooms.values()) {
        const transparent = roofOpacity < 0.995;
        if (room.roofMaterial.transparent !== transparent) {
          room.roofMaterial.transparent = transparent;
          room.roofMaterial.needsUpdate = true;
        }
        room.roofMaterial.opacity = roofOpacity;
        room.roofMaterial.depthWrite = !transparent;
      }
      for (const [id, g] of groups) {
        g.group.visible =
          options.mode !== "building" &&
          (options.mode !== "inside" || id === options.floorId);
        g.group.position.y = THREE.MathUtils.lerp(
          g.group.position.y,
          offset(g, options.mode),
          blend,
        );
        const wallScale =
          options.mode === "building" ||
          LOOK.fullHeightWalls ||
          (navigation?.getFrame().firstPerson && navigation.getFrame().follow)
            ? 1
            : Math.min(
                options.selected?.kind === "asset" ? 0.28 : 0.7,
                g.height,
              ) / g.height;
        g.walls.scale.y = THREE.MathUtils.lerp(
          g.walls.scale.y,
          wallScale,
          blend,
        );
        g.roofs.visible = LOOK.ceilings && options.mode !== "building";
        g.overlays.visible = options.mode !== "building";
        g.assets.group.visible = options.mode !== "building";
      }
      const displayHeights = new Map(
        [...groups].map(([id, g]) => [id, g.group.position.y]),
      );
      exterior.update(
        options.mode,
        options.floorId,
        displayHeights,
        options.selected?.id,
        exteriorClosed,
      );
      shadow.position.y =
        options.mode === "building" ? envelope.ground - 0.51 : minimumY - 0.2;
      for (const connection of connections)
        connection.update(options.mode, options.floorId, displayHeights);
      for (const connection of connections)
        connection.group.visible = options.mode !== "building";
      const nav = navigation?.getFrame();
      footsteps.group.visible =
        !!nav?.active && options.layers.route && options.mode !== "building";
      if (nav?.active)
        footsteps.update(
          nav,
          (id) => {
            const f = groups.get(id);
            return f ? f.group.position.y - f.elevation : 0;
          },
          (id) => options!.mode !== "inside" || options!.floorId === id,
        );
      const eyeView = !!nav?.active && nav.follow && nav.firstPerson;
      controls.enabled = !eyeView;
      if (camera.fov !== (eyeView ? 65 : 36)) {
        camera.fov = eyeView ? 65 : 36;
        camera.updateProjectionMatrix();
      }
      actor.group.visible = !!nav?.active && options.layers.route;
      transferLine.visible =
        !!nav?.active &&
        !!nav.follow &&
        nav.leg?.kind === "connector" &&
        options.layers.route;
      if (transferLine.visible && nav?.leg !== transferLeg) {
        transferLeg = nav!.leg;
        transferLine.geometry.dispose();
        transferLine.geometry = new THREE.BufferGeometry().setFromPoints(
          nav!.leg!.points.map(
            (p) => new THREE.Vector3(p[0], p[1] + 0.35, p[2]),
          ),
        );
        transferLine.computeLineDistances();
      }

      if (nav?.active && options.layers.route) {
        const position = new THREE.Vector3(...nav.point);
        const leg = nav.leg!;
        const from = groups.get(leg.floorId),
          to = groups.get(leg.toFloorId);
        const dy1 = from ? from.group.position.y - from.elevation : 0,
          dy2 = to ? to.group.position.y - to.elevation : 0;
        position.y +=
          leg.kind === "connector"
            ? THREE.MathUtils.lerp(dy1, dy2, nav.legProgress)
            : dy1;
        actor.group.position.copy(position).add(new THREE.Vector3(0, 0.32, 0));
        actor.setHeading(nav.heading);
        actor.group.visible =
          !eyeView &&
          options.mode !== "building" &&
          (options.mode !== "inside" || options.floorId === nav.floorId);
        if (nav.follow) {
          if (eyeView) {
            flight = null;
            const standing =
              leg.kind === "connector"
                ? new THREE.Vector3(...leg.points[0])
                : position.clone();
            const eye = standing.add(new THREE.Vector3(0, 1.65, 0));
            const target = eye
              .clone()
              .add(
                new THREE.Vector3(
                  Math.sin(nav.heading) * 3,
                  -0.85,
                  -Math.cos(nav.heading) * 3,
                ),
              );
            const k = reduced.matches ? 1 : 1 - Math.exp(-dt * 10);
            // Smoothing position cuts across corridor corners and through their walls.
            camera.position.copy(eye);
            controls.target.lerp(target, k);
            camera.lookAt(controls.target);
          } else if (
            nav.revision !== navRevision ||
            nav.legIndex !== navLeg ||
            !wasFollowing
          ) {
            const box =
              leg.kind === "connector"
                ? new THREE.Box3()
                    .setFromPoints(
                      leg.points.map((p) => new THREE.Vector3(...p)),
                    )
                    .expandByScalar(2)
                : new THREE.Box3(
                    position.clone().add(new THREE.Vector3(-6, -0.5, -6)),
                    position.clone().add(new THREE.Vector3(6, 2.5, 6)),
                  );
            overview = false;
            frameBox(box, new THREE.Vector3(0.65, 1.4, 1).normalize(), 800);
          }
          if (!eyeView && !flight && leg.kind === "walk") {
            const target = position.clone().add(new THREE.Vector3(0, 0.5, 0)),
              previous = controls.target.clone();
            controls.target.lerp(
              target,
              reduced.matches ? 1 : 1 - Math.exp(-dt * 6),
            );
            camera.position.add(controls.target.clone().sub(previous));
          }
        }
        navRevision = nav.revision;
        navLeg = nav.legIndex;
        wasFollowing = nav.follow;
      } else wasFollowing = false;
      for (const segment of routeSegments) {
        const leg = nav?.plan.legs.filter(
          (l) => l.kind === "walk" && l.floorId === segment.floorId,
        )[segment.floorLeg];
        const distance = leg ? Math.max(0, nav!.distance - leg.start) : 0,
          amount = Math.min(
            segment.length,
            Math.max(0, distance - segment.start),
          );
        segment.mesh.visible = amount > 0.001;
        if (amount > 0.001) {
          segment.mesh.scale.y = amount;
          segment.mesh.position
            .copy(segment.a)
            .lerp(segment.b, amount / segment.length / 2);
          segment.mesh.position.y += 0.035;
        }
      }
      if (flight) {
        const t =
            flight.duration && !reduced.matches
              ? Math.min((now - flight.start) / flight.duration, 1)
              : 1,
          k = flight.easing(t);
        camera.position.lerpVectors(flight.from, flight.to, k);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
        if (t === 1) flight = null;
      }
      if (pendingZoom !== 0) {
        const step =
          Math.abs(pendingZoom) < 1e-4
            ? pendingZoom
            : pendingZoom * (1 - Math.exp(-dt * ZOOM_SMOOTHING));
        applyZoom(Math.exp(step), zoomAnchor);
        pendingZoom = Math.abs(pendingZoom - step) < 1e-4 ? 0 : pendingZoom - step;
      }
      controls.autoRotate = options.orbit && !reduced.matches;
      if (!eyeView) controls.update(dt);
      renderer.render(scene, camera);
      if (now - labelTime > 40) {
        drawLabels();
        labelTime = now;
      }
    }
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  let disposed = false;
  let teamModels: Awaited<ReturnType<typeof loadAssetModels>> | undefined;
  void loadAssetModels(
    data.assets ?? [],
    `${import.meta.env.BASE_URL}models/`,
  ).then((models) => {
    if (disposed) {
      models.forEach((model) => model.dispose());
      return;
    }
    teamModels = models;
    if (!models.size) return;
    for (const [floorId, floor] of groups) {
      const previous = floor.assets;
      const replacement = createAssetScene(
        (data.assets ?? []).filter((asset) => asset.floor_id === floorId),
        floor.height,
        models,
      );
      replacement.group.visible = previous.group.visible;
      if (options)
        replacement.update(
          options.layers.assets,
          options.selected?.kind === "asset" ? options.selected.id : undefined,
          options.state.assets,
        );
      floor.group.remove(previous.group);
      previous.dispose();
      floor.assets = replacement;
      floor.group.add(replacement.group);
    }
  });
  return {
    bindNavigation(store: PlaybackStore, avatar: number) {
      navigation = store;
      actor.setAvatar(avatar);
      navRevision = -1;
    },
    update,
    fit,
    focus,
    zoom,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerleave", leave);
      renderer.domElement.removeEventListener("wheel", wheel, true);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      transferLine.geometry.dispose();
      overlayResources.forEach((r) => r.dispose());
      resources.forEach((r) => r.dispose());
      teamModels?.forEach((model) => model.dispose());
      sun.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelHost.replaceChildren();
    },
  };
}
