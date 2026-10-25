import type { Asset } from "../types";
import { parseFootprint } from "../types.ts";

export type ObjectFamily =
  | "chair"
  | "table"
  | "sofa"
  | "bed"
  | "rack"
  | "cabinet"
  | "server"
  | "machine"
  | "forklift"
  | "pallet_jack"
  | "conveyor"
  | "plant"
  | "toilet"
  | "sink"
  | "bath"
  | "shower"
  | "counter"
  | "fridge"
  | "stove"
  | "coffee"
  | "screen"
  | "extinguisher"
  | "printer"
  | "bench"
  | "appliance"
  | "instrument"
  | "stairs"
  | "lectern"
  | "unknown";
export type ObjectDescriptor = {
  family: ObjectFamily;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  footprintKnown: boolean;
  heightKnown: boolean;
  typeLabel: string;
  provenance: string;
};
const profiles: [RegExp, ObjectFamily, number][] = [
  [/^internal_stairs$/, "stairs", 2.7],
  [/^lectern$/, "lectern", 1.2],
  [/fire_extinguisher/, "extinguisher", 0.65],
  [/forklift_charging/, "appliance", 1.25],
  [/forklift/, "forklift", 2.2],
  [/pallet_jack/, "pallet_jack", 1.2],
  [/conveyor/, "conveyor", 0.85],
  [/server_rack|ups_unit/, "server", 2.0],
  [/pallet_rack|shelf|bookshelf/, "rack", 1.9],
  [
    /^(chair|office_chair|dining_chair|outdoor_chair|lecture_seating_row)$/,
    "chair",
    0.95,
  ],
  [/sofa|armchair/, "sofa", 0.85],
  [/single_bed|^bed$/, "bed", 0.65],
  [/coffee_table|nightstand|tv_stand/, "table", 0.45],
  [
    /table|desk|workbench|lab_bench|assembly_station|packing_station|inspection_bench|serving_counter|reception_desk/,
    "table",
    0.76,
  ],
  [/^bench$/, "bench", 0.48],
  [/wardrobe|cabinet|locker/, "cabinet", 1.85],
  [/plant/, "plant", 1.1],
  [/toilet/, "toilet", 0.8],
  [/sink|eyewash/, "sink", 0.88],
  [/bathtub/, "bath", 0.58],
  [/shower/, "shower", 1.9],
  [/kitchen_counter/, "counter", 0.9],
  [/fridge|vending_machine|atm/, "fridge", 1.75],
  [/stove/, "stove", 0.9],
  [/coffee_machine|water_dispenser/, "coffee", 0.55],
  [/screen|whiteboard/, "screen", 1.45],
  [/multifunction_printer|^printer$/, "printer", 0.75],
  [/microscope|oscilloscope|projector/, "instrument", 0.5],
  [
    /cnc|mill|lathe|press|laser|cutter|robot|moulding|welding|3d_printer|oven|hood|powder|coordinate_measuring|compressor|soldering/,
    "machine",
    1.65,
  ],
  [/dishwasher|washing_machine/, "appliance", 0.85],
  [/microwave/, "appliance", 0.35],
  [/boiler|hvac|panel|charging/, "appliance", 1.3],
  [/dryer|defibrillator|waste_basket|coat_rack/, "appliance", 0.55],
];
export function describeAsset(
  asset: Asset,
  floorHeight = Infinity,
): ObjectDescriptor {
  const type = (asset.type ?? "").toLowerCase();
  const profile = profiles.find(([pattern]) => pattern.test(type));
  const fp = parseFootprint(asset.footprint);
  const supplied = asset.height_m;
  const heightKnown =
    typeof supplied === "number" && Number.isFinite(supplied) && supplied > 0;
  return {
    family: profile?.[1] ?? "unknown",
    width: fp?.width_m ?? 0.45,
    depth: fp?.depth_m ?? 0.45,
    rotation: fp?.rotation_deg ?? 0,
    height: heightKnown
      ? supplied
      : Math.min(profile?.[2] ?? 0.5, Math.max(0.2, floorHeight * 0.9)),
    footprintKnown: !!fp,
    heightKnown,
    typeLabel: asset.type?.replaceAll("_", " ") || "Unclassified object",
    provenance:
      asset.source === "dataset"
        ? "Dataset annotation"
        : asset.source === "generated"
          ? "Generated furnishing"
          : asset.source
            ? "Source: " + asset.source
            : "Source unspecified",
  };
}

export type Part = {
  shape: "box" | "round" | "cylinder" | "sphere" | "pot";
  at: [number, number, number];
  size: [number, number, number];
  material:
    | "wood"
    | "metal"
    | "dark"
    | "fabric"
    | "white"
    | "blue"
    | "glass"
    | "green"
    | "red"
    | "gold";
  rotate?: [number, number, number];
};
/** Normalised, original display models. Footprints/rotations are supplied; appearances are illustrative. */
export function objectParts(family: ObjectFamily, type = ""): Part[] {
  const p: Part[] = [];
  const box = (
    at: Part["at"],
    size: Part["size"],
    material: Part["material"] = "white",
    shape: Part["shape"] = "box",
    rotate?: Part["rotate"],
  ) => p.push({ shape, at, size, material, rotate });
  const legs = (top = 0.85, spread = 0.4) => {
    for (const x of [-spread, spread])
      for (const z of [-spread, spread])
        box([x, top / 2, z], [0.055, top, 0.055], "metal");
  };
  switch (family) {
    case "stairs":
      for (let i = 0; i < 10; i++)
        box([0, (i + 1) / 20, -0.45 + i * 0.1], [1, (i + 1) / 10, 0.1], "wood");
      break;
    case "lectern":
      box([0, 0.045, 0], [0.85, 0.09, 0.85], "metal");
      box([0, 0.49, 0.1], [0.25, 0.87, 0.25], "wood");
      box([0, 0.95, 0], [1, 0.1, 0.9], "wood", "round");
      break;
    case "chair":
      box([0, 0.5, 0], [0.87, 0.12, 0.78], "fabric", "round");
      box([0, 0.78, 0.36], [0.86, 0.44, 0.1], "fabric", "round");
      if (/office/.test(type)) {
        box([0, 0.23, 0], [0.11, 0.45, 0.11], "metal", "cylinder");
        box([0, 0.06, 0], [0.88, 0.06, 0.12], "dark");
        box([0, 0.06, 0], [0.12, 0.06, 0.88], "dark");
      } else legs(0.45, 0.32);
      break;
    case "table":
      legs(0.91);
      box(
        [0, 0.95, 0],
        [1, 0.1, 1],
        /lab|workbench|assembly|inspection/.test(type) ? "white" : "wood",
        "round",
      );
      break;
    case "bench":
      legs(0.78);
      box([0, 0.89, 0], [1, 0.22, 0.95], "wood", "round");
      break;
    case "sofa":
      legs(0.15, 0.36);
      box([0, 0.38, 0], [0.95, 0.5, 0.95], "fabric", "round");
      box([0, 0.77, 0.4], [1, 0.46, 0.19], "fabric", "round");
      for (const x of [-0.44, 0.44])
        box([x, 0.6, 0], [0.12, 0.5, 0.95], "fabric", "round");
      for (const x of [-0.21, 0.21])
        box([x, 0.66, -0.04], [0.4, 0.12, 0.7], "blue", "round");
      break;
    case "bed":
      legs(0.24);
      box([0, 0.3, 0], [1, 0.25, 1], "wood", "round");
      box([0, 0.54, 0], [0.95, 0.25, 0.95], "white", "round");
      box([0, 0.73, 0.1], [0.96, 0.16, 0.64], "blue", "round");
      for (const x of [-0.23, 0.23])
        box([x, 0.72, -0.34], [0.42, 0.14, 0.23], "white", "round");
      box([0, 0.7, -0.47], [1, 0.6, 0.06], "wood");
      break;
    case "rack":
      for (const x of [-0.47, 0.47])
        for (const z of [-0.44, 0.44])
          box(
            [x, 0.5, z],
            [0.055, 1, 0.06],
            /pallet/.test(type) ? "blue" : "wood",
          );
      for (const y of [0.08, 0.32, 0.56, 0.8, 0.98])
        box([0, y, 0], [1, 0.035, 0.96], /pallet/.test(type) ? "gold" : "wood");
      break;
    case "server":
      box([0, 0.5, 0], [1, 1, 1], "dark", "round");
      box([0, 0.52, -0.505], [0.85, 0.88, 0.018], "metal");
      for (const y of [0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.88])
        box([0, y, -0.52], [0.72, 0.06, 0.02], "dark");
      break;
    case "cabinet":
      box(
        [0, 0.5, 0],
        [1, 1, 1],
        /tool|filing|locker/.test(type) ? "blue" : "wood",
        "round",
      );
      for (const x of [-0.24, 0.24]) {
        box(
          [x, 0.52, -0.5],
          [0.46, 0.93, 0.025],
          /tool|filing|locker/.test(type) ? "metal" : "wood",
        );
        box([x * 0.25, 0.54, -0.52], [0.025, 0.14, 0.025], "dark");
      }
      break;
    case "machine":
      box([0, 0.13, 0], [1, 0.26, 1], "dark", "round");
      box([-0.06, 0.57, 0.06], [0.85, 0.86, 0.84], "white", "round");
      box([-0.06, 0.61, -0.37], [0.62, 0.52, 0.035], "dark");
      box([0.39, 0.7, -0.2], [0.18, 0.24, 0.12], "blue", "round");
      box([0.39, 0.73, -0.267], [0.13, 0.13, 0.015], "glass");
      box([-0.06, 0.25, -0.38], [0.64, 0.055, 0.15], "metal");
      break;
    case "forklift":
      box([0, 0.24, 0.13], [0.88, 0.27, 0.6], "gold", "round");
      box([0, 0.46, 0.2], [0.5, 0.2, 0.3], "dark", "round");
      for (const x of [-0.39, 0.39])
        for (const z of [-0.1, 0.35])
          box([x, 0.13, z], [0.24, 0.15, 0.24], "dark", "cylinder", [
            0,
            0,
            Math.PI / 2,
          ]);
      for (const x of [-0.35, 0.35])
        for (const z of [0.01, 0.39])
          box([x, 0.69, z], [0.035, 0.6, 0.035], "metal");
      box([0, 0.99, 0.2], [0.8, 0.03, 0.5], "metal");
      for (const x of [-0.23, 0.23]) {
        box([x, 0.49, -0.18], [0.07, 0.98, 0.05], "metal");
        box([x, 0.06, -0.34], [0.09, 0.04, 0.32], "metal");
      }
      break;
    case "pallet_jack":
      for (const x of [-0.3, 0.3])
        box([x, 0.07, -0.03], [0.22, 0.1, 0.9], "gold", "round");
      box([0, 0.15, 0.33], [0.8, 0.24, 0.26], "gold", "round");
      box([0, 0.64, 0.33], [0.07, 0.7, 0.07], "metal");
      box([0, 0.96, 0.33], [0.55, 0.07, 0.07], "dark");
      break;
    case "conveyor":
      legs(0.78);
      for (const x of [-0.46, 0.46]) box([x, 0.88, 0], [0.08, 0.18, 1], "blue");
      for (let i = 0; i < 9; i++)
        box(
          [0, 0.91, -0.42 + i * 0.105],
          [0.08, 0.83, 0.08],
          "metal",
          "cylinder",
          [0, 0, Math.PI / 2],
        );
      break;
    case "plant":
      box([0, 0.18, 0], [0.48, 0.36, 0.48], "wood", "pot");
      box([0, 0.49, 0], [0.045, 0.65, 0.045], "wood", "cylinder");
      box([0, 0.76, 0], [0.58, 0.48, 0.58], "green", "sphere");
      box([-0.22, 0.62, 0.1], [0.4, 0.38, 0.4], "green", "sphere");
      box([0.23, 0.71, -0.12], [0.4, 0.4, 0.4], "green", "sphere");
      break;
    case "toilet":
      box([0, 0.18, -0.07], [0.4, 0.36, 0.5], "white", "cylinder");
      box([0, 0.48, -0.12], [0.78, 0.4, 0.75], "white", "sphere");
      box([0, 0.62, -0.15], [0.53, 0.04, 0.49], "dark", "cylinder");
      box([0, 0.69, 0.36], [0.73, 0.62, 0.27], "white", "round");
      break;
    case "sink":
    case "counter":
      box([0, 0.46, 0], [0.96, 0.92, 0.94], "wood", "round");
      box([0, 0.94, 0], [1, 0.08, 1], "white", "round");
      if (family === "sink") {
        box([0, 0.985, 0], [0.65, 0.025, 0.65], "metal", "round");
        box([0, 0.99, 0.37], [0.07, 0.14, 0.07], "metal", "cylinder");
      }
      break;
    case "bath":
      box([0, 0.4, 0], [1, 0.8, 1], "white", "round");
      box([0, 0.82, 0], [0.83, 0.04, 0.8], "metal", "round");
      break;
    case "shower":
      box([0, 0.04, 0], [1, 0.08, 1], "white", "round");
      box([0, 0.54, 0.45], [0.95, 0.92, 0.035], "glass");
      box([0.45, 0.54, 0], [0.035, 0.92, 0.95], "glass");
      box([0, 0.91, 0.35], [0.18, 0.02, 0.16], "metal");
      break;
    case "fridge":
    case "appliance":
      box([0, 0.5, 0], [1, 1, 1], "white", "round");
      box([0, 0.67, -0.505], [0.9, 0.6, 0.018], "metal");
      box([-0.33, 0.65, -0.53], [0.03, 0.27, 0.035], "dark");
      box([0, 0.23, -0.505], [0.9, 0.24, 0.018], "white");
      break;
    case "stove":
      box([0, 0.47, 0], [1, 0.94, 1], "white", "round");
      box([0, 0.97, 0], [1, 0.05, 1], "dark");
      for (const x of [-0.25, 0.25])
        for (const z of [-0.24, 0.24])
          box([x, 1, z], [0.29, 0.02, 0.29], "metal", "cylinder");
      box([0, 0.53, -0.505], [0.8, 0.48, 0.02], "glass");
      break;
    case "coffee":
      box([0, 0.47, 0.1], [0.82, 0.94, 0.77], "dark", "round");
      box([0, 0.65, -0.31], [0.68, 0.37, 0.06], "metal");
      box([0, 0.12, -0.31], [0.8, 0.06, 0.35], "metal");
      box([0, 0.41, -0.35], [0.38, 0.06, 0.14], "dark");
      break;
    case "screen":
      box([0, 0.06, 0], [0.5, 0.08, 0.65], "metal");
      box([0, 0.35, 0.15], [0.06, 0.58, 0.06], "metal");
      box(
        [0, 0.72, 0.14],
        [1, 0.55, 0.08],
        /whiteboard/.test(type) ? "white" : "dark",
        "round",
      );
      box(
        [0, 0.72, 0.092],
        [0.93, 0.47, 0.015],
        /whiteboard/.test(type) ? "white" : "glass",
      );
      break;
    case "extinguisher":
      box([0, 0.43, 0], [0.64, 0.86, 0.64], "red", "cylinder");
      box([0, 0.91, 0], [0.18, 0.12, 0.18], "metal", "cylinder");
      box([0, 0.97, 0], [0.6, 0.06, 0.2], "dark");
      box([0.32, 0.65, 0], [0.06, 0.45, 0.06], "dark");
      break;
    case "printer":
      box([0, 0.35, 0], [1, 0.7, 1], "white", "round");
      box([0, 0.78, 0.14], [0.96, 0.16, 0.65], "dark", "round");
      box([0, 0.54, -0.51], [0.76, 0.09, 0.02], "dark");
      box([0.29, 0.93, -0.25], [0.25, 0.07, 0.2], "glass");
      break;
    case "instrument":
      box([0, 0.07, 0], [0.85, 0.14, 0.8], "metal", "round");
      box([0.15, 0.48, 0.15], [0.22, 0.75, 0.25], "white", "round");
      box([-0.07, 0.82, -0.07], [0.22, 0.35, 0.22], "dark", "cylinder");
      box([0, 0.4, -0.12], [0.55, 0.06, 0.5], "metal");
      break;
    default:
      box([0, 0.5, 0], [1, 1, 1], "metal", "round");
  }
  return p;
}
