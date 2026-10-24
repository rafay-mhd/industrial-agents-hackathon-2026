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
}

export interface VerticalConnector {
  id: string;
  kind: 'stairs' | 'lift' | string;
  name: string;
  floor_ids: string[];
  space_ids: string[];
  step_free?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  category?: string;
  type?: string;
  space_id: string;
  floor_id: string;
  position: [number, number];
  footprint?: [number, number, number];
}
