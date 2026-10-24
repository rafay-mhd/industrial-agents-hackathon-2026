import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { BuildingData, Space, Opening, Asset } from './types';
import { parseFootprint } from './types';
import './App.css';

// Polygon Centroid and Area calculation using Shoelace formula
function getPolygonMetrics(points: [number, number][]): { centroid: [number, number]; area: number } {
  let areaSum = 0;
  let cx = 0;
  let cy = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    areaSum += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  const signedArea = areaSum / 2;
  const area = Math.abs(signedArea);

  if (Math.abs(signedArea) < 1e-6) {
    const avgX = points.reduce((acc, p) => acc + p[0], 0) / n;
    const avgY = points.reduce((acc, p) => acc + p[1], 0) / n;
    return { centroid: [avgX, avgY], area: 0 };
  }

  return {
    centroid: [cx / (6 * signedArea), cy / (6 * signedArea)],
    area,
  };
}

interface PresetBuilding {
  id: string;
  name: string;
  badge: string;
  file: string;
}

const PRESET_BUILDINGS: PresetBuilding[] = [
  {
    id: 'proc-factory-dev-003',
    name: 'Fertigung Ost 27',
    badge: 'Procedural Factory',
    file: '/buildings/proc-factory-dev-003.json',
  },
  {
    id: 'proc-campus-dev-000',
    name: 'Hörsaalzentrum 024',
    badge: '5-Floor Campus',
    file: '/buildings/proc-campus-dev-000.json',
  },
  {
    id: 'swiss-1689',
    name: 'Swiss 1689',
    badge: 'Rotated Rooms',
    file: '/buildings/swiss-1689.json',
  },
  {
    id: 'osm-way360544293',
    name: 'Terminal 2 (Munich)',
    badge: 'OSM 130-pt Polygon',
    file: '/buildings/osm-way360544293.json',
  },
  {
    id: 'resplan-1465',
    name: 'Residence 1465',
    badge: 'ResPlan Home',
    file: '/buildings/resplan-1465.json',
  },
];

type HoveredEntity =
  | { kind: 'space'; space: Space; area: number }
  | { kind: 'asset'; asset: Asset; dimensions?: string }
  | { kind: 'door'; opening: Opening; connectedRefs: string[] }
  | { kind: 'entrance'; opening: Opening };

export default function App() {
  const [data, setData] = useState<BuildingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Building Selection
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('proc-factory-dev-003');

  // Active Floor Selection
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');

  // Hover state
  const [hoveredEntity, setHoveredEntity] = useState<HoveredEntity | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Layer Toggles
  const [showLabels, setShowLabels] = useState(true);
  const [showDoors, setShowDoors] = useState(true);
  const [showAssets, setShowAssets] = useState(true);

  // Pan and Zoom State
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number }>({
    clientX: 0,
    clientY: 0,
    panX: 0,
    panY: 0,
  });

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load building by ID or URL
  const loadBuilding = useCallback((buildingId: string) => {
    setLoading(true);
    setError(null);
    const preset = PRESET_BUILDINGS.find((b) => b.id === buildingId);
    const targetFile = preset ? preset.file : `/buildings/${buildingId}.json`;

    fetch(targetFile)
      .then((res) => {
        if (!res.ok) {
          // Fallback to sample.json if preset file not directly mapped
          return fetch('/sample.json');
        }
        return res;
      })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load building`);
        return res.json();
      })
      .then((json: BuildingData) => {
        setData(json);
        setSelectedBuildingId(buildingId);
        // Default to ground floor (level 0) or first available floor
        const ground = json.floors.find((f) => f.level === 0) || json.floors[0];
        if (ground) {
          setSelectedFloorId(ground.id);
        }
        setZoom(1.0);
        setPan({ x: 0, y: 0 });
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Error loading building data');
        setLoading(false);
      });
  }, []);

  // Initial load
  useEffect(() => {
    loadBuilding('proc-factory-dev-003');
  }, [loadBuilding]);

  // Handle Custom File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text) as BuildingData;
        if (!parsed.building || !parsed.spaces || !parsed.floors) {
          throw new Error('Invalid building schema: missing building, spaces, or floors');
        }
        setData(parsed);
        setSelectedBuildingId(parsed.building.id);
        const ground = parsed.floors.find((f) => f.level === 0) || parsed.floors[0];
        if (ground) {
          setSelectedFloorId(ground.id);
        }
        setZoom(1.0);
        setPan({ x: 0, y: 0 });
        setLoading(false);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to parse uploaded building: ${message}`);
        setLoading(false);
      }
    };
    reader.readAsText(file);
    // Reset file input value so re-uploading the same file triggers onChange
    e.target.value = '';
  };

  // Sorted Floors by level ascending
  const sortedFloors = useMemo(() => {
    if (!data?.floors) return [];
    return [...data.floors].sort((a, b) => a.level - b.level);
  }, [data]);

  // Current Floor
  const currentFloor = useMemo(() => {
    if (!data?.floors) return null;
    return data.floors.find((f) => f.id === selectedFloorId) || sortedFloors[0] || null;
  }, [data, selectedFloorId, sortedFloors]);

  // Spaces for current floor
  const currentSpaces = useMemo(() => {
    if (!data || !currentFloor) return [];
    return data.spaces.filter((s) => s.floor_id === currentFloor.id);
  }, [data, currentFloor]);

  // Map of space_id -> ref/name for fast door label lookups
  const spaceMap = useMemo(() => {
    const map = new Map<string, Space>();
    if (data?.spaces) {
      for (const s of data.spaces) {
        map.set(s.id, s);
      }
    }
    return map;
  }, [data]);

  // Openings (doors and entrances) on current floor
  const currentOpenings = useMemo(() => {
    if (!data?.openings || !currentFloor) return [];
    return data.openings.filter((o) => o.floor_id === currentFloor.id);
  }, [data, currentFloor]);

  const { doors, entrances } = useMemo(() => {
    const d: Opening[] = [];
    const e: Opening[] = [];
    for (const op of currentOpenings) {
      if (op.kind === 'entrance' || op.space_ids.includes('outside')) {
        e.push(op);
      } else {
        d.push(op);
      }
    }
    return { doors: d, entrances: e };
  }, [currentOpenings]);

  // Assets on current floor
  const currentAssets = useMemo(() => {
    if (!data?.assets || !currentFloor) return [];
    return data.assets.filter((a) => a.floor_id === currentFloor.id);
  }, [data, currentFloor]);

  // Compute Bounding Box across all spaces on current floor
  const bounds = useMemo(() => {
    if (currentSpaces.length === 0) {
      // Fallback: compute from all building spaces if current floor has no spaces yet
      if (data?.spaces && data.spaces.length > 0) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const space of data.spaces) {
          for (const [x, y] of space.polygon) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        return {
          minX,
          maxX,
          minY,
          maxY,
          width: Math.max(maxX - minX, 1),
          height: Math.max(maxY - minY, 1),
        };
      }
      return { minX: 0, maxX: 100, minY: 0, maxY: 100, width: 100, height: 100 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const space of currentSpaces) {
      for (const [x, y] of space.polygon) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(maxX - minX, 1),
      height: Math.max(maxY - minY, 1),
    };
  }, [currentSpaces, data]);

  // Reset Pan/Zoom whenever floor changes
  useEffect(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setHoveredEntity(null);
  }, [selectedFloorId]);

  // Dynamic metrics for scaling lines, dots, triangles, and fonts
  const buildingScale = useMemo(() => {
    return Math.max(bounds.width, bounds.height);
  }, [bounds]);

  const strokeWidth = useMemo(() => {
    return Math.max(buildingScale * 0.0025, 0.15);
  }, [buildingScale]);

  const baseFontSize = useMemo(() => {
    return Math.max(buildingScale * 0.012, 0.85);
  }, [buildingScale]);

  const doorRadius = useMemo(() => {
    return Math.max(buildingScale * 0.0055, 0.35);
  }, [buildingScale]);

  const entranceSize = useMemo(() => {
    return Math.max(buildingScale * 0.014, 1.1);
  }, [buildingScale]);

  // Base ViewBox with 4% padding
  const baseViewBoxMetrics = useMemo(() => {
    const pad = Math.max(bounds.width, bounds.height) * 0.04;
    const baseW = bounds.width + 2 * pad;
    const baseH = bounds.height + 2 * pad;
    const baseCenterX = bounds.minX + bounds.width / 2;
    const baseCenterY = bounds.minY + bounds.height / 2;
    return { baseW, baseH, baseCenterX, baseCenterY };
  }, [bounds]);

  // Current viewBox based on zoom and pan
  const viewBoxStr = useMemo(() => {
    const { baseW, baseH, baseCenterX, baseCenterY } = baseViewBoxMetrics;
    const currentW = baseW / zoom;
    const currentH = baseH / zoom;
    const currentVx = (baseCenterX + pan.x) - currentW / 2;
    const currentVy = (baseCenterY + pan.y) - currentH / 2;
    return `${currentVx} ${currentVy} ${currentW} ${currentH}`;
  }, [baseViewBoxMetrics, zoom, pan]);

  // Pan and Zoom Event Handlers
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mouseRatioX = (e.clientX - rect.left) / rect.width;
      const mouseRatioY = (e.clientY - rect.top) / rect.height;

      const { baseW, baseH, baseCenterX, baseCenterY } = baseViewBoxMetrics;
      const currentW = baseW / zoom;
      const currentH = baseH / zoom;
      const currentVx = (baseCenterX + pan.x) - currentW / 2;
      const currentVy = (baseCenterY + pan.y) - currentH / 2;

      const mouseSvgX = currentVx + mouseRatioX * currentW;
      const mouseSvgY = currentVy + mouseRatioY * currentH;

      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const nextZoom = Math.min(Math.max(zoom * factor, 0.2), 50);

      const nextW = baseW / nextZoom;
      const nextH = baseH / nextZoom;

      const nextVx = mouseSvgX - mouseRatioX * nextW;
      const nextVy = mouseSvgY - mouseRatioY * nextH;

      const nextPanX = (nextVx + nextW / 2) - baseCenterX;
      const nextPanY = (nextVy + nextH / 2) - baseCenterY;

      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
    },
    [baseViewBoxMetrics, zoom, pan]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left mouse button only
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [pan]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (hoveredEntity) {
        setTooltipPos({ x: e.clientX, y: e.clientY });
      }
      if (!isDragging || !svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const { baseW, baseH } = baseViewBoxMetrics;
      const currentW = baseW / zoom;
      const currentH = baseH / zoom;

      const dxScreen = e.clientX - dragStartRef.current.clientX;
      const dyScreen = e.clientY - dragStartRef.current.clientY;

      const dxSvg = dxScreen * (currentW / rect.width);
      const dySvg = dyScreen * (currentH / rect.height);

      setPan({
        x: dragStartRef.current.panX - dxSvg,
        y: dragStartRef.current.panY - dySvg,
      });
    },
    [isDragging, hoveredEntity, baseViewBoxMetrics, zoom]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleResetView = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.3, 50));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.3, 0.2));
  }, []);

  if (loading) {
    return (
      <div className="state-container">
        <div className="spinner"></div>
        <p>Loading building floor plan...</p>
      </div>
    );
  }

  if (error || !data || !currentFloor) {
    return (
      <div className="state-container">
        <p style={{ color: '#ef4444' }}>Error: {error || 'No floors found'}</p>
        <button
          type="button"
          onClick={() => loadBuilding('proc-factory-dev-003')}
          style={{
            marginTop: '12px',
            padding: '8px 16px',
            background: '#3b82f6',
            color: '#fff',
            borderRadius: '6px',
          }}
        >
          Load Default Building
        </button>
      </div>
    );
  }

  return (
    <div className="app-container" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {/* Top Navigation Bar */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand-badge">
            <svg className="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Talk to Your Building
          </div>

          {/* Building Selector Dropdown & File Picker */}
          <div className="building-picker-group">
            <select
              aria-label="Select Building"
              value={selectedBuildingId}
              onChange={(e) => loadBuilding(e.target.value)}
              className="building-select"
            >
              {PRESET_BUILDINGS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.badge})
                </option>
              ))}
              {!PRESET_BUILDINGS.some((b) => b.id === selectedBuildingId) && (
                <option value={selectedBuildingId}>Custom: {data.building.name}</option>
              )}
            </select>

            {/* Custom JSON File Upload */}
            <label className="upload-file-label" title="Upload any building.json file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="upload-file-input"
                onChange={handleFileUpload}
              />
            </label>
          </div>

          <div className="building-title-group">
            <h1 className="building-name">{data.building.name}</h1>
            <div className="building-meta">
              <span>{data.building.id}</span>
              <span>•</span>
              <span>Elevation: {currentFloor.elevation_m ?? 0}m</span>
              <span>•</span>
              <span>Height: {currentFloor.height_m ?? 3.5}m</span>
            </div>
          </div>
        </div>

        {/* Floor Selector Tabs (sorted by level) */}
        <div className="floor-tabs-container">
          {sortedFloors.map((floor) => {
            const isActive = floor.id === selectedFloorId;
            return (
              <button
                key={floor.id}
                type="button"
                className={`floor-tab ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedFloorId(floor.id)}
              >
                <span className="floor-level-pill">L{floor.level}</span>
                <span>{floor.name}</span>
              </button>
            );
          })}
        </div>

        {/* Stats on Right */}
        <div className="header-right">
          <div className="stats-pill">
            <span>Spaces:</span>
            <strong>{currentSpaces.length}</strong>
          </div>
          <div className="stats-pill">
            <span>Doors:</span>
            <strong>{doors.length}</strong>
          </div>
          <div className="stats-pill">
            <span>Assets:</span>
            <strong>{currentAssets.length}</strong>
          </div>
        </div>
      </header>

      {/* Main Floor Plan Viewport */}
      <main
        ref={containerRef}
        className={`viewport-container ${isDragging ? 'is-dragging' : ''}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
      >
        {/* Layer Toggles */}
        <div className="layer-toggles-bar">
          <button
            type="button"
            className={`layer-toggle-btn ${showLabels ? 'active' : ''}`}
            onClick={() => setShowLabels(!showLabels)}
          >
            Labels
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showDoors ? 'active' : ''}`}
            onClick={() => setShowDoors(!showDoors)}
          >
            Doors ({doors.length + entrances.length})
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${showAssets ? 'active' : ''}`}
            onClick={() => setShowAssets(!showAssets)}
          >
            Assets ({currentAssets.length})
          </button>
        </div>

        {/* Zoom & Fit Floating Controls */}
        <div className="floating-controls">
          <button type="button" className="control-btn" onClick={handleZoomIn} title="Zoom In (+)">
            +
          </button>
          <div className="zoom-indicator">{Math.round(zoom * 100)}%</div>
          <button type="button" className="control-btn" onClick={handleZoomOut} title="Zoom Out (-)">
            −
          </button>
          <div className="control-divider" />
          <button type="button" className="control-btn" onClick={handleResetView} title="Fit to View">
            ⛶
          </button>
        </div>

        {/* SVG Floor Plan Canvas */}
        <svg
          ref={svgRef}
          className="floor-svg"
          viewBox={viewBoxStr}
          preserveAspectRatio="xMidYMid meet"
          onWheel={handleWheel}
        >
          {/* Layer 1: Space Polygons */}
          <g id="spaces-layer">
            {currentSpaces.map((space) => {
              // Flip Y coordinate: screen Y = (maxY + minY) - y
              const flippedPointsStr = space.polygon
                .map(([x, y]) => {
                  const flippedY = bounds.maxY + bounds.minY - y;
                  return `${x},${flippedY}`;
                })
                .join(' ');

              const typeClass = `type-${space.type.toLowerCase()}`;
              const { area } = getPolygonMetrics(space.polygon);

              return (
                <polygon
                  key={space.id}
                  id={space.id}
                  points={flippedPointsStr}
                  className={`space-polygon ${typeClass}`}
                  strokeWidth={strokeWidth}
                  onMouseEnter={(e) => {
                    setHoveredEntity({ kind: 'space', space, area });
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={() => {
                    setHoveredEntity(null);
                    setTooltipPos(null);
                  }}
                />
              );
            })}
          </g>

          {/* Layer 2: Assets / Furniture (small rotated rectangles from footprint) */}
          {showAssets && (
            <g id="assets-layer">
              {currentAssets.map((asset) => {
                const posX = asset.position[0];
                const posY = bounds.maxY + bounds.minY - asset.position[1];
                const fp = parseFootprint(asset.footprint);
                const w = fp ? fp.width_m : 1.0;
                const d = fp ? fp.depth_m : 0.8;
                const rot = fp ? -fp.rotation_deg : 0;

                let categoryClass = 'asset-default';
                const cat = (asset.category || '').toLowerCase();
                const type = (asset.type || '').toLowerCase();
                if (cat === 'furniture' || type.includes('desk') || type.includes('table') || type.includes('chair')) {
                  categoryClass = 'asset-furniture';
                } else if (cat === 'machine' || type.includes('cnc') || type.includes('mill') || type.includes('lathe')) {
                  categoryClass = 'asset-machine';
                } else if (type.includes('storage') || type.includes('cabinet') || type.includes('rack')) {
                  categoryClass = 'asset-storage';
                }

                return (
                  <rect
                    key={asset.id}
                    id={asset.id}
                    x={-w / 2}
                    y={-d / 2}
                    width={w}
                    height={d}
                    rx={Math.min(w, d) * 0.12}
                    transform={`translate(${posX}, ${posY}) rotate(${rot})`}
                    className={`asset-rect ${categoryClass}`}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredEntity({
                        kind: 'asset',
                        asset,
                        dimensions: `${w.toFixed(1)}m × ${d.toFixed(1)}m`,
                      });
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEntity(null);
                      setTooltipPos(null);
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Layer 3: Openings (Doors as dots, Entrances as triangles) */}
          {showDoors && (
            <g id="openings-layer">
              {/* Doors: small dots at position */}
              {doors.map((door) => {
                const doorX = door.position[0];
                const doorY = bounds.maxY + bounds.minY - door.position[1];
                const connectedRefs = door.space_ids
                  .map((id) => spaceMap.get(id)?.ref || spaceMap.get(id)?.name || id)
                  .filter(Boolean);

                return (
                  <circle
                    key={door.id}
                    id={door.id}
                    cx={doorX}
                    cy={doorY}
                    r={doorRadius}
                    className="door-dot"
                    strokeWidth={strokeWidth * 0.5}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredEntity({ kind: 'door', opening: door, connectedRefs });
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEntity(null);
                      setTooltipPos(null);
                    }}
                  />
                );
              })}

              {/* Entrances: triangles at position */}
              {entrances.map((ent) => {
                const entX = ent.position[0];
                const entY = bounds.maxY + bounds.minY - ent.position[1];
                const s = entranceSize;
                // Equilateral-like triangle pointing inwards/upwards
                const triPoints = `${entX},${entY - s} ${entX - s * 0.866},${entY + s * 0.5} ${entX + s * 0.866},${entY + s * 0.5}`;

                return (
                  <polygon
                    key={ent.id}
                    id={ent.id}
                    points={triPoints}
                    className="entrance-triangle"
                    strokeWidth={strokeWidth * 0.6}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHoveredEntity({ kind: 'entrance', opening: ent });
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredEntity(null);
                      setTooltipPos(null);
                    }}
                  />
                );
              })}
            </g>
          )}

          {/* Layer 4: Ref Labels at Centroid */}
          {showLabels && (
            <g id="labels-layer">
              {currentSpaces.map((space) => {
                if (!space.ref) return null;

                const { centroid } = getPolygonMetrics(space.polygon);
                const labelX = centroid[0];
                const labelY = bounds.maxY + bounds.minY - centroid[1];

                const xs = space.polygon.map((p) => p[0]);
                const ys = space.polygon.map((p) => p[1]);
                const w = Math.max(...xs) - Math.min(...xs);
                const h = Math.max(...ys) - Math.min(...ys);
                const minDim = Math.min(w, h);
                const adaptiveFontSize = Math.min(baseFontSize, Math.max(minDim * 0.35, 0.45));

                return (
                  <text
                    key={`label-${space.id}`}
                    x={labelX}
                    y={labelY}
                    fontSize={adaptiveFontSize}
                    className="space-label"
                  >
                    {space.ref}
                  </text>
                );
              })}
            </g>
          )}
        </svg>

        {/* Dynamic Hover Tooltip */}
        {hoveredEntity && tooltipPos && (
          <div
            className="hover-tooltip"
            style={{
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y - 12}px`,
            }}
          >
            {hoveredEntity.kind === 'space' && (
              <>
                <div className="tooltip-title">
                  <span>{hoveredEntity.space.name || hoveredEntity.space.ref}</span>
                  <span className="tooltip-badge">Ref: {hoveredEntity.space.ref}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Type: <strong className="tooltip-highlight">{hoveredEntity.space.type}</strong></span>
                  {hoveredEntity.space.room_type && (
                    <span>({hoveredEntity.space.room_type})</span>
                  )}
                  <span>•</span>
                  <span>{hoveredEntity.area.toFixed(1)} m²</span>
                </div>
              </>
            )}

            {hoveredEntity.kind === 'asset' && (
              <>
                <div className="tooltip-title">
                  <span>{hoveredEntity.asset.name}</span>
                  <span className="tooltip-badge">{hoveredEntity.asset.category || 'Asset'}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Type: <strong className="tooltip-highlight">{hoveredEntity.asset.type}</strong></span>
                  {hoveredEntity.dimensions && <span>• {hoveredEntity.dimensions}</span>}
                </div>
              </>
            )}

            {hoveredEntity.kind === 'door' && (
              <>
                <div className="tooltip-title">
                  <span>Door</span>
                  <span className="tooltip-badge">{hoveredEntity.opening.step_free ? 'Step-free' : 'Step'}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Width: <strong className="tooltip-highlight">{hoveredEntity.opening.width_m} m</strong></span>
                  {hoveredEntity.connectedRefs.length > 0 && (
                    <span>• Connects: {hoveredEntity.connectedRefs.join(' ↔ ')}</span>
                  )}
                </div>
              </>
            )}

            {hoveredEntity.kind === 'entrance' && (
              <>
                <div className="tooltip-title">
                  <span style={{ color: '#ef4444' }}>▲ Building Entrance</span>
                  <span className="tooltip-badge">{hoveredEntity.opening.step_free ? 'Step-free' : 'Standard'}</span>
                </div>
                <div className="tooltip-meta-row">
                  <span>Width: <strong className="tooltip-highlight">{hoveredEntity.opening.width_m} m</strong></span>
                  <span>• Main external access</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Color & Symbol Legend */}
        <div className="legend-bar">
          <div className="legend-item">
            <span className="legend-swatch room" />
            <span>Room</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch corridor" />
            <span>Corridor</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch hall" />
            <span>Hall</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch stair" />
            <span>Stair</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch lift" />
            <span>Lift</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch outdoor" />
            <span>Outdoor</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch door" />
            <span>Door</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch entrance" />
            <span>Entrance</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch asset" />
            <span>Asset</span>
          </div>
        </div>
      </main>
    </div>
  );
}
