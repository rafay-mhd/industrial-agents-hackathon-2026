import { useEffect, useState, useMemo } from 'react';
import type { BuildingData, Space } from './types';
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

export default function App() {
  const [data, setData] = useState<BuildingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSpace, setHoveredSpace] = useState<Space | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch('/sample.json')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load sample.json: HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json: BuildingData) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Error loading building data');
        setLoading(false);
      });
  }, []);

  // Find Ground Floor (level 0)
  const groundFloor = useMemo(() => {
    if (!data?.floors) return null;
    return data.floors.find((f) => f.level === 0) || data.floors[0];
  }, [data]);

  // Filter spaces for Ground Floor
  const groundSpaces = useMemo(() => {
    if (!data || !groundFloor) return [];
    return data.spaces.filter((s) => s.floor_id === groundFloor.id);
  }, [data, groundFloor]);

  // Compute Bounding Box across all spaces on ground floor
  const bounds = useMemo(() => {
    if (groundSpaces.length === 0) {
      return { minX: 0, maxX: 100, minY: 0, maxY: 100, width: 100, height: 100 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const space of groundSpaces) {
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
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [groundSpaces]);

  // Compute viewBox with 4% padding
  const viewBox = useMemo(() => {
    const pad = Math.max(bounds.width, bounds.height) * 0.04;
    const vx = bounds.minX - pad;
    const vy = bounds.minY - pad;
    const vw = bounds.width + 2 * pad;
    const vh = bounds.height + 2 * pad;
    return `${vx} ${vy} ${vw} ${vh}`;
  }, [bounds]);

  // Building dimension scale for dynamic sizing of strokes and labels
  const buildingScale = useMemo(() => {
    return Math.max(bounds.width, bounds.height);
  }, [bounds]);

  const strokeWidth = useMemo(() => {
    return Math.max(buildingScale * 0.003, 0.2);
  }, [buildingScale]);

  const baseFontSize = useMemo(() => {
    return Math.max(buildingScale * 0.012, 0.85);
  }, [buildingScale]);

  if (loading) {
    return (
      <div className="state-container">
        <div className="spinner"></div>
        <p>Loading floor plan...</p>
      </div>
    );
  }

  if (error || !data || !groundFloor) {
    return (
      <div className="state-container">
        <p style={{ color: '#ef4444' }}>Error: {error || 'No ground floor found'}</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand-badge">
            <svg className="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Talk to Your Building
          </div>
          <div className="building-title-group">
            <h1 className="building-name">{data.building.name}</h1>
            <div className="floor-badge">
              <span className="floor-tag">{groundFloor.name}</span>
              <span>•</span>
              <span>Level {groundFloor.level}</span>
              <span>•</span>
              <span>Elevation {groundFloor.elevation_m ?? 0}m</span>
            </div>
          </div>
        </div>

        <div className="header-right">
          <div className="stats-pill">
            <span>Spaces:</span>
            <strong>{groundSpaces.length}</strong>
          </div>
          <div className="stats-pill">
            <span>ID:</span>
            <strong>{data.building.id}</strong>
          </div>
        </div>
      </header>

      {/* Main Floor Plan Viewport */}
      <main
        className="viewport-container"
        onMouseMove={(e) => {
          if (hoveredSpace) {
            setTooltipPos({ x: e.clientX, y: e.clientY });
          }
        }}
      >
        <svg
          className="floor-svg"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Ground Floor Space Polygons */}
          <g id="spaces-layer">
            {groundSpaces.map((space) => {
              // Flip Y coordinate: screen Y = (maxY + minY) - y
              const flippedPointsStr = space.polygon
                .map(([x, y]) => {
                  const flippedY = bounds.maxY + bounds.minY - y;
                  return `${x},${flippedY}`;
                })
                .join(' ');

              const typeClass = `type-${space.type.toLowerCase()}`;

              return (
                <polygon
                  key={space.id}
                  id={space.id}
                  points={flippedPointsStr}
                  className={`space-polygon ${typeClass}`}
                  strokeWidth={strokeWidth}
                  onMouseEnter={(e) => {
                    setHoveredSpace(space);
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={() => {
                    setHoveredSpace(null);
                    setTooltipPos(null);
                  }}
                />
              );
            })}
          </g>

          {/* Ref Labels at Polygon Centroid */}
          <g id="labels-layer">
            {groundSpaces.map((space) => {
              if (!space.ref) return null;

              const { centroid } = getPolygonMetrics(space.polygon);
              const labelX = centroid[0];
              // Flip Y for text position as well
              const labelY = bounds.maxY + bounds.minY - centroid[1];

              // Calculate bounding box of the polygon to ensure text fits inside small rooms
              const xs = space.polygon.map((p) => p[0]);
              const ys = space.polygon.map((p) => p[1]);
              const w = Math.max(...xs) - Math.min(...xs);
              const h = Math.max(...ys) - Math.min(...ys);
              const minDim = Math.min(w, h);
              const adaptiveFontSize = Math.min(baseFontSize, Math.max(minDim * 0.35, 0.4));

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
        </svg>

        {/* Hover Tooltip */}
        {hoveredSpace && tooltipPos && (
          <div
            className="hover-tooltip"
            style={{
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y - 12}px`,
            }}
          >
            <div className="tooltip-name">{hoveredSpace.name || hoveredSpace.ref}</div>
            <div className="tooltip-meta">
              <span className="tooltip-badge">Ref: {hoveredSpace.ref}</span>
              <span>Type: {hoveredSpace.type}</span>
              {hoveredSpace.room_type && <span>({hoveredSpace.room_type})</span>}
              <span>•</span>
              <span>{getPolygonMetrics(hoveredSpace.polygon).area.toFixed(1)} m²</span>
            </div>
          </div>
        )}

        {/* Color Legend Bar */}
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
        </div>
      </main>
    </div>
  );
}
