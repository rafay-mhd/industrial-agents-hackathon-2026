export interface BuildingData {
  building: {
    id: string;
    name: string;
    source: string;
    units?: string;
    license?: string;
    attribution?: string;
    split?: string;
    [key: string]: unknown;
  };
  floors: Floor[];
  spaces: Space[];
  openings?: Opening[];
  vertical_connectors?: VerticalConnector[];
  assets?: Asset[];
}

export interface Floor {
  id: string;
  level: number;
  name: string;
  elevation_m?: number;
  height_m?: number;
}

export interface Space {
  id: string;
  floor_id: string;
  type: "room" | "corridor" | "stair" | "lift" | "hall" | "outdoor" | string;
  room_type?: string;
  name: string;
  ref: string;
  polygon: [number, number][];
  synthetic?: boolean;
}

export interface Opening {
  id: string;
  floor_id: string;
  space_ids: string[];
  kind: "door" | "opening" | "entrance" | string;
  position: [number, number];
  name?: string;
  width_m?: number;
  step_free?: boolean;
  synthetic?: boolean;
}

export interface VerticalConnector {
  synthetic?: boolean;
  id: string;
  kind: "stairs" | "lift" | string;
  name: string;
  floor_ids: string[];
  space_ids: string[];
  step_free?: boolean;
}

export interface AssetFootprint {
  width_m: number;
  depth_m: number;
  rotation_deg: number;
}

export interface Asset {
  id: string;
  name: string;
  category?: string;
  type?: string;
  space_id: string;
  floor_id: string;
  position: [number, number];
  footprint?: AssetFootprint | [number, number, number];
  source?: string;
  height_m?: number;
}

export function parseFootprint(fp: unknown): AssetFootprint | null {
  if (!fp) return null;
  if (typeof fp === "object" && fp !== null && "width_m" in fp) {
    const o = fp as { width_m: number; depth_m: number; rotation_deg?: number };
    return {
      width_m: Number(o.width_m) || 1,
      depth_m: Number(o.depth_m) || 1,
      rotation_deg: Number(o.rotation_deg) || 0,
    };
  }
  if (Array.isArray(fp) && fp.length >= 2) {
    return {
      width_m: Number(fp[0]) || 1,
      depth_m: Number(fp[1]) || 1,
      rotation_deg: Number(fp[2]) || 0,
    };
  }
  return null;
}

// Route & Chat Types (Section 4.3 Contract)
export interface RouteAction {
  type: "route";
  destination_asset_id?: string | null;
  asset_query?: string | null;
  start_space_id?: string;
  destination_space_id?: string;
  via_space_ids?: string[];
  via_place_ids?: string[];
  step_free?: boolean;
  geometry_valid?: boolean;
  element_ids?: string[];
  geometry_notice?: string;
  distance_note?: string;
  length_m: number;
  steps: string[];
  floors: Record<string, [number, number][]>;
  segments?: {
    floor_id: string;
    points: [number, number][];
    exit_connector_id?: string;
  }[];
}

export interface HighlightAction {
  type: "highlight";
  space_ids?: string[];
  asset_ids?: string[];
}

export interface ClosedAction {
  type: "closed";
  element_ids: string[];
}

export interface DoorAddedAction {
  type: "door_added";
  opening: Opening;
}

export interface BuildingCreatedAction {
  type: "building_created";
  building_id: string;
}

export interface BuildingChange {
  id: string;
  kind: "closure" | "door_added" | "warning";
  status?: "active" | "resolved";
  element_id: string;
  label: string;
  at: string;
  closed?: boolean;
}
export interface BuildingStateAction {
  type: "building_state";
  preserve_route?: boolean;
  geometry_changed?: boolean;
  building: BuildingData;
}
export interface RouteUnavailableAction {
  type: "route_unavailable";
  reason: string;
}

export interface LiveWarning {
  id: string;
  element_id: string;
  label: string;
  kind:
    "lift_outage" | "blocked_access" | "hazard" | "equipment_outage" | "other";
  message: string;
  reporter: string;
  blocks_route: boolean;
  asset_unavailable?: boolean;
  space_id?: string | null;
  status: "active" | "resolved";
  created_at: string;
  updated_at: string;
  revision: number;
}
export interface RouteUpdateAction {
  type: "route_update";
  changed: boolean;
  title: string;
  message: string;
  previous_length_m: number | null;
  new_length_m: number | null;
  warning_ids: string[];
}
export type ChatAction =
  | RouteUpdateAction
  | BuildingStateAction
  | RouteUnavailableAction
  | RouteAction
  | HighlightAction
  | ClosedAction
  | DoorAddedAction
  | BuildingCreatedAction;

export interface ChatResponse {
  reply: string;
  understood: string | null;
  needs_clarification: boolean;
  actions: ChatAction[];
}

export interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: string;
  response?: ChatResponse;
}

export interface AccessibilityResult {
  revision: number;
  start_space_id: string;
  step_free: boolean;
  min_width_m: number | null;
  reachable_space_ids: string[];
  unreachable_space_ids: string[];
  floors: {
    floor_id: string;
    name: string;
    reachable: number;
    total: number;
  }[];
  notice: string;
}
