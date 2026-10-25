import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyMapActions,
  emptyMapState,
  floorGeometry,
  interiorPoint,
  parseBuilding,
  pointAlong,
  pointInside,
  polygonArea,
  routeOnFloor,
  wallSegments,
  visibleClosures,
} from "../src/lib/model.ts";

const root = resolve(import.meta.dirname, "../..");
const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const square = [
  [-5, -3],
  [5, -3],
  [5, 7],
  [-5, 7],
];
const room = {
  id: "unseen-room",
  name: "A different room",
  ref: "A",
  type: "room",
  floor_id: "lower",
  polygon: square,
};
const unseen = {
  building: {
    id: "unseen-building",
    name: "Unseen building",
    source: "upload",
    units: "m",
    custom: { retain: true },
  },
  floors: [
    {
      id: "lower",
      name: "Lower level",
      level: -1,
      elevation_m: -4,
      height_m: 4,
    },
    { id: "upper", name: "Upper level", level: 1 },
  ],
  spaces: [room],
  openings: [],
  assets: [],
  vertical_connectors: [],
};

test("all 280 source buildings import without stripping data or metadata", () => {
  const paths = [...globSync("data/*/*/building.json", { cwd: root })];
  assert.ok(paths.length >= 280);
  let spaces = 0;
  for (const path of paths) {
    const b = load(resolve(root, path));
    assert.equal(parseBuilding(b), b, path);
    spaces += b.spaces.length;
  }
  assert.ok(spaces >= 22725);
});
test("the five bundled UI buildings exactly match the organizers’ source data", () => {
  const sources = new Map(
    [...globSync("data/*/*/building.json", { cwd: root })].map((path) => {
      const b = load(resolve(root, path));
      return [b.building.id, b];
    }),
  );
  const files = [...globSync("ui/public/buildings/*.json", { cwd: root })];
  assert.equal(files.length, 5);
  for (const file of files) {
    const data = load(resolve(root, file));
    assert.deepEqual(data, sources.get(data.building.id), file);
  }
});
test("an unseen building retains custom metadata, negative coordinates and basement elevations", () => {
  assert.equal(parseBuilding(unseen), unseen);
  assert.equal(polygonArea(room.polygon), 100);
  assert.deepEqual(floorGeometry(unseen.floors[0]), {
    elevation: -4,
    height: 4,
    estimated: false,
  });
  assert.deepEqual(floorGeometry(unseen.floors[1]), {
    elevation: 3,
    height: 3,
    estimated: true,
  });
});
test("concave room labels are inside the room even when its box centre lies outside", () => {
  const u = [
    [0, 0],
    [8, 0],
    [8, 8],
    [6, 8],
    [6, 2],
    [2, 2],
    [2, 8],
    [0, 8],
  ];
  assert.equal(pointInside([4, 4], u), false);
  assert.equal(pointInside(interiorPoint(u), u), true);
  assert.equal(pointInside(interiorPoint([...u].reverse()), u), true);
});
test("invalid imports fail before replacing the current map", () => {
  const edit = (fn) => {
    const b = structuredClone(unseen);
    fn(b);
    return b;
  };
  for (const b of [
    null,
    {},
    edit((b) => (b.spaces[0].polygon[0] = [Infinity, 0])),
    edit((b) => (b.spaces[0].floor_id = "missing")),
    edit((b) => b.spaces.push({ ...b.spaces[0] })),
    edit((b) => (b.floors[0].height_m = -1)),
    edit((b) => (b.floors[1].level = -1)),
    edit(
      (b) =>
        (b.spaces[0].polygon = [
          [0, 0],
          [1, 0],
          [2, 0],
        ]),
    ),
  ])
    assert.throws(() => parseBuilding(b));
  assert.equal(unseen.spaces.length, 1);
});
test("route geometry uses floor LEVELS including negative levels, not arbitrary floor IDs", () => {
  const points = [
      [-4, -2],
      [3, -2],
      [3, 6],
    ],
    route = {
      type: "route",
      length_m: 15,
      steps: ["A", "B"],
      floors: { "-1": points },
    };
  assert.equal(routeOnFloor(route, unseen.floors[0]), points);
  assert.deepEqual(routeOnFloor(route, unseen.floors[1]), []);
  assert.deepEqual(pointAlong(points, 0), [-4, -2]);
  assert.deepEqual(pointAlong(points, 7 / 15), [3, -2]);
  assert.deepEqual(pointAlong(points, 1), [3, 6]);
});
test("route preview interpolates along the supplied path without smoothing through corners", () => {
  const path = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  assert.deepEqual(pointAlong(path, 0.5), [10, 0]);
  assert.deepEqual(pointAlong(path, 0.75), [10, 5]);
  assert.deepEqual(
    pointAlong(
      [
        [1, 1],
        [1, 1],
      ],
      0.5,
    ),
    [1, 1],
  );
});
test("closing and reopening replaces the complete closure set and clears stale routes", () => {
  const route = {
    type: "route",
    length_m: 2,
    steps: [],
    floors: {
      0: [
        [0, 0],
        [2, 0],
      ],
    },
  };
  const before = { ...emptyMapState, route, closed: ["door-a"] };
  const after = applyMapActions(before, [{ type: "closed", element_ids: [] }]);
  assert.deepEqual(after.closed, []);
  assert.equal(after.route, null);
  assert.deepEqual(before.closed, ["door-a"]);
  const rerouted = applyMapActions(before, [
    route,
    { type: "closed", element_ids: ["door-b"] },
  ]);
  assert.equal(rerouted.route, route);
  assert.deepEqual(rerouted.closed, ["door-b"]);
});
test("door updates replace duplicates, invalidate old routes and preserve highlights", () => {
  const door = {
    id: "new-door",
    floor_id: "lower",
    space_ids: ["unseen-room", "outside"],
    kind: "entrance",
    position: [0, -3],
    width_m: 2,
  };
  let state = applyMapActions(emptyMapState, [
    { type: "highlight", space_ids: ["unseen-room"] },
    { type: "door_added", opening: door },
  ]);
  state = applyMapActions(state, [
    { type: "door_added", opening: { ...door, width_m: 3 } },
  ]);
  assert.equal(state.doors.length, 1);
  assert.equal(state.doors[0].width_m, 3);
  assert.deepEqual(state.spaces, ["unseen-room"]);
});
test("3D wall cuts preserve a measured opening, without carving unrelated edges", () => {
  const opening = {
    id: "door",
    floor_id: "lower",
    space_ids: ["unseen-room", "outside"],
    kind: "door",
    position: [0, -3],
    width_m: 2,
  };
  const length = (walls) =>
    walls.reduce(
      (sum, w) => sum + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]),
      0,
    );
  assert.equal(length(wallSegments(room, [])), 40);
  assert.equal(length(wallSegments(room, [opening])), 38);
  assert.equal(
    length(
      wallSegments(room, [{ ...opening, space_ids: ["other", "outside"] }]),
    ),
    40,
  );
  assert.equal(
    length(wallSegments(room, [{ ...opening, position: [0, 2] }])),
    40,
  );
});

test("a closed lift marks every stop room, then removes all closure marks when reopened", () => {
  const building = {
    ...unseen,
    vertical_connectors: [
      {
        id: "lift-link",
        kind: "lift",
        name: "Lift",
        floor_ids: ["lower", "upper"],
        space_ids: ["stop-a", "stop-b"],
      },
    ],
  };
  assert.deepEqual(
    [...visibleClosures(building, ["lift-link"])],
    ["lift-link", "stop-a", "stop-b"],
  );
  assert.equal(visibleClosures(building, []).size, 0);
});
