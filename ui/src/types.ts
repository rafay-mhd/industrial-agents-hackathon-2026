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
  type: 'room' | 'corridor' | 'stair' | 'lift' | 'hall' | 'outdoor' | string;
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
  kind: 'door' | 'opening' | 'entrance' | string;
  position: [number, number];
  width_m?: number;
  step_free?: boolean;
  synthetic?: boolean;
}

export interface VerticalConnector {
  id: string;
  kind: 'stairs' | 'lift' | string;
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
}

export function parseFootprint(fp: unknown): AssetFootprint | null {
  if (!fp) return null;
  if (typeof fp === 'object' && fp !== null && 'width_m' in fp) {
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
  type: 'route';
  length_m: number;
  steps: string[];
  floors: Record<string, [number, number][]>;
}

export interface HighlightAction {
  type: 'highlight';
  space_ids?: string[];
  asset_ids?: string[];
}

export interface ClosedAction {
  type: 'closed';
  element_ids: string[];
}

export interface DoorAddedAction {
  type: 'door_added';
  opening: Opening;
}

export interface BuildingCreatedAction {
  type: 'building_created';
  building_id: string;
}

export type ChatAction =
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
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  response?: ChatResponse;
}
